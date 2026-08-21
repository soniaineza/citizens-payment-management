const { pool } = require('../db');

function roleRequired(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      if (rows.length === 0) return res.status(401).json({ error: 'User not found.' });
      req.userRole = rows[0].role;
      if (!allowedRoles.includes(req.userRole)) {
        return res.status(403).json({ error: 'You do not have permission to do that.' });
      }
      next();
    } catch (err) {
      console.error('Role check error:', err.message);
      res.status(500).json({ error: 'Permission check failed.' });
    }
  };
}

module.exports = { roleRequired };
