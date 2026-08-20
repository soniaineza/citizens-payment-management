const express = require('express');
const { pool } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

// Overall dashboard numbers.
router.get('/summary', async (req, res) => {
  try {
    const citizens = await pool.query('SELECT COUNT(*)::int AS total FROM citizens');
    const paid = await pool.query(`
      SELECT COUNT(DISTINCT p.citizen_id)::int AS total FROM payments p
    `);
    const collected = await pool.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments');
    const unpaid = await pool.query(`
      SELECT COUNT(*)::int AS total FROM citizens c
      WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.citizen_id = c.id)
    `);
    res.json({
      total_citizens: citizens.rows[0].total,
      paid_citizens: paid.rows[0].total,
      unpaid_citizens: unpaid.rows[0].total,
      total_collected: parseFloat(collected.rows[0].total),
    });
  } catch (err) {
    console.error('Summary error:', err.message);
    res.status(500).json({ error: 'Could not load summary.' });
  }
});

// Filtered payments report with totals.
// ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?place=
router.get('/payments', async (req, res) => {
  try {
    const { from, to, place } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;

    if (from) {
      conditions.push(`p.payment_date >= $${i++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`p.payment_date <= $${i++}`);
      params.push(to);
    }
    if (place) {
      conditions.push(`p.place ILIKE $${i++}`);
      params.push(`%${place}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rowsRes = await pool.query(
      `SELECT p.id, p.amount, p.payment_date, p.place, p.method,
              c.name AS citizen_name, c.id_number
       FROM payments p JOIN citizens c ON c.id = p.citizen_id
       ${where}
       ORDER BY p.payment_date DESC`,
      params
    );

    const totalsRes = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(p.amount), 0) AS total,
              COALESCE(MIN(p.payment_date)::text, '') AS earliest,
              COALESCE(MAX(p.payment_date)::text, '') AS latest
       FROM payments p ${where}`,
      params
    );

    res.json({
      payments: rowsRes.rows,
      totals: {
        count: totalsRes.rows[0].count,
        total: parseFloat(totalsRes.rows[0].total),
        earliest: totalsRes.rows[0].earliest,
        latest: totalsRes.rows[0].latest,
      },
    });
  } catch (err) {
    console.error('Payments report error:', err.message);
    res.status(500).json({ error: 'Could not load report.' });
  }
});

// Revenue grouped by place.
router.get('/by-place', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;
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
      `SELECT COALESCE(NULLIF(p.place, ''), 'Unknown') AS place,
              COUNT(*)::int AS count,
              COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       ${where}
       GROUP BY 1
       ORDER BY total DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('By-place report error:', err.message);
    res.status(500).json({ error: 'Could not load report.' });
  }
});

// Revenue grouped by month.
router.get('/monthly', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let i = 1;
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
      `SELECT TO_CHAR(p.payment_date, 'YYYY-MM') AS month,
              COUNT(*)::int AS count,
              COALESCE(SUM(p.amount), 0) AS total
       FROM payments p
       ${where}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('Monthly report error:', err.message);
    res.status(500).json({ error: 'Could not load report.' });
  }
});

module.exports = router;