const express = require('express');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// List payments. Filters: ?citizen_id=, ?place=, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { citizen_id, place, from, to } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;

    if (citizen_id) {
      conditions.push(`p.citizen_id = $${i++}`);
      params.push(citizen_id);
    }
    if (place) {
      conditions.push(`p.place ILIKE $${i++}`);
      params.push(`%${place}%`);
    }
    if (from) {
      conditions.push(`p.payment_date >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`p.payment_date <= $${i++}`);
      params.push(to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT p.id, p.amount, p.payment_date, p.place, p.method, p.notes, p.created_at,
              c.id AS citizen_id, c.name AS citizen_name, c.id_number
       FROM payments p
       JOIN citizens c ON c.id = p.citizen_id
       ${where}
       ORDER BY p.payment_date DESC, p.id DESC
       LIMIT 1000`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('List payments error:', err.message);
    res.status(500).json({ error: 'Could not load payments.' });
  }
});

// Record a payment.
router.post('/', async (req, res) => {
  try {
    const { citizen_id, amount, payment_date, place, method, notes } = req.body || {};
    if (!citizen_id) return res.status(400).json({ error: 'Please choose a citizen.' });
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({ error: 'Please enter a valid amount.' });
    }

    const citizen = await pool.query('SELECT id FROM citizens WHERE id = $1', [citizen_id]);
    if (citizen.rowCount === 0) return res.status(404).json({ error: 'Citizen not found.' });

    const { rows } = await pool.query(
      `INSERT INTO payments (citizen_id, amount, payment_date, place, method, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [citizen_id, amountNum, payment_date || new Date().toISOString().slice(0, 10), place || '', method || 'Cash', notes || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create payment error:', err.message);
    res.status(500).json({ error: 'Could not record payment.' });
  }
});

// Update a payment (for corrections).
router.put('/:id', async (req, res) => {
  try {
    const { amount, payment_date, place, method, notes } = req.body || {};
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) {
      return res.status(400).json({ error: 'Please enter a valid amount.' });
    }
    const { rowCount, rows } = await pool.query(
      `UPDATE payments
       SET amount = $1, payment_date = $2, place = $3, method = $4, notes = $5
       WHERE id = $6
       RETURNING *`,
      [amountNum, payment_date, place || '', method || 'Cash', notes || '', req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Payment not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update payment error:', err.message);
    res.status(500).json({ error: 'Could not update payment.' });
  }
});

// Import payments from CSV/Excel. Auto-creates new columns if headers don't match existing schema.
router.post('/import', async (req, res) => {
  try {
    if (!req.body || !req.body.csv) {
      return res.status(400).json({ error: 'Please provide CSV data.' });
    }

    const results = [];
    const stream = Readable.from(req.body.csv);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    if (results.length === 0) {
      return res.json({ imported: 0, skipped: 0, total: 0, newColumns: [] });
    }

    const knownColumns = {
      citizen_id: 'citizen_id', 'citizen id': 'citizen_id',
      id_number: 'citizen_id_ref', 'id number': 'citizen_id_ref', id: 'citizen_id_ref',
      amount: 'amount', payment_date: 'payment_date', date: 'payment_date',
      place: 'place', method: 'method', notes: 'notes',
    };

    const allHeaders = new Set();
    results.forEach((row) => Object.keys(row).forEach((k) => allHeaders.add(k)));

    const { rows: colRows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'payments'"
    );
    const existingCols = new Set(colRows.map((r) => r.column_name));

    const headerMap = {};
    const newColumns = [];
    for (const header of allHeaders) {
      const normalized = header.toLowerCase().trim();
      const mapped = knownColumns[normalized] || normalized;
      headerMap[header] = mapped;

      if (!existingCols.has(mapped) && mapped !== 'citizen_id_ref') {
        newColumns.push(mapped);
      }
    }

    for (const col of newColumns) {
      const safeCol = col.replace(/[^a-z0-9_]/g, '_');
      try {
        await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS "${safeCol}" TEXT`);
        headerMap[Object.keys(headerMap).find((k) => headerMap[k] === col)] = safeCol;
      } catch (e) {
        console.warn(`Could not add column ${safeCol}:`, e.message);
      }
    }

    const { rows: colRows2 } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'payments'"
    );
    const finalCols = new Set(colRows2.map((r) => r.column_name));

    let imported = 0;
    let skipped = 0;

    for (const row of results) {
      const idNumber = (row.id_number || row['ID Number'] || row.ID || '').trim();
      const amount = parseFloat(row.amount || row.Amount || 0);

      if (!idNumber || isNaN(amount) || amount <= 0) {
        skipped++;
        continue;
      }

      const citizen = await pool.query(
        'SELECT id FROM citizens WHERE LOWER(id_number) = LOWER($1)',
        [idNumber]
      );
      if (citizen.rows.length === 0) {
        skipped++;
        continue;
      }

      try {
        const cols = [];
        const vals = [];
        let paramIdx = 1;

        cols.push('citizen_id', 'amount');
        vals.push(citizen.rows[0].id, amount);
        paramIdx += 2;

        if (finalCols.has('payment_date')) {
          cols.push('payment_date');
          vals.push(row.payment_date || row.Date || new Date().toISOString().slice(0, 10));
          paramIdx++;
        }
        if (finalCols.has('place')) {
          cols.push('place');
          vals.push((row.place || row.Place || '').trim());
          paramIdx++;
        }
        if (finalCols.has('method')) {
          cols.push('method');
          vals.push((row.method || row.Method || 'Cash').trim());
          paramIdx++;
        }
        if (finalCols.has('notes')) {
          cols.push('notes');
          vals.push((row.notes || row.Notes || '').trim());
          paramIdx++;
        }

        for (const header of Object.keys(row)) {
          const normalized = header.toLowerCase().trim();
          const mapped = headerMap[header];
          if (mapped && !knownColumns[normalized] && finalCols.has(mapped)) {
            cols.push(`"${mapped}"`);
            vals.push(row[header] || '');
            paramIdx++;
          }
        }

        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        await pool.query(
          `INSERT INTO payments (${cols.map((c) => c.includes('"') ? c : `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          vals
        );
        imported++;
      } catch (err) {
        console.error('Import payment row error:', err.message);
        skipped++;
      }
    }

    res.json({ imported, skipped, total: results.length, newColumns });
  } catch (err) {
    console.error('Import payments error:', err.message);
    res.status(500).json({ error: 'Could not import payments.' });
  }
});

// Bulk delete payments.
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of payment IDs.' });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM payments WHERE id = ANY($1)`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error('Bulk delete payments error:', err.message);
    res.status(500).json({ error: 'Could not delete payments.' });
  }
});

// Delete a payment.
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete payment error:', err.message);
    res.status(500).json({ error: 'Could not delete payment.' });
  }
});

module.exports = router;