require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    },
  })
);
app.use((req, res, next) => {
  req.db = pool;
  next();
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

app.listen(PORT, () => {
  console.log(`CommitTime rodando em http://localhost:${PORT}`);
});
