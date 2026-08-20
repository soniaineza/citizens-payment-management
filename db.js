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
        gender TEXT,
        spouse_name TEXT,
        spouse_id TEXT,
        num_other_persons INTEGER,
        district TEXT,
        sector TEXT,
        cell TEXT,
        village TEXT,
        ics_serial TEXT,
        registration_date DATE,
        address TEXT,
        place TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE citizens
        ADD COLUMN IF NOT EXISTS gender TEXT,
        ADD COLUMN IF NOT EXISTS spouse_name TEXT,
        ADD COLUMN IF NOT EXISTS spouse_id TEXT,
        ADD COLUMN IF NOT EXISTS num_other_persons INTEGER,
        ADD COLUMN IF NOT EXISTS district TEXT,
        ADD COLUMN IF NOT EXISTS sector TEXT,
        ADD COLUMN IF NOT EXISTS cell TEXT,
        ADD COLUMN IF NOT EXISTS village TEXT,
        ADD COLUMN IF NOT EXISTS ics_serial TEXT,
        ADD COLUMN IF NOT EXISTS registration_date DATE;

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

    // Enforce case-insensitive ID uniqueness at the database level too.
    // Wrapped so the app still starts if pre-existing data already has
    // near-duplicate IDs (the API-level check above still blocks new ones).
    try {
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_citizens_id_number_lower ON citizens (LOWER(id_number))');
    } catch (e) {
      console.warn('Could not create case-insensitive unique index on citizens.id_number:', e.message);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, init };