const express = require('express');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// List citizens with their payment status.
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

// Import citizens from CSV/Excel. Accepts ANY file — works with or without name/id columns.
router.post('/import', async (req, res) => {
  try {
    if (!req.body || !req.body.csv) {
      return res.status(400).json({ error: 'Please provide CSV data.' });
    }

    const results = [];
    const stream = Readable.from(req.body.csv);
    await new Promise((resolve, reject) => {
      stream.pipe(csv()).on('data', (row) => results.push(row)).on('end', resolve).on('error', reject);
    });

    if (results.length === 0) {
      return res.json({ imported: 0, updated: 0, skipped: 0, total: 0, newColumns: [] });
    }

    // --- Normalize a header: lowercase, convert ALL whitespace to spaces, strip junk ---
    const normH = (h) => h.toLowerCase()
      .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ').trim();

    // --- Fuzzy header matching ---
    // Combined map: normalized header → DB column name
    const known = {
      // name
      'name': 'name', 'full name': 'name', 'nom': 'name', 'nom complet': 'name',
      'citizen name': 'name', 'citizen_name': 'name', 'iname': 'name',
      'head of hh': 'name', 'head of household': 'name', 'name of head of hh': 'name',
      'name of head': 'name', 'head': 'name', 'chef': 'name', 'household': 'name',
      // id
      'id_number': 'id_number', 'id number': 'id_number', 'id': 'id_number',
      'id no': 'id_number', 'id no.': 'id_number', 'nid': 'id_number', 'nin': 'id_number',
      'identification': 'id_number', 'identity': 'id_number',
      'citizen id': 'id_number',
      // phone
      'phone': 'phone', 'telephone': 'phone', 'tel': 'phone', 'phone number': 'phone',
      // gender
      'gender': 'gender', 'genre': 'gender', 'sexe': 'gender', 'gender m f': 'gender',
      'gender (m/f)': 'gender', 'gender mf': 'gender', 'm/f': 'gender', 'm f': 'gender',
      // spouse
      'spouse name': 'spouse_name', 'spouse_name': 'spouse_name', 'nom du conjoint': 'spouse_name',
      'spouse id': 'spouse_id', 'spouse_id': 'spouse_id',
      // num_other_persons
      'num other persons': 'num_other_persons', 'num_other_persons': 'num_other_persons',
      'number of other persons in hh': 'num_other_persons',
      'number of other persons': 'num_other_persons',
      'nombre personnes': 'num_other_persons', 'persons': 'num_other_persons',
      // location
      'district': 'district', 'secteur': 'district', 'sector': 'sector',
      'cell': 'cell', 'cellule': 'cell', 'village': 'village',
      // ics
      'ics serial': 'ics_serial', 'ics_serial': 'ics_serial', 'icsserilnumber': 'ics_serial',
      'serial number': 'ics_serial',
      // date
      'registration date': 'registration_date', 'registration_date': 'registration_date',
      'date enregistrement': 'registration_date', 'date inscription': 'registration_date',
      'date': 'registration_date',
      // other
      'address': 'address', 'adresse': 'address',
      'place': 'place', 'lieu': 'place', 'location': 'place',
      'notes': 'notes', 'remarques': 'notes', 'observation': 'notes',
    };

    // --- Build headerMap (original header → DB column) ---
    const allHeaders = new Set();
    results.forEach((row) => Object.keys(row).forEach((k) => allHeaders.add(k)));

    const { rows: colRows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'citizens'"
    );
    const existingCols = new Set(colRows.map((r) => r.column_name));

    const headerMap = {};
    for (const header of allHeaders) {
      const n = normH(header);
      headerMap[header] = known[n] || n.replace(/[^a-z0-9_]/g, '_');
    }

    // --- Create new columns if needed ---
    const newColumns = [];
    for (const header of allHeaders) {
      const mapped = headerMap[header];
      if (!existingCols.has(mapped) && !['name', 'id_number', 'id'].includes(mapped)) {
        newColumns.push(mapped);
      }
    }
    for (const col of [...new Set(newColumns)]) {
      try {
        await pool.query(`ALTER TABLE citizens ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
      } catch (e) { /* ignore */ }
    }

    // Refresh column list
    const { rows: colRows2 } = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'citizens'"
    );
    const finalCols = new Set(colRows2.map((r) => r.column_name));
    const intCols = new Set(colRows2.filter((r) => r.data_type === 'integer').map((r) => r.column_name));
    const dateCols = new Set(colRows2.filter((r) => r.data_type === 'date').map((r) => r.column_name));

    // --- Helper: get value from a row for a target DB column ---
    const getVal = (row, target) => {
      for (const [key, val] of Object.entries(row)) {
        if (headerMap[key] === target) return String(val || '').trim();
      }
      return '';
    };

    // --- Helper: convert raw value to proper type ---
    const toTyped = (raw, dbCol) => {
      if (!raw) return null;
      if (intCols.has(dbCol)) {
        const n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
        return isNaN(n) ? null : n;
      }
      if (dateCols.has(dbCol)) return raw || null;
      return raw;
    };

    // --- Normalize every row ---
    const normRows = results.map((row, idx) => {
      let name = getVal(row, 'name');
      let id_number = getVal(row, 'id_number');
      // Fallback: first two columns if name/id not found
      const vals = Object.values(row);
      if (!name && vals.length > 0) name = String(vals[0] || '').trim();
      if (!id_number && vals.length > 1) id_number = String(vals[1] || '').trim();
      // Auto-generate id_number if completely missing
      if (!id_number) id_number = 'AUTO_' + Date.now() + '_' + (idx + 1);
      return { row, name: name || 'Unknown', id_number };
    });

    // --- Deduplicate by id_number (keep last occurrence) ---
    const deduped = new Map();
    for (const nr of normRows) {
      deduped.set(nr.id_number.toLowerCase(), nr);
    }
    const uniqueRows = [...deduped.values()];

    // --- Check which IDs already exist in DB ---
    const uniqueIds = [...new Set(uniqueRows.map((r) => r.id_number.toLowerCase()))].filter(Boolean);
    const existingMap = new Set();
    for (let i = 0; i < uniqueIds.length; i += 500) {
      const batch = uniqueIds.slice(i, i + 500);
      const { rows } = await pool.query(
        'SELECT LOWER(id_number) as id FROM citizens WHERE LOWER(id_number) = ANY($1)',
        [batch]
      );
      rows.forEach((r) => existingMap.add(r.id));
    }

    // --- Build column values for each row ---
    const dbFields = ['phone', 'gender', 'spouse_name', 'spouse_id', 'num_other_persons',
      'district', 'sector', 'cell', 'village', 'ics_serial', 'registration_date',
      'address', 'place', 'notes'];

    const buildColVals = (nr) => {
      const { row, name, id_number } = nr;
      const colVals = { name, id_number };
      for (const dbCol of dbFields) {
        if (finalCols.has(dbCol)) colVals[dbCol] = toTyped(getVal(row, dbCol), dbCol);
      }
      // Custom columns from CSV
      for (const [key, val] of Object.entries(row)) {
        const mapped = headerMap[key];
        const kN = normH(key);
        if (mapped && !known[kN] && finalCols.has(mapped)) {
          colVals[mapped] = String(val || '').trim() || null;
        }
      }
      return colVals;
    };

    const toInsert = [];
    const toUpdate = [];
    for (const nr of uniqueRows) {
      const cv = buildColVals(nr);
      if (existingMap.has(nr.id_number.toLowerCase())) {
        toUpdate.push(cv);
      } else {
        toInsert.push(cv);
      }
    }

    // --- Execute in a transaction ---
    const client = await pool.connect();
    let imported = 0, updated = 0, skipped = 0;
    try {
      await client.query('BEGIN');

      // Batch INSERT (500 rows at a time)
      for (let i = 0; i < toInsert.length; i += 500) {
        const batch = toInsert.slice(i, i + 500);
        if (batch.length === 0) continue;
        const cols = Object.keys(batch[0]);
        const colList = cols.map((c) => `"${c}"`).join(', ');
        const values = [];
        const placeholders = [];
        batch.forEach((row, ri) => {
          const rp = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
          placeholders.push(`(${rp.join(', ')})`);
          cols.forEach((c) => {
            const v = row[c];
            values.push(v === undefined ? null : v);
          });
        });
        try {
          await client.query(`INSERT INTO citizens (${colList}) VALUES ${placeholders.join(', ')}`, values);
          imported += batch.length;
        } catch (err) {
          console.error('Batch insert error:', err.message);
          skipped += batch.length;
        }
      }

      // Individual UPDATE for existing rows (simple and reliable)
      for (const row of toUpdate) {
        try {
          const cols = Object.keys(row).filter((c) => c !== 'id_number');
          if (cols.length === 0) continue;
          const setClause = cols.map((c, idx) => `"${c}" = $${idx + 2}`).join(', ');
          await client.query(
            `UPDATE citizens SET ${setClause} WHERE LOWER(id_number) = LOWER($1)`,
            [row.id_number, ...cols.map((c) => row[c] == null ? null : row[c])]
          );
          updated++;
        } catch (err) {
          console.error('Update error:', err.message);
          skipped++;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ imported, updated, skipped, total: results.length, newColumns: [...new Set(newColumns)] });
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
