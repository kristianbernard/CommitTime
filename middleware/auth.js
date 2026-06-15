function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  next();
}

async function requireWorkspaceMember(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId || req.body.workspaceId || req.query.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId é obrigatório' });
    }
    const result = await req.db.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.session.userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Sem acesso a este workspace' });
    }
    req.workspaceRole = result.rows[0].role;
    req.workspaceId = workspaceId;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao verificar workspace' });
  }
}

function requireAdmin(req, res, next) {
  if (!['OWNER', 'ADMIN'].includes(req.workspaceRole)) {
    return res.status(403).json({ error: 'Permissão de administrador necessária' });
  }
  next();
}

module.exports = { requireAuth, requireWorkspaceMember, requireAdmin };
