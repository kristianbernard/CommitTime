require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  let sessionStore;

  if (process.env.DATABASE_URL) {
    try {
      const pgSession = require('connect-pg-simple')(session);
      sessionStore = new pgSession({
        pool,
        tableName: 'session',
        createTableIfMissing: true,
      });
    } catch (err) {
      console.error('Aviso: sessão PostgreSQL indisponível, usando memória:', err.message);
    }
  }

  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'dev-secret',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
      },
    })
  );

  app.use((req, res, next) => {
    req.db = pool;
    next();
  });

  app.get('/api/health', async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({ ok: false, error: 'DATABASE_URL não configurada' });
      }
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'connected', env: isProduction ? 'production' : 'development' });
    } catch (err) {
      console.error('Health check failed:', err.message);
      res.status(500).json({ ok: false, db: 'error', error: err.message });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', apiRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Rota da API não encontrada' });
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`CommitTime rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
