const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireWorkspaceMember, requireAdmin } = require('../middleware/auth');
const {
  parseReportDates,
  fetchReportEntries,
  buildCsv,
  streamPdf,
} = require('../lib/report-export');

const router = express.Router();

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ─── Workspaces ───────────────────────────────────────────────

router.post('/workspaces', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    let slug = slugify(name);
    const slugCheck = await req.db.query('SELECT id FROM workspaces WHERE slug = $1', [slug]);
    if (slugCheck.rows.length > 0) slug = `${slug}-${Date.now()}`;

    const client = await req.db.connect();
    try {
      await client.query('BEGIN');
      const ws = await client.query(
        'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING *',
        [name, slug]
      );
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [ws.rows[0].id, req.session.userId, 'OWNER']
      );
      await client.query('COMMIT');
      res.json(ws.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar workspace' });
  }
});

router.get('/workspaces/:workspaceId/members', requireAuth, requireWorkspaceMember, async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT u.id, u.name, u.email, u.avatar_color, wm.role, wm.joined_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY wm.role, u.name`,
      [req.workspaceId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar membros' });
  }
});

router.post('/workspaces/:workspaceId/invite', requireAuth, requireWorkspaceMember, requireAdmin, async (req, res) => {
  try {
    const { email, role = 'MEMBER' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' });

    const userCheck = await req.db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userCheck.rows.length > 0) {
      const existing = await req.db.query(
        'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [req.workspaceId, userCheck.rows[0].id]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Usuário já é membro deste workspace' });
      }
      await req.db.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [req.workspaceId, userCheck.rows[0].id, role]
      );
      return res.json({ message: 'Membro adicionado com sucesso' });
    }

    const token = uuidv4().replace(/-/g, '');
    await req.db.query(
      `INSERT INTO workspace_invites (workspace_id, email, role, invited_by, token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, email) DO UPDATE SET token = $5, expires_at = NOW() + INTERVAL '7 days'`,
      [req.workspaceId, email.toLowerCase(), role, req.session.userId, token]
    );
    res.json({ message: 'Convite registrado. O usuário será adicionado ao se cadastrar com este email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao convidar membro' });
  }
});

router.patch('/workspaces/:workspaceId/members/:userId', requireAuth, requireWorkspaceMember, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const { userId } = req.params;
    if (!['ADMIN', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: 'Role inválida' });
    }
    const target = await req.db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [req.workspaceId, userId]
    );
    if (target.rows.length === 0) return res.status(404).json({ error: 'Membro não encontrado' });
    if (target.rows[0].role === 'OWNER') return res.status(403).json({ error: 'Não é possível alterar o dono' });

    await req.db.query(
      'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3',
      [role, req.workspaceId, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar membro' });
  }
});

router.delete('/workspaces/:workspaceId/members/:userId', requireAuth, requireWorkspaceMember, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Você não pode remover a si mesmo' });
    }
    const target = await req.db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [req.workspaceId, userId]
    );
    if (target.rows.length === 0) return res.status(404).json({ error: 'Membro não encontrado' });
    if (target.rows[0].role === 'OWNER') return res.status(403).json({ error: 'Não é possível remover o dono' });

    await req.db.query(
      'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [req.workspaceId, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// ─── Clients ──────────────────────────────────────────────────

router.get('/workspaces/:workspaceId/clients', requireAuth, requireWorkspaceMember, async (req, res) => {
  const result = await req.db.query(
    'SELECT * FROM clients WHERE workspace_id = $1 ORDER BY name',
    [req.workspaceId]
  );
  res.json(result.rows);
});

router.post('/workspaces/:workspaceId/clients', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const result = await req.db.query(
    'INSERT INTO clients (workspace_id, name, email) VALUES ($1, $2, $3) RETURNING *',
    [req.workspaceId, name, email || null]
  );
  res.json(result.rows[0]);
});

// ─── Projects ─────────────────────────────────────────────────

router.get('/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { archived } = req.query;
  let query = `
    SELECT p.*, c.name as client_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'ACTIVE') as active_tasks
    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.workspace_id = $1`;
  const params = [req.workspaceId];
  if (archived === 'true') {
    query += ' AND p.archived = true';
  } else if (archived !== 'all') {
    query += ' AND p.archived = false';
  }
  query += ' ORDER BY p.name';
  const result = await req.db.query(query, params);
  res.json(result.rows);
});

router.post('/workspaces/:workspaceId/projects', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { name, color, clientId, billable, hourlyRate } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const result = await req.db.query(
    `INSERT INTO projects (workspace_id, client_id, name, color, billable, hourly_rate)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.workspaceId, clientId || null, name, color || '#03A9F4', billable || false, hourlyRate || null]
  );
  res.json(result.rows[0]);
});

