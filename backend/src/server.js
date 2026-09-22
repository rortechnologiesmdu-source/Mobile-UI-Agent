require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB } = require('./config/db');
const ingestRouter = require('./routes/ingest');
const dashboardRouter = require('./routes/dashboard');
const agent2Router = require('./routes/agent2');

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '15mb' })); // screenshots as base64 can be a few MB

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/ingest', ingestRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/agent2', agent2Router);

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[server] failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
