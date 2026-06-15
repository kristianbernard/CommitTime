require('dotenv').config();
const pool = require('./pool');

// 22 entradas Clockify — durações exatas da imagem (total: 82:46:55)
const ENTRIES = [
  { date: '2026-06-15', start: '13:51:00', duration: '03:37:30' },
  { date: '2026-06-15', start: '08:14:00', duration: '04:34:19' },
  { date: '2026-06-12', start: '13:30:00', duration: '02:56:53' },
  { date: '2026-06-12', start: '08:00:00', duration: '05:06:12' },
  { date: '2026-06-11', start: '19:32:00', duration: '01:02:51' },
  { date: '2026-06-11', start: '13:46:00', duration: '03:48:04' },
  { date: '2026-06-11', start: '07:45:00', duration: '05:30:00' },
  { date: '2026-06-10', start: '18:06:00', duration: '00:06:30' },
  { date: '2026-06-10', start: '17:49:00', duration: '00:07:42' },
  { date: '2026-06-10', start: '13:10:00', duration: '04:36:01' },
  { date: '2026-06-10', start: '08:20:00', duration: '04:00:00' },
  { date: '2026-06-09', start: '14:16:00', duration: '02:57:18' },
  { date: '2026-06-09', start: '08:20:00', duration: '05:10:00' },
  { date: '2026-06-08', start: '14:14:00', duration: '04:32:17' },
  { date: '2026-06-08', start: '08:20:00', duration: '04:56:02' },
  { date: '2026-06-05', start: '08:00:00', duration: '04:15:00' },
  { date: '2026-06-03', start: '12:49:00', duration: '04:33:33' },
  { date: '2026-06-03', start: '07:15:00', duration: '04:37:48' },
  { date: '2026-06-02', start: '13:42:00', duration: '04:02:18' },
  { date: '2026-06-02', start: '08:16:00', duration: '04:26:01' },
  { date: '2026-06-01', start: '14:12:00', duration: '02:30:36' },
  { date: '2026-06-01', start: '08:20:00', duration: '05:20:00' },
];

const EXPECTED_SECONDS = 82 * 3600 + 46 * 60 + 55;
const TZ = '-03:00';

function parseDuration(d) {
  const [h, m, s] = d.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function toTimestamptz(date, time) {
  return new Date(`${date}T${time}${TZ}`).toISOString();
}

function addSeconds(iso, secs) {
  return new Date(new Date(iso).getTime() + secs * 1000).toISOString();
}

async function seed() {
  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT id, email, name FROM users
       WHERE LOWER(name) LIKE '%kristian%' OR LOWER(email) LIKE '%kristian%'
       ORDER BY created_at LIMIT 1`
    );
    if (users.rows.length === 0) {
      console.error('Usuário Kristian não encontrado.');
      process.exit(1);
    }
    const user = users.rows[0];
    console.log('Usuário:', user.name, user.email);

    const ws = await client.query(
      `SELECT w.id, w.name FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1 LIMIT 1`,
      [user.id]
    );
    if (ws.rows.length === 0) {
      console.error('Workspace não encontrado.');
      process.exit(1);
    }
    const workspaceId = ws.rows[0].id;

    let project = await client.query(
      `SELECT id FROM projects WHERE workspace_id = $1 AND (name ILIKE 'KB%' OR name ILIKE 'K8%') LIMIT 1`,
      [workspaceId]
    );
    let projectId;
    if (project.rows.length === 0) {
      const created = await client.query(
        `INSERT INTO projects (workspace_id, name, color, billable) VALUES ($1, 'KB', '#7c3aed', false) RETURNING id`,
        [workspaceId]
      );
      projectId = created.rows[0].id;
    } else {
      projectId = project.rows[0].id;
    }

    await client.query('BEGIN');

    const deleted = await client.query(
      `DELETE FROM time_entries
       WHERE user_id = $1 AND workspace_id = $2 AND project_id = $3
         AND start_time >= $4::timestamptz AND start_time < $5::timestamptz`,
      [user.id, workspaceId, projectId, toTimestamptz('2026-06-01', '00:00:00'), toTimestamptz('2026-07-01', '00:00:00')]
    );
    console.log('Removidas:', deleted.rowCount, 'entradas antigas');

    for (const e of ENTRIES) {
      const start = toTimestamptz(e.date, e.start);
      const end = addSeconds(start, parseDuration(e.duration));
      await client.query(
        `INSERT INTO time_entries (user_id, workspace_id, project_id, description, start_time, end_time, billable)
         VALUES ($1, $2, $3, '', $4, $5, false)`,
        [user.id, workspaceId, projectId, start, end]
      );
    }

    await client.query('COMMIT');

    const total = await client.query(
      `SELECT COUNT(*)::int as c,
              SUM(EXTRACT(EPOCH FROM (end_time - start_time))) as secs
       FROM time_entries
       WHERE user_id = $1 AND workspace_id = $2 AND project_id = $3
         AND start_time >= $4::timestamptz AND start_time < $5::timestamptz`,
      [user.id, workspaceId, projectId, toTimestamptz('2026-06-01', '00:00:00'), toTimestamptz('2026-07-01', '00:00:00')]
    );

    const secs = parseFloat(total.rows[0].secs) || 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    console.log(`Inseridas ${ENTRIES.length} entradas.`);
    console.log(`Total: ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} (${secs}s)`);
    console.log(`Esperado Clockify: 82:46:55 (${EXPECTED_SECONDS}s)`);
    console.log(Math.abs(secs - EXPECTED_SECONDS) < 2 ? 'OK — total bate!' : 'AVISO — diferença de ' + (secs - EXPECTED_SECONDS) + 's');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
