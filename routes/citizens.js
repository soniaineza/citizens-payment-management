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
      name: 'name', 'full name': 'name', 'nom': 'name', 'nom complet': 'name',
      'citizen name': 'name', 'citizen_name': 'name', 'iname': 'name',
      'head of hh': 'name', 'head of household': 'name', 'name of head of hh': 'name',
      'name of head': 'name', 'head': 'name', 'chef': 'name', 'household': 'name',
      id_number: 'id_number', 'id number': 'id_number', id: 'id_number',
      'id no': 'id_number', 'id no.': 'id_number',
      'numéro d\'identité': 'id_number', 'n° d\'identité': 'id_number',
      'numéro identification': 'id_number', nid: 'id_number', nin: 'id_number',
      identification: 'id_number', identity: 'id_number',
      'citizen_id': 'id_number', 'citizen id': 'id_number',
      'num_citizen': 'id_number', 'num citizen': 'id_number',
      'numéro': 'id_number', 'identité': 'id_number',
      phone: 'phone', telephone: 'phone', tel: 'phone',
      'phone number': 'phone', 'numéro de téléphone': 'phone', 'tel number': 'phone',
      gender: 'gender', genre: 'gender', sexe: 'gender',
      'gender (m/f)': 'gender', 'genre (h/f)': 'gender',
      spouse_name: 'spouse_name', 'spouse name': 'spouse_name',
      'nom du conjoint': 'spouse_name', 'conjoint': 'spouse_name',
      spouse_id: 'spouse_id', 'spouse id': 'spouse_id',
      'id conjoint': 'spouse_id', 'identité conjoint': 'spouse_id',
      num_other_persons: 'num_other_persons', 'num other persons': 'num_other_persons',
      'number of other persons in hh': 'num_other_persons',
      'number of other persons': 'num_other_persons',
      'nombre personnes': 'num_other_persons', 'persons': 'num_other_persons',
      district: 'district', secteur: 'district',
      sector: 'sector',
      cell: 'cell', cellule: 'cell',
      village: 'village',
      ics_serial: 'ics_serial', 'ics serial': 'ics_serial',
      icsserilnumber: 'ics_serial', 'ics_serial_number': 'ics_serial',
      'numéro ics': 'ics_serial', 'n° ics': 'ics_serial',
      'serial number': 'ics_serial', 'serial': 'ics_serial',
      registration_date: 'registration_date', 'registration date': 'registration_date',
      'date enregistrement': 'registration_date', 'date inscription': 'registration_date',
      date: 'registration_date',
      address: 'address', adresse: 'address',
      place: 'place', lieu: 'place', location: 'place',
      notes: 'notes', remarques: 'notes', observation: 'notes',
      no: 'no', 'num': 'no', 'number': 'no', '#': 'no',
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
    let updated = 0;
    let skipped = 0;

    for (const row of results) {
      // Find name from any variant header
      let name = '';
      let id_number = '';
      for (const [key, val] of Object.entries(row)) {
        const normalized = key.toLowerCase().trim().replace(/[^a-z0-9àâçéèêëîïôùûüÿæœ\s]/g, '');
        const mapped = headerMap[key] || '';
        if (mapped === 'name' && !name) name = String(val || '').trim();
        if (mapped === 'id_number' && !id_number) id_number = String(val || '').trim();
      }
      // Fallback: try common header names directly
      if (!name) name = (row.name || row.Name || row.full_name || row['Full Name'] || row.nom || row['Nom complet'] || '').trim();
      if (!id_number) id_number = (row.id_number || row['ID Number'] || row.ID || row.id || row.nid || row.nin || row.NID || row.NIN || '').trim();

      if (!name || !id_number) {
        skipped++;
        continue;
      }

      // Build column/value pairs using headerMap
      const getField = (row, ...keys) => {
        for (const [key, val] of Object.entries(row)) {
          const mapped = headerMap[key] || '';
          if (keys.includes(mapped)) return String(val || '').trim();
        }
        return '';
      };
      const getFieldRaw = (row, ...rawKeys) => {
        for (const k of rawKeys) {
          if (row[k]) return String(row[k]).trim();
        }
        return '';
      };

      const colValPairs = [
        { col: 'name', val: name },
        { col: 'id_number', val: id_number },
        { col: 'phone', val: getField(row, 'phone') || getFieldRaw(row, 'phone', 'Phone', 'phone number', 'téléphone', 'Téléphone', 'tel', 'Tel') },
        { col: 'gender', val: getField(row, 'gender') || getFieldRaw(row, 'gender', 'Gender', 'gender (m/f)', 'genre', 'Genre', 'sexe', 'Sexe') },
        { col: 'spouse_name', val: getField(row, 'spouse_name') || getFieldRaw(row, 'spouse_name', 'Spouse Name', 'Spouse name', 'nom du conjoint', 'conjoint') },
        { col: 'spouse_id', val: getField(row, 'spouse_id') || getFieldRaw(row, 'spouse_id', 'Spouse ID', 'Spouse id', 'id conjoint', 'identité conjoint') },
        { col: 'num_other_persons', val: getField(row, 'num_other_persons') || getFieldRaw(row, 'num_other_persons', 'Num Other Persons', 'number of other persons in hh', 'number of other persons', 'nombre personnes', 'persons') || null },
        { col: 'district', val: getField(row, 'district') || getFieldRaw(row, 'district', 'District', 'secteur') },
        { col: 'sector', val: getField(row, 'sector') || getFieldRaw(row, 'sector', 'Sector', 'Secteur') },
        { col: 'cell', val: getField(row, 'cell') || getFieldRaw(row, 'cell', 'Cell', 'Cellule') },
        { col: 'village', val: getField(row, 'village') || getFieldRaw(row, 'village', 'Village') },
        { col: 'ics_serial', val: getField(row, 'ics_serial') || getFieldRaw(row, 'ics_serial', 'ICS Serial', 'ics serial', 'icsserilnumber', 'ics_serial_number', 'serial number', 'numéro ics', 'n° ics') },
        { col: 'registration_date', val: getField(row, 'registration_date') || getFieldRaw(row, 'registration_date', 'Registration Date', 'date', 'date enregistrement', 'date inscription') || null },
        { col: 'address', val: getField(row, 'address') || getFieldRaw(row, 'address', 'Address', 'Adresse') },
        { col: 'place', val: getField(row, 'place') || getFieldRaw(row, 'place', 'Place', 'Lieu', 'Location') },
        { col: 'notes', val: getField(row, 'notes') || getFieldRaw(row, 'notes', 'Notes', 'Remarques', 'Observation') },
      ];

      // Add any custom/dynamic columns
      for (const header of Object.keys(row)) {
        const normalized = header.toLowerCase().trim();
        const mapped = headerMap[header];
        if (mapped && !knownColumns[normalized] && finalCols.has(mapped)) {
          colValPairs.push({ col: `"${mapped}"`, val: row[header] || '' });
        }
      }

      // Filter to only columns that exist
      const validPairs = colValPairs.filter((p) => {
        const bare = p.col.replace(/"/g, '');
        return finalCols.has(bare) || p.col.includes('"');
      });

      try {
        const cols = validPairs.map((p) => `"${p.col.replace(/"/g, '')}"`);
        const vals = validPairs.map((p) => typeof p.val === 'string' ? p.val.trim() : p.val);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const updateSet = cols.slice(2).map((c, i) => `${c} = $${i + 3}`).join(', ');

        const existing = await pool.query(
          'SELECT id FROM citizens WHERE LOWER(id_number) = LOWER($1)',
          [id_number]
        );

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE citizens SET ${updateSet} WHERE LOWER(id_number) = LOWER($1)`,
            [id_number, ...vals.slice(2)]
          );
          updated++;
        } else {
          await pool.query(
            `INSERT INTO citizens (${cols.join(', ')}) VALUES (${placeholders})`,
            vals
          );
          imported++;
        }
      } catch (err) {
        console.error('Import row error:', err.message);
        skipped++;
      }
    }

    res.json({ imported, updated, skipped, total: results.length, newColumns });
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