router.patch('/projects/:projectId', requireAuth, async (req, res) => {
  const { projectId } = req.params;
  const access = await req.db.query(
    `SELECT p.* FROM projects p
     JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = $1 AND wm.user_id = $2`,
    [projectId, req.session.userId]
  );
  if (access.rows.length === 0) return res.status(403).json({ error: 'Sem acesso' });

  const { name, color, clientId, billable, hourlyRate, archived } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
  if (color !== undefined) { fields.push(`color = $${i++}`); values.push(color); }
  if (clientId !== undefined) { fields.push(`client_id = $${i++}`); values.push(clientId || null); }
  if (billable !== undefined) { fields.push(`billable = $${i++}`); values.push(billable); }
  if (hourlyRate !== undefined) { fields.push(`hourly_rate = $${i++}`); values.push(hourlyRate); }
  if (archived !== undefined) { fields.push(`archived = $${i++}`); values.push(archived); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

  values.push(projectId);
  const result = await req.db.query(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
});

// ─── Tasks ────────────────────────────────────────────────────

router.get('/projects/:projectId/tasks', requireAuth, async (req, res) => {
  const access = await req.db.query(
    `SELECT p.id FROM projects p
     JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = $1 AND wm.user_id = $2`,
    [req.params.projectId, req.session.userId]
  );
  if (access.rows.length === 0) return res.status(403).json({ error: 'Sem acesso' });

  const result = await req.db.query(
    'SELECT * FROM tasks WHERE project_id = $1 ORDER BY status, name',
    [req.params.projectId]
  );
  res.json(result.rows);
});

router.post('/projects/:projectId/tasks', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

  const access = await req.db.query(
    `SELECT p.id FROM projects p
     JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = $1 AND wm.user_id = $2`,
    [req.params.projectId, req.session.userId]
  );
  if (access.rows.length === 0) return res.status(403).json({ error: 'Sem acesso' });

  const result = await req.db.query(
    'INSERT INTO tasks (project_id, name) VALUES ($1, $2) RETURNING *',
    [req.params.projectId, name]
  );
  res.json(result.rows[0]);
});

// ─── Tags ─────────────────────────────────────────────────────

router.get('/workspaces/:workspaceId/tags', requireAuth, requireWorkspaceMember, async (req, res) => {
  const result = await req.db.query(
    'SELECT * FROM tags WHERE workspace_id = $1 ORDER BY name',
    [req.workspaceId]
  );
  res.json(result.rows);
});

router.post('/workspaces/:workspaceId/tags', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const result = await req.db.query(
    'INSERT INTO tags (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING *',
    [req.workspaceId, name, color || '#94a3b8']
  );
  res.json(result.rows[0]);
});

// ─── Time Entries ─────────────────────────────────────────────

router.get('/workspaces/:workspaceId/time-entries', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { start, end, userId, projectId } = req.query;
  let query = `
    SELECT te.*, p.name as project_name, p.color as project_color,
           t.name as task_name, u.name as user_name, u.avatar_color as user_avatar_color,
           COALESCE(
             (SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color))
              FROM time_entry_tags tet JOIN tags tg ON tg.id = tet.tag_id
              WHERE tet.time_entry_id = te.id), '[]'
           ) as tags
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN tasks t ON t.id = te.task_id
    JOIN users u ON u.id = te.user_id
    WHERE te.workspace_id = $1`;
  const params = [req.workspaceId];
  let i = 2;

  if (start) { query += ` AND te.start_time >= $${i++}`; params.push(start); }
  if (end) { query += ` AND te.start_time <= $${i++}`; params.push(end); }
  if (userId) { query += ` AND te.user_id = $${i++}`; params.push(userId); }
  if (projectId) { query += ` AND te.project_id = $${i++}`; params.push(projectId); }

  query += ' ORDER BY te.start_time DESC LIMIT 500';
  const result = await req.db.query(query, params);
  res.json(result.rows);
});

router.get('/time-entries/running', requireAuth, async (req, res) => {
  const result = await req.db.query(
    `SELECT te.*, p.name as project_name, p.color as project_color, t.name as task_name
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     LEFT JOIN tasks t ON t.id = te.task_id
     WHERE te.user_id = $1 AND te.end_time IS NULL
     ORDER BY te.start_time DESC LIMIT 1`,
    [req.session.userId]
  );
  res.json(result.rows[0] || null);
});

