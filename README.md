# Citizen Register

A simple web app to register citizens, track who has paid, and view financial reports.
Built for a non-technical user (a finance professional), so everything is kept simple:
big buttons, clear labels, search boxes, and ready-made reports.

## Features

- **Sign in** — the first account you create is the admin account. No one else can sign up.
- **Citizens** — add, edit, delete and search citizens by name, ID number or phone.
  Each citizen shows a green **Paid** or red **Unpaid** badge.
- **Payments** — record who paid, how much, when, where and how (cash, bank, mobile money…).
- **Reports** — filter by date range and place:
  - Totals: payments count, total collected, average payment, period covered
  - Breakdown by place and by month
  - Payment details table
  - **Export to CSV** (opens in Excel) with one click

## Tech stack

- Frontend: React (create-react-app) + Bootstrap
- Backend: Node.js + Express
- Database: PostgreSQL
- Auth: JWT + bcrypt

## Local setup (Windows)

You need [Node.js](https://nodejs.org) and [PostgreSQL](https://www.postgresql.org/download/)
installed and running.

```bash
# 1. Install backend dependencies
npm install

# 2. Install frontend dependencies
cd client
npm install
cd ..

# 3. Copy the example config and adjust your database password
copy .env.example .env
```

Open `.env` and set `DB_USER`, `DB_PASSWORD` (and `JWT_SECRET` to a long random string).

```bash
# 4. Create the database (only needed the first time)
npm run setup

# 5. Run the tests to make sure everything works
npm test
```

## Running locally

**Development** (auto-reloads on changes):

```bash
npm run dev
```

- App: http://localhost:3000
- API: http://localhost:5000

**Production mode** (serves the built app from the same server):

```bash
npm run client-build   # build the React app (first time / after UI changes)
npm start              # then start the server
```

Open http://localhost:5000, click **Create the first account** and you're in.

## Deployment (hosted online)

The simplest option is [Render](https://render.com) — one service hosts everything.

1. Push this folder to a GitHub repository.
2. In Render, create a **PostgreSQL** database and copy its *Internal Database URL*.
3. Create a **Web Service** from the repo:
   - Build command: `npm install && cd client && npm install && npm run build`
   - Start command: `node server.js`
   - Environment variables:
     - `DATABASE_URL` → the PostgreSQL URL from step 2
     - `JWT_SECRET` → a long random string
     - `NODE_ENV` → `production`
4. Deploy. Your dad gets a normal https link to use anywhere.

> Note: the app reads either `DATABASE_URL` (when set) or the individual `DB_HOST`,
> `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` variables. For Render, just set
> `DATABASE_URL`.

## Project layout

```
server.js            Express server (API + serves the built app)
db.js                Database connection and table setup
setup-db.js          Creates the database (first time only)
routes/
  auth.js            Register, login
  citizens.js        Citizen management
  payments.js        Payment management
  reports.js         Summaries and reports
middleware/auth.js   JWT protection
client/              React app
server.test.js       API integration tests
```