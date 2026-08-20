process.env.DB_NAME = process.env.TEST_DB_NAME || 'citizen_register_test';

const { Client } = require('pg');
const request = require('supertest');
const { init } = require('./db');
const app = require('./server');

const TEST_DB = process.env.DB_NAME;

beforeAll(async () => {
  const admin = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: 'postgres',
  });
  await admin.connect();
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (rows.length === 0) {
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  }
  await admin.end();
  await init();
  const { pool } = require('./db');
  await pool.query('TRUNCATE payments, citizens, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  const { pool } = require('./db');
  await pool.end();
});

const uniq = Date.now();
const email = `admin${uniq}@test.com`;
let token = '';
let citizenId = null;

describe('Citizen Register API', () => {
  test('health endpoint works', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('protected routes reject anonymous users', async () => {
    const res = await request(app).get('/api/citizens');
    expect(res.statusCode).toBe(401);
  });

  test('register creates the first account', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Admin',
      email,
      password: 'secret123',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toBeTruthy();
  });

  test('second public registration is blocked', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Intruder',
      email: `intruder${uniq}@test.com`,
      password: 'secret123',
    });
    expect(res.statusCode).toBe(403);
  });

  test('login with wrong password is rejected', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    expect(res.statusCode).toBe(401);
  });

  test('login with correct password returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'secret123' });
    expect(res.statusCode).toBe(200);
    token = res.body.token;
  });

  test('create a citizen', async () => {
    const res = await request(app)
      .post('/api/citizens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jean Paul', id_number: `ID${uniq}`, place: 'Kigali', phone: '0788' });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Jean Paul');
    citizenId = res.body.id;
  });

  test('duplicate ID number is rejected', async () => {
    const res = await request(app)
      .post('/api/citizens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Copy', id_number: `ID${uniq}` });
    expect(res.statusCode).toBe(409);
  });

  test('list citizens shows payment status', async () => {
    const res = await request(app)
      .get('/api/citizens')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const c = res.body.find((x) => x.id === citizenId);
    expect(c.payment_count).toBe(0);
    expect(c.total_paid).toBe('0');
  });

  test('record a payment', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ citizen_id: citizenId, amount: 25000, payment_date: '2026-08-20', place: 'Kigali' });
    expect(res.statusCode).toBe(201);
    expect(Number(res.body.amount)).toBe(25000);
  });

  test('reject a negative payment amount', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ citizen_id: citizenId, amount: -5 });
    expect(res.statusCode).toBe(400);
  });

  test('citizen now shows as paid', async () => {
    const res = await request(app)
      .get('/api/citizens')
      .set('Authorization', `Bearer ${token}`);
    const c = res.body.find((x) => x.id === citizenId);
    expect(c.payment_count).toBe(1);
    expect(Number(c.total_paid)).toBe(25000);
  });

  test('summary reports the right totals', async () => {
    const res = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.total_citizens).toBeGreaterThanOrEqual(1);
    expect(res.body.paid_citizens).toBeGreaterThanOrEqual(1);
    expect(res.body.total_collected).toBeGreaterThanOrEqual(25000);
  });

  test('payments report filters by date', async () => {
    const res = await request(app)
      .get('/api/reports/payments?from=2026-08-01&to=2026-08-31&place=Kigali')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.totals.count).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.total).toBeGreaterThanOrEqual(25000);
  });

  test('revenue by place', async () => {
    const res = await request(app)
      .get('/api/reports/by-place')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const kigali = res.body.find((p) => p.place === 'Kigali');
    expect(kigali).toBeTruthy();
  });

  test('monthly revenue', async () => {
    const res = await request(app)
      .get('/api/reports/monthly')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('delete a payment', async () => {
    const list = await request(app)
      .get(`/api/payments?citizen_id=${citizenId}`)
      .set('Authorization', `Bearer ${token}`);
    const payment = list.body[0];
    const res = await request(app)
      .delete(`/api/payments/${payment.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('delete a citizen', async () => {
    const res = await request(app)
      .delete(`/api/citizens/${citizenId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });
});