router.post('/workspaces/:workspaceId/time-entries', requireAuth, requireWorkspaceMember, async (req, res) => {
  const { description, projectId, taskId, startTime, endTime, billable, tagIds } = req.body;

  const running = await req.db.query(
    'SELECT id FROM time_entries WHERE user_id = $1 AND end_time IS NULL',
    [req.session.userId]
  );
  if (running.rows.length > 0) {
    return res.status(400).json({ error: 'Já existe um timer em execução. Pare-o antes de criar outro.' });
  }

  const start = startTime || new Date().toISOString();

  let isBillable = billable || false;
  if (projectId && billable === undefined) {
    const proj = await req.db.query('SELECT billable FROM projects WHERE id = $1', [projectId]);
    if (proj.rows.length > 0) isBillable = proj.rows[0].billable;
  }

  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO time_entries (user_id, workspace_id, project_id, task_id, description, start_time, end_time, billable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.session.userId, req.workspaceId, projectId || null, taskId || null,
       description || '', start, endTime || null, isBillable]
    );
    const entry = result.rows[0];

    if (tagIds && tagIds.length > 0) {
      for (const tagId of tagIds) {
        await client.query(
          'INSERT INTO time_entry_tags (time_entry_id, tag_id) VALUES ($1, $2)',
          [entry.id, tagId]
        );
      }
    }
    await client.query('COMMIT');
    res.json(entry);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.patch('/time-entries/:entryId', requireAuth, async (req, res) => {
  const { entryId } = req.params;
  const entry = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
  if (entry.rows.length === 0) return res.status(404).json({ error: 'Entrada não encontrada' });

  const e = entry.rows[0];
  const member = await req.db.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [e.workspace_id, req.session.userId]
  );
  if (member.rows.length === 0) return res.status(403).json({ error: 'Sem acesso' });
  if (e.user_id !== req.session.userId && !['OWNER', 'ADMIN'].includes(member.rows[0].role)) {
    return res.status(403).json({ error: 'Sem permissão para editar' });
  }

  const { description, projectId, taskId, startTime, endTime, billable } = req.body;
  const fields = ['updated_at = NOW()'];
  const values = [];
  let i = 1;
  if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description); }
  if (projectId !== undefined) { fields.push(`project_id = $${i++}`); values.push(projectId || null); }
  if (taskId !== undefined) { fields.push(`task_id = $${i++}`); values.push(taskId || null); }
  if (startTime !== undefined) { fields.push(`start_time = $${i++}`); values.push(startTime); }
  if (endTime !== undefined) { fields.push(`end_time = $${i++}`); values.push(endTime); }
  if (billable !== undefined) { fields.push(`billable = $${i++}`); values.push(billable); }

  values.push(entryId);
  const result = await req.db.query(
    `UPDATE time_entries SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
});

router.post('/time-entries/:entryId/stop', requireAuth, async (req, res) => {
  const { entryId } = req.params;
  const entry = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
  if (entry.rows.length === 0) return res.status(404).json({ error: 'Entrada não encontrada' });
  if (entry.rows[0].user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Só você pode parar seu próprio timer' });
  }
  if (entry.rows[0].end_time) {
    return res.status(400).json({ error: 'Timer já foi parado' });
  }

  const result = await req.db.query(
    'UPDATE time_entries SET end_time = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
    [entryId]
  );
  res.json(result.rows[0]);
});

router.delete('/time-entries/:entryId', requireAuth, async (req, res) => {
  const { entryId } = req.params;
  const entry = await req.db.query('SELECT * FROM time_entries WHERE id = $1', [entryId]);
  if (entry.rows.length === 0) return res.status(404).json({ error: 'Entrada não encontrada' });

  const e = entry.rows[0];
  const member = await req.db.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [e.workspace_id, req.session.userId]
  );
  if (member.rows.length === 0) return res.status(403).json({ error: 'Sem acesso' });
  if (e.user_id !== req.session.userId && !['OWNER', 'ADMIN'].includes(member.rows[0].role)) {
    return res.status(403).json({ error: 'Sem permissão para excluir' });
  }

  await req.db.query('DELETE FROM time_entries WHERE id = $1', [entryId]);
  res.json({ ok: true });
});

// ─── Reports ──────────────────────────────────────────────────

const DURATION_EXPR = 'EXTRACT(EPOCH FROM (COALESCE(te.end_time, NOW()) - te.start_time))';
const AMOUNT_EXPR = `CASE
  WHEN p.hourly_rate IS NOT NULL AND (te.billable OR p.billable)
  THEN (${DURATION_EXPR} / 3600.0) * p.hourly_rate
  ELSE 0
END`;

router.get('/workspaces/:workspaceId/reports/summary', requireAuth, requireWorkspaceMember, async (req, res) => {
  try {
    const { start, end, groupBy = 'project' } = req.query;

    // Aceita ISO completo do cliente ou apenas YYYY-MM-DD
    let startDate = start;
    let endDate = end;
    if (start && !start.includes('T')) startDate = `${start}T00:00:00.000Z`;
    if (end && !end.includes('T')) endDate = `${end}T23:59:59.999Z`;
    if (!startDate) {
      const d = new Date();
      startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    }
    if (!endDate) endDate = new Date().toISOString();

    const params = [req.workspaceId, startDate, endDate];
    const dateFilter = `te.workspace_id = $1 AND te.start_time >= $2::timestamptz AND te.start_time <= $3::timestamptz`;

    if (groupBy === 'user') {
      const result = await req.db.query(
        `SELECT u.id, u.name, u.avatar_color,
                COUNT(te.id)::int as entries,
                COALESCE(SUM(${DURATION_EXPR}), 0) as total_seconds,
                COALESCE(SUM(${AMOUNT_EXPR}), 0) as total_amount
         FROM time_entries te
         JOIN users u ON u.id = te.user_id
         LEFT JOIN projects p ON p.id = te.project_id
         WHERE ${dateFilter}
         GROUP BY u.id, u.name, u.avatar_color
         HAVING COUNT(te.id) > 0
         ORDER BY total_seconds DESC`,
        params
      );
      return res.json(result.rows);
    }

    if (groupBy === 'day') {
      const result = await req.db.query(
        `SELECT te.start_time::date as day,
                COALESCE(SUM(${DURATION_EXPR}), 0) as total_seconds,
                COALESCE(SUM(${AMOUNT_EXPR}), 0) as total_amount
         FROM time_entries te
         LEFT JOIN projects p ON p.id = te.project_id
         WHERE ${dateFilter}
         GROUP BY te.start_time::date
         ORDER BY day`,
        params
      );
      return res.json(result.rows);
    }

    const result = await req.db.query(
      `SELECT p.id, p.name, p.color, p.hourly_rate, p.billable as project_billable,
              COALESCE(SUM(${DURATION_EXPR}), 0) as total_seconds,
              COALESCE(SUM(${AMOUNT_EXPR}), 0) as total_amount,
              COUNT(te.id)::int as entries
       FROM time_entries te
       LEFT JOIN projects p ON p.id = te.project_id
       WHERE ${dateFilter}
       GROUP BY p.id, p.name, p.color, p.hourly_rate, p.billable
       HAVING COUNT(te.id) > 0
       ORDER BY total_seconds DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro no relatório:', err.message, err.stack);
    res.status(500).json({ error: 'Erro ao gerar relatório: ' + err.message });
  }
});

