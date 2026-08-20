const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'citizen_register',
    });

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS citizens (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        id_number TEXT UNIQUE NOT NULL,
        phone TEXT,
        address TEXT,
        place TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        place TEXT,
        method TEXT NOT NULL DEFAULT 'Cash',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_payments_citizen ON payments(citizen_id);
      CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
      CREATE INDEX IF NOT EXISTS idx_citizens_place ON citizens(place);
    `);
  } finally {
    client.release();
  }
}

module.exports = { pool, init };