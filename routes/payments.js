const express = require('express');
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