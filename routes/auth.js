const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#22c55e', '#14b8a6', '#0ea5e9'];

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, workspaceName } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, senha e nome são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const existing = await req.db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const client = await req.db.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, name, avatar_color) VALUES ($1, $2, $3, $4) RETURNING id, email, name, avatar_color',
        [email.toLowerCase(), hash, name, avatarColor]
      );
      const user = userResult.rows[0];

      const wsName = workspaceName || `${name}'s Workspace`;
      let slug = slugify(wsName);
      const slugCheck = await client.query('SELECT id FROM workspaces WHERE slug = $1', [slug]);
      if (slugCheck.rows.length > 0) slug = `${slug}-${Date.now()}`;

      const wsResult = await client.query(
        'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
        [wsName, slug]
      );
      const workspace = wsResult.rows[0];

      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspace.id, user.id, 'OWNER']
      );

      const invites = await client.query(
        'SELECT workspace_id, role FROM workspace_invites WHERE email = $1 AND expires_at > NOW()',
        [email.toLowerCase()]
      );
      for (const inv of invites.rows) {
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO NOTHING`,
          [inv.workspace_id, user.id, inv.role]
        );
        await client.query('DELETE FROM workspace_invites WHERE workspace_id = $1 AND email = $2', [
          inv.workspace_id,
          email.toLowerCase(),
        ]);
      }

      await client.query('COMMIT');

      req.session.userId = user.id;
      res.json({ user, workspace });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const result = await req.db.query(
      'SELECT id, email, name, avatar_color, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    req.session.userId = user.id;
    delete user.password_hash;
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userResult = await req.db.query(
      'SELECT id, email, name, avatar_color, created_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const workspaces = await req.db.query(
      `SELECT w.id, w.name, w.slug, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1
       ORDER BY w.name`,
      [req.session.userId]
    );

    res.json({ user: userResult.rows[0], workspaces: workspaces.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

module.exports = router;
