const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { pool, init } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure the database schema is ready before handling API requests.
// Needed on serverless (Vercel) where init() is not called on boot.
let dbReady = null;
app.use('/api', async (req, res, next) => {
  try {
    if (!dbReady) dbReady = init();
    await dbReady;
    next();
  } catch (err) {
    console.error('Database init failed:', err.message);
    res.status(500).json({ error: 'Database is not ready.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/citizens', require('./routes/citizens'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports', require('./routes/reports'));

// Serve the built React app from the client folder when it exists (local prod build or Vercel).
const fs = require('fs');
const clientBuild = path.join(__dirname, 'client', 'build');
if (fs.existsSync(path.join(clientBuild, 'index.html'))) {
  app.use(express.static(clientBuild));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Not found.' });
  } else {
    res.send('Citizen Register API is running. Start the React client for the full app.');
  }
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  init()
    .then(() => {
      app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to initialise database:', err.message);
      process.exit(1);
    });
}

module.exports = app;
module.exports.pool = pool;