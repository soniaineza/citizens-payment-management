const express = require('express');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// List citizens with their payment status.
// ?search= filters by name or ID number, ?place= filters by location.
router.get('/', async (req, res) => {
  try {
    const { search, place } = req.query;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(c.name ILIKE $${paramIndex} OR c.id_number ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (place) {
      conditions.push(`c.place ILIKE $${paramIndex}`);
      params.push(`%${place}%`);
      paramIndex++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.id_number, c.phone, c.gender, c.spouse_name, c.spouse_id,
              c.num_other_persons, c.district, c.sector, c.cell, c.village, c.ics_serial,
              c.registration_date, c.address, c.place, c.notes, c.created_at,
              (SELECT COUNT(*)::int FROM payments p WHERE p.citizen_id = c.id) AS payment_count,
              COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.citizen_id = c.id), 0) AS total_paid,
              (SELECT MAX(p.payment_date) FROM payments p WHERE p.citizen_id = c.id) AS last_payment_date
       FROM citizens c
       ${where}
       ORDER BY c.name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('List citizens error:', err.message);
    res.status(500).json({ error: 'Could not load citizens.' });
  }
});

// Get one citizen with their payment history.
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.id_number, c.phone, c.gender, c.spouse_name, c.spouse_id,
              c.num_other_persons, c.district, c.sector, c.cell, c.village, c.ics_serial,
              c.registration_date, c.address, c.place, c.notes, c.created_at
       FROM citizens c WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Citizen not found.' });
    const payments = await pool.query(
      `SELECT id, amount, payment_date, place, method, notes, created_at
       FROM payments WHERE citizen_id = $1 ORDER BY payment_date DESC`,
      [req.params.id]
    );
    res.json({ ...rows[0], payments: payments.rows });
  } catch (err) {
    console.error('Get citizen error:', err.message);
    res.status(500).json({ error: 'Could not load citizen.' });
  }
});

// Add a new citizen.
router.post('/', async (req, res) => {
  try {
    const {
      name, id_number, phone, gender, spouse_name, spouse_id, num_other_persons,
      district, sector, cell, village, ics_serial, registration_date,
      address, place, notes,
    } = req.body || {};
    if (!name || !id_number) {
      return res.status(400).json({ error: 'Name and ID number are required.' });
    }
    const dup = await pool.query(
      'SELECT id, name FROM citizens WHERE LOWER(id_number) = LOWER($1)',
      [id_number.trim()]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'A citizen with that ID number already exists.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO citizens (
         name, id_number, phone, gender, spouse_name, spouse_id, num_other_persons,
         district, sector, cell, village, ics_serial, registration_date, address, place, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        name.trim(), id_number.trim(), phone || '', gender || '', spouse_name || '', spouse_id || '',
        num_other_persons === '' || num_other_persons == null ? null : num_other_persons,
        district || '', sector || '', cell || '', village || '', ics_serial || '',
        registration_date || null, address || '', place || '', notes || '',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A citizen with that ID number already exists.' });
    }
    console.error('Create citizen error:', err.message);
    res.status(500).json({ error: 'Could not add citizen.' });
  }
});

// Update a citizen.
router.put('/:id', async (req, res) => {
  try {
    const {
      name, id_number, phone, gender, spouse_name, spouse_id, num_other_persons,
      district, sector, cell, village, ics_serial, registration_date,
      address, place, notes,
    } = req.body || {};
    const dup = await pool.query(
      'SELECT id, name FROM citizens WHERE LOWER(id_number) = LOWER($1) AND id <> $2',
      [id_number.trim(), req.params.id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'A citizen with that ID number already exists.' });
    }
    const { rowCount, rows } = await pool.query(
      `UPDATE citizens
       SET name = $1, id_number = $2, phone = $3, gender = $4, spouse_name = $5,
           spouse_id = $6, num_other_persons = $7, district = $8, sector = $9,
           cell = $10, village = $11, ics_serial = $12, registration_date = $13,
           address = $14, place = $15, notes = $16
       WHERE id = $17
       RETURNING *`,
      [
        name.trim(), id_number.trim(), phone || '', gender || '', spouse_name || '', spouse_id || '',
        num_other_persons === '' || num_other_persons == null ? null : num_other_persons,
        district || '', sector || '', cell || '', village || '', ics_serial || '',
        registration_date || null, address || '', place || '', notes || '', req.params.id,
      ]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Citizen not found.' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A citizen with that ID number already exists.' });
    }
    console.error('Update citizen error:', err.message);
    res.status(500).json({ error: 'Could not update citizen.' });
  }
});

