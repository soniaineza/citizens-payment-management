const { pool } = require('./db');

(async () => {
  const { rowCount } = await pool.query('DELETE FROM users');
  console.log(`Deleted ${rowCount} user(s). You can now register the first account.`);
  await pool.end();
})();
