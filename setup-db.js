// One-time setup: creates the application database if it does not exist.
const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const dbName = process.env.DB_NAME || 'citizen_register';
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: 'postgres',
  });
  await client.connect();
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rows.length === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database "${dbName}".`);
  } else {
    console.log(`Database "${dbName}" already exists.`);
  }
  await client.end();
}

run().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});