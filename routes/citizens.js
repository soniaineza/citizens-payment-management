const express = require('express');
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