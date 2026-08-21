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

// Import citizens from CSV.
router.post('/import', async (req, res) => {
  try {
    if (!req.body || !req.body.csv) {
      return res.status(400).json({ error: 'Please provide CSV data.' });
    }

    const results = [];
    const errors = [];
    const stream = Readable.from(req.body.csv);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    let imported = 0;
    let skipped = 0;

    for (const row of results) {
      const name = (row.name || row.Name || '').trim();
      const id_number = (row.id_number || row.id_number || row['ID Number'] || row.ID || '').trim();

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
        await pool.query(
          `INSERT INTO citizens (name, id_number, phone, gender, spouse_name, spouse_id,
            num_other_persons, district, sector, cell, village, ics_serial,
            registration_date, address, place, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            name, id_number,
            (row.phone || row.Phone || '').trim(),
            (row.gender || row.Gender || '').trim(),
            (row.spouse_name || row['Spouse Name'] || '').trim(),
            (row.spouse_id || row['Spouse ID'] || '').trim(),
            row.num_other_persons || row['Num Other Persons'] || null,
            (row.district || row.District || '').trim(),
            (row.sector || row.Sector || '').trim(),
            (row.cell || row.Cell || '').trim(),
            (row.village || row.Village || '').trim(),
            (row.ics_serial || row['ICS Serial'] || '').trim(),
            row.registration_date || row['Registration Date'] || null,
            (row.address || row.Address || '').trim(),
            (row.place || row.Place || '').trim(),
            (row.notes || row.Notes || '').trim(),
          ]
        );
        imported++;
      } catch (err) {
        skipped++;
      }
    }

    res.json({ imported, skipped, total: results.length });
  } catch (err) {
    console.error('Import citizens error:', err.message);
    res.status(500).json({ error: 'Could not import citizens.' });
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

// Import citizens from CSV
router.post('/import', async (req, res) => {
  try {
    if (!req.body || !req.body.csv) {
      return res.status(400).json({ error: 'No CSV data provided.' });
    }

    const results = [];
    const errors = [];
    let lineNum = 0;

    const stream = Readable.from(req.body.csv);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          lineNum++;
          try {
            const name = (row.name || row.Name || '').trim();
            const id_number = (row.id_number || row.idNumber || row['ID Number'] || row['N° d\'identité'] || '').trim();
            
            if (!name || !id_number) {
              errors.push({ line: lineNum, error: 'Name and ID number are required.', row });
              return;
            }

            results.push({
              name,
              id_number,
              phone: (row.phone || row.Phone || row.Téléphone || '').trim(),
              gender: (row.gender || row.Gender || '').trim(),
              spouse_name: (row.spouse_name || row.spouseName || row['Spouse name'] || '').trim(),
              spouse_id: (row.spouse_id || row.spouseId || row['Spouse ID'] || '').trim(),
              num_other_persons: row.num_other_persons || row.numOtherPersons || row['Number of other persons'] || null,
              district: (row.district || row.District || '').trim(),
              sector: (row.sector || row.Sector || '').trim(),
              cell: (row.cell || row.Cell || '').trim(),
              village: (row.village || row.Village || '').trim(),
              ics_serial: (row.ics_serial || row.icsSerial || row['ICS Serial'] || '').trim(),
              registration_date: row.registration_date || row.registrationDate || row['Registration date'] || null,
              address: (row.address || row.Address || '').trim(),
              place: (row.place || row.Place || row.Lieu || '').trim(),
              notes: (row.notes || row.Notes || '').trim(),
            });
          } catch (err) {
            errors.push({ line: lineNum, error: err.message, row });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    let imported = 0;
    let skipped = 0;

    for (const record of results) {
      try {
        const dup = await pool.query(
          'SELECT id FROM citizens WHERE LOWER(id_number) = LOWER($1)',
          [record.id_number]
        );
        if (dup.rows.length > 0) {
          skipped++;
          errors.push({ line: results.indexOf(record) + 1, error: `ID number "${record.id_number}" already exists.`, row: record });
          continue;
        }

        await pool.query(
          `INSERT INTO citizens (
            name, id_number, phone, gender, spouse_name, spouse_id, num_other_persons,
            district, sector, cell, village, ics_serial, registration_date, address, place, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            record.name, record.id_number, record.phone, record.gender, record.spouse_name,
            record.spouse_id, record.num_other_persons === '' || record.num_other_persons == null ? null : record.num_other_persons,
            record.district, record.sector, record.cell, record.village, record.ics_serial,
            record.registration_date || null, record.address, record.place, record.notes,
          ]
        );
        imported++;
      } catch (err) {
        skipped++;
        errors.push({ line: results.indexOf(record) + 1, error: err.message, row: record });
      }
    }

    res.json({ imported, skipped, errors, total: results.length + errors.filter(e => e.error.includes('required')).length });
  } catch (err) {
    console.error('Import citizens error:', err.message);
    res.status(500).json({ error: 'Could not import citizens.' });
  }
});

module.exports = router;