router.get('/workspaces/:workspaceId/reports/export', requireAuth, requireWorkspaceMember, async (req, res) => {
  try {
    const { start, end, format = 'csv' } = req.query;
    const { startDate, endDate } = parseReportDates(start, end);
    const { rows, totalSeconds, totalAmount } = await fetchReportEntries(req.db, req.workspaceId, startDate, endDate);

    const wsResult = await req.db.query('SELECT name FROM workspaces WHERE id = $1', [req.workspaceId]);
    const workspaceName = wsResult.rows[0]?.name || 'Workspace';

    if (format === 'pdf') {
      return streamPdf(res, { rows, totalSeconds, totalAmount, start, end, workspaceName });
    }

    const csv = buildCsv(rows, totalSeconds, totalAmount, start, end);
    const filename = `relatorio-${(start || 'inicio').slice(0, 10)}-${(end || 'fim').slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Erro ao exportar:', err.message);
    res.status(500).json({ error: 'Erro ao exportar relatório' });
  }
});

router.get('/workspaces/:workspaceId/dashboard', requireAuth, requireWorkspaceMember, async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const todayResult = await req.db.query(
    `SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))) as seconds
     FROM time_entries
     WHERE workspace_id = $1 AND user_id = $2 AND start_time >= $3`,
    [req.workspaceId, req.session.userId, today.toISOString()]
  );

  const weekResult = await req.db.query(
    `SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))) as seconds
     FROM time_entries
     WHERE workspace_id = $1 AND user_id = $2 AND start_time >= $3`,
    [req.workspaceId, req.session.userId, weekStart.toISOString()]
  );

  const recentResult = await req.db.query(
    `SELECT te.*, p.name as project_name, p.color as project_color
     FROM time_entries te
     LEFT JOIN projects p ON p.id = te.project_id
     WHERE te.workspace_id = $1 AND te.user_id = $2
     ORDER BY te.start_time DESC LIMIT 10`,
    [req.workspaceId, req.session.userId]
  );

  res.json({
    todaySeconds: parseFloat(todayResult.rows[0].seconds) || 0,
    weekSeconds: parseFloat(weekResult.rows[0].seconds) || 0,
    recentEntries: recentResult.rows,
  });
});

module.exports = router;