// Import citizens from CSV/Excel. Auto-creates new columns if headers don't match existing schema.
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

    // Known columns that we handle with specific mapping
    const knownColumns = {
      name: 'name', id_number: 'id_number', 'id number': 'id_number', id: 'id_number',
      phone: 'phone', gender: 'gender', spouse_name: 'spouse_name', 'spouse name': 'spouse_name',
      spouse_id: 'spouse_id', 'spouse id': 'spouse_id',
      num_other_persons: 'num_other_persons', 'num other persons': 'num_other_persons',
      district: 'district', sector: 'sector', cell: 'cell', village: 'village',
      ics_serial: 'ics_serial', 'ics serial': 'ics_serial',
      registration_date: 'registration_date', 'registration date': 'registration_date',
      address: 'address', place: 'place', notes: 'notes',
    };

    // Get all unique header keys from all rows
    const allHeaders = new Set();
    results.forEach((row) => Object.keys(row).forEach((k) => allHeaders.add(k)));

    // Get existing columns from citizens table
    const { rows: colRows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'citizens'"
    );
    const existingCols = new Set(colRows.map((r) => r.column_name));

    // Map each header to a real column name, detect new ones
    const headerMap = {};
    const newColumns = [];
    for (const header of allHeaders) {
      const normalized = header.toLowerCase().trim();
      const mapped = knownColumns[normalized] || normalized;
      headerMap[header] = mapped;

      if (!existingCols.has(mapped)) {
        newColumns.push(mapped);
      }
    }

    // Add new columns to the citizens table
    for (const col of newColumns) {
      const safeCol = col.replace(/[^a-z0-9_]/g, '_');
      if (safeCol === 'name' || safeCol === 'id_number' || safeCol === 'id') continue;
      try {
        await pool.query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS "${safeCol}" TEXT`);
        headerMap[Object.keys(headerMap).find((k) => headerMap[k] === col)] = safeCol;
      } catch (e) {
        console.warn(`Could not add column ${safeCol}:`, e.message);
      }
    }

    // Refresh existing columns after ALTER
    const { rows: colRows2 } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'citizens'"
    );
    const finalCols = new Set(colRows2.map((r) => r.column_name));

    let imported = 0;
    let skipped = 0;

    for (const row of results) {
      const name = (row.name || row.Name || '').trim();
      const id_number = (row.id_number || row['ID Number'] || row.ID || '').trim();

      if (!name || !id_number) {
        skipped++;
        continue;
      }

      const dup = await pool.query(
        'SELECT id FROM citizens WHERE LOWER(id_number) = LOWER($1)',
        [id_number]
      );
      if (dup.rows.length > 0) {
        skipped++;
        continue;
      }

      try {
        // Build dynamic columns and values
        const cols = [];
        const vals = [];
        let paramIdx = 1;

        // Always include name and id_number
        cols.push('name', 'id_number');
        vals.push(name, id_number);
        paramIdx += 2;

        // Map known columns
        const knownMapping = {
          phone: row.phone || row.Phone || '',
          gender: row.gender || row.Gender || '',
          spouse_name: row.spouse_name || row['Spouse Name'] || '',
          spouse_id: row.spouse_id || row['Spouse ID'] || '',
          num_other_persons: row.num_other_persons || row['Num Other Persons'] || null,
          district: row.district || row.District || '',
          sector: row.sector || row.Sector || '',
          cell: row.cell || row.Cell || '',
          village: row.village || row.Village || '',
          ics_serial: row.ics_serial || row['ICS Serial'] || '',
          registration_date: row.registration_date || row['Registration Date'] || null,
          address: row.address || row.Address || '',
          place: row.place || row.Place || '',
          notes: row.notes || row.Notes || '',
        };

        for (const [key, val] of Object.entries(knownMapping)) {
          if (finalCols.has(key)) {
            cols.push(key);
            vals.push(typeof val === 'string' ? val.trim() : val);
            paramIdx++;
          }
        }

        // Add any custom/dynamic columns from the CSV
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
          `INSERT INTO citizens (${cols.map((c) => c.includes('"') ? c : `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          vals
        );
        imported++;
      } catch (err) {
        console.error('Import row error:', err.message);
        skipped++;
      }
    }

    res.json({ imported, skipped, total: results.length, newColumns });
  } catch (err) {
    console.error('Import citizens error:', err.message);
    res.status(500).json({ error: 'Could not import citizens.' });
  }
});

// Bulk delete citizens.
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Please provide an array of citizen IDs.' });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM citizens WHERE id = ANY($1)`,
      [ids]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error('Bulk delete citizens error:', err.message);
    res.status(500).json({ error: 'Could not delete citizens.' });
  }
});

// Delete a citizen (their payments are removed too).
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM citizens WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Citizen not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete citizen error:', err.message);
    res.status(500).json({ error: 'Could not delete citizen.' });
  }
});

module.exports = router;