const API = {
  async request(url, options = {}) {
    const timeout = options.timeout || 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(`/api${url}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'same-origin',
        signal: controller.signal,
        ...options,
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/csv') || contentType.includes('application/pdf')) {
        if (!res.ok) throw new Error('Erro ao baixar arquivo');
        return res;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro na requisição');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Tempo esgotado. Tente novamente.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
  get: (url, opts) => API.request(url, opts),
  post: (url, body) => API.request(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: (url, body) => API.request(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url) => API.request(url, { method: 'DELETE' }),
};

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00:00';
  const total = Math.round(Number(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationShort(seconds) {
  return formatDuration(seconds);
}

function formatHoursDecimal(seconds) {
  const hours = (seconds || 0) / 3600;
  return hours.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h';
}

function formatMoney(amount) {
  const value = parseFloat(amount) || 0;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toLocalDateStr(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDayStartIso(dateStr) {
  return new Date(dateStr + 'T00:00:00').toISOString();
}

function localDayEndIso(dateStr) {
  return new Date(dateStr + 'T23:59:59.999').toISOString();
}

function formatReportDay(day) {
  if (!day) return '—';
  const raw = String(day).split('T')[0];
  const [y, m, d] = raw.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function entryDuration(entry) {
  const start = new Date(entry.start_time);
  const end = entry.end_time ? new Date(entry.end_time) : new Date();
  return Math.round((end - start) / 1000);
}

function sumEntryDurations(entries) {
  return entries.reduce((s, e) => s + (e.end_time ? entryDuration(e) : 0), 0);
}

function getLocalDayRange() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
  };
}

function getLocalWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function getLocalMonthRange() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

function sumEntriesInRange(entries, start, end) {
  return entries.reduce((sum, e) => {
    if (!e.end_time) return sum;
    const t = new Date(e.start_time);
    if (t >= start && t <= end) return sum + entryDuration(e);
    return sum;
  }, 0);
}

function resolveDashboardSeconds(dashboard, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(dashboard, key)) {
    const v = parseFloat(dashboard[key]);
    if (Number.isFinite(v) && v > 0) return v;
    if (Number.isFinite(v) && fallback > 0) return fallback;
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function toInputDateTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const COLORS = ['#03A9F4', '#4CAF50', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4', '#FF5722', '#795548'];

const state = {
  user: null,
  workspaces: [],
  currentWorkspace: null,
  currentPage: 'timer',
  runningTimer: null,
  timerEditingStart: false,
  projects: [],
  members: [],
  timerInterval: null,
  lastReport: null,
  navGeneration: 0,
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isNavStale(gen) {
  return gen !== undefined && gen !== state.navGeneration;
}

function setPageLoading(message) {
  const el = $('#page-content');
  if (el) {
    el.innerHTML = `<div class="empty-state"><p>${escapeHtml(message || 'Carregando...')}</p></div>`;
  }
}

function setPageError(message) {
  const el = $('#page-content');
  if (el) {
    el.innerHTML = `<div class="error-msg">${escapeHtml(message)}</div>`;
  }
}

function showModal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
}

function closeModal() {
  const m = $('#modal-overlay');
  if (m) m.remove();
}

function getWsId() {
  return state.currentWorkspace?.id;
}

// ─── Auth ─────────────────────────────────────

async function init() {
  try {
    const data = await API.get('/auth/me');
    state.user = data.user;
    state.workspaces = data.workspaces;
    if (state.workspaces.length > 0) {
      const saved = localStorage.getItem('workspaceId');
      state.currentWorkspace = state.workspaces.find((w) => w.id === saved) || state.workspaces[0];
    }
    showApp();
  } catch {
    showAuth();
  }
}

function showAuth() {
  $('#auth-page').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#auth-page').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderSidebar();
  navigate(state.currentPage || 'timer');
  loadRunningTimer();
}

function setupAuthForms() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.classList.add('hidden');
    try {
      const data = await API.post('/auth/login', {
        email: $('#login-email').value,
        password: $('#login-password').value,
      });
      state.user = data.user;
      const me = await API.get('/auth/me');
      state.workspaces = me.workspaces;
      state.currentWorkspace = me.workspaces[0] || null;
      showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#register-error');
    err.classList.add('hidden');
    try {
      const data = await API.post('/auth/register', {
        name: $('#register-name').value,
        email: $('#register-email').value,
        password: $('#register-password').value,
        workspaceName: $('#register-workspace').value,
      });
      state.user = data.user;
      state.workspaces = [data.workspace];
      state.currentWorkspace = data.workspace;
      showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#show-register').addEventListener('click', (e) => {
    e.preventDefault();
    $('#login-form').classList.add('hidden');
    $('#register-form').classList.remove('hidden');
    $('#auth-title').textContent = 'Criar conta';
  });

  $('#show-login').addEventListener('click', (e) => {
    e.preventDefault();
    $('#register-form').classList.add('hidden');
    $('#login-form').classList.remove('hidden');
    $('#auth-title').textContent = 'Entrar';
  });
}

// ─── Sidebar ────────────────────────────────

function renderSidebar() {
  const u = state.user;
  $('#user-avatar').style.background = u.avatar_color;
  $('#user-avatar').textContent = u.name.charAt(0).toUpperCase();
  $('#user-name').textContent = u.name;
  $('#user-email').textContent = u.email;

  const wsSelect = $('#workspace-select');
  wsSelect.innerHTML = state.workspaces
    .map((w) => `<option value="${w.id}" ${w.id === state.currentWorkspace?.id ? 'selected' : ''}>${w.name}</option>`)
    .join('');

  wsSelect.onchange = async () => {
    state.currentWorkspace = state.workspaces.find((w) => w.id === wsSelect.value);
    localStorage.setItem('workspaceId', wsSelect.value);
    await navigate(state.currentPage);
    await loadRunningTimer();
  };

  $$('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === state.currentPage);
    item.onclick = () => navigate(item.dataset.page);
  });

  $('#logout-btn').onclick = async () => {
    await API.post('/auth/logout');
    state.user = null;
    showAuth();
  };
}

// ─── Navigation ─────────────────────────────

async function navigate(page) {
  state.currentPage = page;
  const gen = ++state.navGeneration;

  $$('.nav-item').forEach((i) => i.classList.toggle('active', i.dataset.page === page));
  const titles = { timer: 'Timer', projects: 'Projetos', team: 'Equipe', reports: 'Relatórios' };
  $('#page-title').textContent = titles[page] || page;
  setPageLoading('Carregando...');

  try {
    switch (page) {
      case 'timer': await renderTimerPage(gen); break;
      case 'projects': await renderProjectsPage(gen); break;
      case 'team': await renderTeamPage(gen); break;
      case 'reports': await renderReportsPage(gen); break;
      default: if (!isNavStale(gen)) setPageError('Página não encontrada');
    }
  } catch (err) {
    console.error('navigate error:', page, err);
    if (!isNavStale(gen)) setPageError(`Erro ao carregar: ${err.message}`);
  }
}

// ─── Timer ──────────────────────────────────

async function loadRunningTimer() {
  try {
    state.runningTimer = await API.get('/time-entries/running');
    updateTimerDisplay();
    if (state.runningTimer) {
      startTimerTick();
    } else {
      stopTimerTick();
    }
  } catch {
    state.runningTimer = null;
  }
}

function startTimerTick() {
  stopTimerTick();
  state.timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimerTick() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  const durationEl = $('#timer-duration');
  const hintEl = $('#timer-start-hint');
  if (!durationEl) return;
  if (state.timerEditingStart) return;

  if (state.runningTimer) {
    const secs = entryDuration(state.runningTimer);
    durationEl.textContent = formatDuration(secs);
    durationEl.classList.add('running');
    durationEl.title = 'Clique para alterar o horário de início';
    if (hintEl) {
      hintEl.textContent = `Início: ${formatDateTime(state.runningTimer.start_time)}`;
      hintEl.classList.remove('hidden');
    }
    const btn = $('#timer-toggle-btn');
    if (btn) { btn.textContent = '⏹'; btn.classList.add('stop'); }
    const desc = $('#timer-description');
    if (desc && state.runningTimer.description) desc.value = state.runningTimer.description;
  } else {
    durationEl.textContent = '0:00:00';
    durationEl.classList.remove('running');
    durationEl.title = '';
    if (hintEl) hintEl.classList.add('hidden');
    const btn = $('#timer-toggle-btn');
    if (btn) { btn.textContent = '▶'; btn.classList.remove('stop'); }
  }
}

function showTimerStartEditor() {
  if (!state.runningTimer || state.timerEditingStart) return;

  const durationEl = $('#timer-duration');
  const hintEl = $('#timer-start-hint');
  const inputEl = $('#timer-start-edit');
  if (!durationEl || !inputEl) return;

  state.timerEditingStart = true;
  durationEl.classList.add('hidden');
  if (hintEl) hintEl.classList.add('hidden');
  inputEl.classList.remove('hidden');
  inputEl.value = toInputDateTime(state.runningTimer.start_time);
  inputEl.focus();
  inputEl.select();
}

function hideTimerStartEditor(revert) {
  const durationEl = $('#timer-duration');
  const hintEl = $('#timer-start-hint');
  const inputEl = $('#timer-start-edit');
  if (!inputEl) return;

  state.timerEditingStart = false;
  inputEl.classList.add('hidden');
  if (durationEl) durationEl.classList.remove('hidden');
  if (!revert && hintEl && state.runningTimer) hintEl.classList.remove('hidden');
  updateTimerDisplay();
}

async function saveTimerStartTime() {
  const inputEl = $('#timer-start-edit');
  if (!state.runningTimer || !inputEl) return;

  const startVal = inputEl.value;
  if (!startVal) {
    hideTimerStartEditor(true);
    return;
  }

  const newStart = new Date(startVal);
  const now = new Date();
  if (newStart > now) {
    alert('O horário de início não pode ser no futuro');
    inputEl.focus();
    return;
  }

  const currentStart = new Date(state.runningTimer.start_time).getTime();
  if (newStart.getTime() === currentStart) {
    hideTimerStartEditor(true);
    return;
  }

  inputEl.disabled = true;
  try {
    const updated = await API.patch(`/time-entries/${state.runningTimer.id}`, {
      startTime: newStart.toISOString(),
    });
    state.runningTimer = { ...state.runningTimer, ...updated };
    hideTimerStartEditor(true);
  } catch (err) {
    alert('Erro ao alterar início: ' + err.message);
    inputEl.disabled = false;
    inputEl.focus();
  }
}

function setupTimerStartEditor() {
  const durationEl = $('#timer-duration');
  const inputEl = $('#timer-start-edit');
  if (!durationEl || !inputEl) return;

  durationEl.onclick = () => {
    if (state.runningTimer && !state.timerEditingStart) showTimerStartEditor();
  };

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTimerStartTime();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideTimerStartEditor(true);
    }
  };

  inputEl.onblur = () => {
    if (state.timerEditingStart) {
      setTimeout(() => {
        if (state.timerEditingStart) saveTimerStartTime();
      }, 150);
    }
  };
}

async function ensureProjects(wsId) {
  if (state.projects.length) return state.projects;
  state.projects = await API.get(`/workspaces/${wsId}/projects`);
  return state.projects;
}

async function renderTimerPage(gen) {
  const wsId = getWsId();
  if (!wsId) {
    if (!isNavStale(gen)) {
      $('#page-content').innerHTML = '<div class="empty-state"><h3>Crie um workspace para começar</h3></div>';
    }
    return;
  }

  const [dashboard, projects, entries] = await Promise.all([
    API.get(`/workspaces/${wsId}/dashboard?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo')}`),
    API.get(`/workspaces/${wsId}/projects`),
    API.get(`/workspaces/${wsId}/time-entries?userId=${state.user.id}`),
  ]);

  if (isNavStale(gen)) return;

  state.projects = projects;

  const monthRange = getLocalMonthRange();
  const dayRange = getLocalDayRange();
  const weekRange = getLocalWeekRange();
  const stats = {
    today: resolveDashboardSeconds(dashboard, 'todaySeconds', sumEntriesInRange(entries, dayRange.start, dayRange.end)),
    week: resolveDashboardSeconds(dashboard, 'weekSeconds', sumEntriesInRange(entries, weekRange.start, weekRange.end)),
    month: resolveDashboardSeconds(dashboard, 'monthSeconds', sumEntriesInRange(entries, monthRange.start, monthRange.end)),
    all: resolveDashboardSeconds(dashboard, 'allSeconds', sumEntryDurations(entries)),
  };

  const projectOptions = projects.map((p) =>
    `<option value="${p.id}" ${state.runningTimer?.project_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');

  $('#page-content').innerHTML = `
    <div class="timer-bar">
      <input type="text" id="timer-description" class="timer-input" placeholder="O que você está fazendo?" value="${escapeHtml(state.runningTimer?.description || '')}">
      <select id="timer-project" class="timer-project-select">
        <option value="">Sem projeto</option>
        ${projectOptions}
      </select>
      <div class="timer-clock">
        <div id="timer-duration" class="timer-display ${state.runningTimer ? 'running' : ''}">0:00:00</div>
        <input type="datetime-local" step="1" id="timer-start-edit" class="timer-start-edit hidden" title="Horário de início">
        <div id="timer-start-hint" class="timer-start-hint ${state.runningTimer ? '' : 'hidden'}"></div>
      </div>
      <button type="button" id="timer-toggle-btn" class="timer-btn-start ${state.runningTimer ? 'stop' : ''}" title="Iniciar/Parar">${state.runningTimer ? '⏹' : '▶'}</button>
      <button type="button" id="manual-entry-btn" class="btn btn-secondary btn-sm" style="white-space:nowrap">+ Manual</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Hoje</div>
        <div class="value">${formatDuration(stats.today)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Esta semana</div>
        <div class="value">${formatDuration(stats.week)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Este mês</div>
        <div class="value">${formatDuration(stats.month)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Total geral</div>
        <div class="value">${formatDuration(stats.all)}</div>
      </div>
    </div>

    <h3 style="margin-bottom:16px;font-size:16px;">Entradas recentes</h3>
    ${renderEntriesTable(entries.slice(0, 50), sumEntryDurations(entries.slice(0, 50)))}
  `;

  updateTimerDisplay();
  if (state.runningTimer) startTimerTick();

  setupTimerStartEditor();
  $('#timer-toggle-btn').onclick = toggleTimer;
  $('#manual-entry-btn').onclick = () => showManualEntryModal();
}

async function toggleTimer() {
  const wsId = getWsId();
  try {
    if (state.runningTimer) {
      await API.post(`/time-entries/${state.runningTimer.id}/stop`);
      state.runningTimer = null;
      state.timerEditingStart = false;
      stopTimerTick();
      await renderTimerPage(state.navGeneration);
    } else {
      const desc = $('#timer-description')?.value || '';
      const projectId = $('#timer-project')?.value || null;
      const entry = await API.post(`/workspaces/${wsId}/time-entries`, {
        description: desc,
        projectId,
      });
      state.runningTimer = entry;
      startTimerTick();
      updateTimerDisplay();
    }
  } catch (err) {
    alert('Erro no timer: ' + err.message);
  }
}

function showManualEntryModal() {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000);
  const projects = state.projects || [];
  const projectOptions = projects.map((p) =>
    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
  ).join('');

  showModal(`
    <h3>Entrada manual</h3>
    <div class="form-group"><label>Descrição</label><input id="manual-desc" placeholder="O que você fez?"></div>
    <div class="form-group"><label>Projeto</label>
      <select id="manual-project"><option value="">Sem projeto</option>${projectOptions}</select>
    </div>
    <div class="form-group"><label>Início</label><input type="datetime-local" step="1" id="manual-start" value="${toInputDateTime(oneHourAgo.toISOString())}"></div>
    <div class="form-group"><label>Fim</label><input type="datetime-local" step="1" id="manual-end" value="${toInputDateTime(now.toISOString())}"></div>
    <div class="checkbox-row"><input type="checkbox" id="manual-billable"><label for="manual-billable">Faturável</label></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-primary" id="save-manual-btn" style="width:auto">Salvar</button>
    </div>
  `);

  $('#save-manual-btn').onclick = async () => {
    const startVal = $('#manual-start').value;
    const endVal = $('#manual-end').value;
    if (!startVal || !endVal) return alert('Informe início e fim');
    if (new Date(endVal) <= new Date(startVal)) return alert('O fim deve ser depois do início');

    const btn = $('#save-manual-btn');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      await API.post(`/workspaces/${getWsId()}/time-entries`, {
        description: $('#manual-desc').value,
        projectId: $('#manual-project').value || null,
        startTime: new Date(startVal).toISOString(),
        endTime: new Date(endVal).toISOString(),
        billable: $('#manual-billable').checked,
      });
      closeModal();
      await navigate('timer');
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  };
}

function renderEntriesTable(entries, listTotalSeconds) {
  if (!entries.length) {
    return '<div class="empty-state"><div class="icon">⏱</div><h3>Nenhuma entrada ainda</h3><p>Inicie o timer acima para registrar seu tempo</p></div>';
  }
  const totalSecs = listTotalSeconds != null
    ? Math.round(listTotalSeconds)
    : sumEntryDurations(entries);
  return `<table class="data-table">
    <thead><tr>
      <th>Projeto</th><th>Descrição</th><th>Início</th><th>Duração</th><th></th>
    </tr></thead>
    <tbody>${entries.map((e) => `
      <tr>
        <td>${e.project_name ? `<span class="project-dot" style="background:${e.project_color}"></span>${escapeHtml(e.project_name)}` : '—'}</td>
        <td>${escapeHtml(e.description) || '—'}</td>
        <td>${formatDateTime(e.start_time)}</td>
        <td class="duration">${e.end_time ? formatDuration(entryDuration(e)) : '<span style="color:var(--success)">Em andamento</span>'}</td>
        <td><div class="table-actions">
          <button class="btn btn-sm btn-secondary" onclick="editEntry('${e.id}')">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEntry('${e.id}')">Excluir</button>
        </div></td>
      </tr>
    `).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3"><strong>Total (${entries.length} entradas)</strong></td>
      <td class="duration"><strong>${formatDuration(totalSecs)}</strong></td>
      <td></td>
    </tr></tfoot>
  </table>`;
}

window.editEntry = async function (id) {
  const wsId = getWsId();
  try {
    const [entries, projects] = await Promise.all([
      API.get(`/workspaces/${wsId}/time-entries`),
      ensureProjects(wsId),
    ]);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return alert('Entrada não encontrada');

    const projectOptions = projects.map((p) =>
      `<option value="${p.id}" ${entry.project_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    showModal(`
      <h3>Editar entrada</h3>
      <div class="form-group"><label>Descrição</label><input id="edit-desc" value="${escapeHtml(entry.description || '')}"></div>
      <div class="form-group"><label>Projeto</label>
        <select id="edit-project"><option value="">Sem projeto</option>${projectOptions}</select>
      </div>
      <div class="form-group"><label>Início</label><input type="datetime-local" step="1" id="edit-start" value="${toInputDateTime(entry.start_time)}"></div>
      <div class="form-group"><label>Fim</label><input type="datetime-local" step="1" id="edit-end" value="${entry.end_time ? toInputDateTime(entry.end_time) : ''}"></div>
      <div class="checkbox-row"><input type="checkbox" id="edit-billable" ${entry.billable ? 'checked' : ''}><label for="edit-billable">Faturável</label></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="button" class="btn btn-primary" id="save-entry-btn" style="width:auto">Salvar</button>
      </div>
    `);

    $('#save-entry-btn').onclick = async () => {
      const startVal = $('#edit-start').value;
      const endVal = $('#edit-end').value;
      if (!startVal) return alert('Informe o horário de início');
      if (endVal && new Date(endVal) <= new Date(startVal)) {
        return alert('O fim deve ser depois do início');
      }

      const btn = $('#save-entry-btn');
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      try {
        await API.patch(`/time-entries/${id}`, {
          description: $('#edit-desc').value,
          projectId: $('#edit-project').value || null,
          startTime: new Date(startVal).toISOString(),
          endTime: endVal ? new Date(endVal).toISOString() : null,
          billable: $('#edit-billable').checked,
        });
        closeModal();
        await navigate('timer');
      } catch (err) {
        alert('Erro ao salvar: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Salvar';
      }
    };
  } catch (err) {
    alert('Erro ao carregar entrada: ' + err.message);
  }
};

window.deleteEntry = async function (id) {
  if (!confirm('Excluir esta entrada?')) return;
  try {
    await API.delete(`/time-entries/${id}`);
    await navigate('timer');
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
};

// ─── Projects ───────────────────────────────

async function renderProjectsPage(gen) {
  const wsId = getWsId();
  const projects = await API.get(`/workspaces/${wsId}/projects?archived=all`);
  if (isNavStale(gen)) return;

  state.projects = projects.filter((p) => !p.archived);

  $('#page-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div class="tabs">
        <button class="tab active" data-tab="active">Ativos</button>
        <button class="tab" data-tab="archived">Arquivados</button>
      </div>
      <button class="btn btn-primary" style="width:auto" id="new-project-btn">+ Novo projeto</button>
    </div>
    <div id="projects-list"></div>
  `;

  renderProjectsList(projects.filter((p) => !p.archived));

  $$('.tab').forEach((tab) => {
    tab.onclick = () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const archived = tab.dataset.tab === 'archived';
      renderProjectsList(projects.filter((p) => p.archived === archived));
    };
  });

  $('#new-project-btn').onclick = () => showNewProjectModal();
}

function renderProjectsList(projects) {
  const el = $('#projects-list');
  if (!projects.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📁</div><h3>Nenhum projeto</h3><p>Crie seu primeiro projeto para organizar o tempo</p></div>';
    return;
  }
  el.innerHTML = `<div class="cards-grid">${projects.map((p) => `
    <div class="project-card">
      <div class="project-card-header">
        <span class="project-dot" style="background:${p.color};width:14px;height:14px"></span>
        <h3>${p.name}</h3>
      </div>
      <div class="project-card-meta">
        ${p.client_name ? `Cliente: ${p.client_name}<br>` : ''}
        ${p.billable ? '<span class="badge badge-billable">Faturável</span> ' : ''}
        ${p.archived ? '<span class="badge badge-archived">Arquivado</span>' : ''}
        ${p.hourly_rate ? ` · R$ ${p.hourly_rate}/h` : ''}
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-sm btn-secondary" onclick="editProject('${p.id}')">Editar</button>
        ${!p.archived ? `<button class="btn btn-sm btn-secondary" onclick="archiveProject('${p.id}',true)">Arquivar</button>` :
          `<button class="btn btn-sm btn-secondary" onclick="archiveProject('${p.id}',false)">Restaurar</button>`}
      </div>
    </div>
  `).join('')}</div>`;
}

function showNewProjectModal() {
  const colorOptions = COLORS.map((c) =>
    `<div class="color-option ${c === '#03A9F4' ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`
  ).join('');

  showModal(`
    <h3>Novo projeto</h3>
    <div class="form-group"><label>Nome</label><input id="proj-name" placeholder="Nome do projeto"></div>
    <div class="form-group"><label>Cor</label><div class="color-picker" id="color-picker">${colorOptions}</div></div>
    <div class="checkbox-row"><input type="checkbox" id="proj-billable"><label for="proj-billable">Faturável</label></div>
    <div class="form-group"><label>Taxa horária (R$)</label><input type="number" id="proj-rate" placeholder="0.00" step="0.01"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="create-proj-btn" style="width:auto">Criar</button>
    </div>
  `);

  let selectedColor = '#03A9F4';
  $$('.color-option').forEach((opt) => {
    opt.onclick = () => {
      $$('.color-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedColor = opt.dataset.color;
    };
  });

  $('#create-proj-btn').onclick = async () => {
    const name = $('#proj-name').value.trim();
    if (!name) return alert('Nome é obrigatório');
    await API.post(`/workspaces/${getWsId()}/projects`, {
      name,
      color: selectedColor,
      billable: $('#proj-billable').checked,
      hourlyRate: $('#proj-rate').value || null,
    });
    closeModal();
    await navigate('projects');
  };
}

window.editProject = async function (id) {
  const wsId = getWsId();
  const projects = await API.get(`/workspaces/${wsId}/projects?archived=all`);
  const p = projects.find((x) => x.id === id);
  if (!p) return;

  const colorOptions = COLORS.map((c) =>
    `<div class="color-option ${c === p.color ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`
  ).join('');

  showModal(`
    <h3>Editar projeto</h3>
    <div class="form-group"><label>Nome</label><input id="proj-name" value="${p.name}"></div>
    <div class="form-group"><label>Cor</label><div class="color-picker" id="color-picker">${colorOptions}</div></div>
    <div class="checkbox-row"><input type="checkbox" id="proj-billable" ${p.billable ? 'checked' : ''}><label for="proj-billable">Faturável</label></div>
    <div class="form-group"><label>Taxa horária (R$)</label><input type="number" id="proj-rate" value="${p.hourly_rate || ''}" step="0.01"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="save-proj-btn" style="width:auto">Salvar</button>
    </div>
  `);

  let selectedColor = p.color;
  $$('.color-option').forEach((opt) => {
    opt.onclick = () => {
      $$('.color-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedColor = opt.dataset.color;
    };
  });

  $('#save-proj-btn').onclick = async () => {
    await API.patch(`/projects/${id}`, {
      name: $('#proj-name').value,
      color: selectedColor,
      billable: $('#proj-billable').checked,
      hourlyRate: $('#proj-rate').value || null,
    });
    closeModal();
    await navigate('projects');
  };
};

window.archiveProject = async function (id, archived) {
  await API.patch(`/projects/${id}`, { archived });
  await navigate('projects');
};

// ─── Team ───────────────────────────────────

async function renderTeamPage(gen) {
  const wsId = getWsId();
  const members = await API.get(`/workspaces/${wsId}/members`);
  if (isNavStale(gen)) return;

  state.members = members;
  const myRole = state.currentWorkspace?.role;
  const canAdmin = ['OWNER', 'ADMIN'].includes(myRole);

  $('#page-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <p style="color:var(--text-muted);font-size:14px">${members.length} membro(s) neste workspace</p>
      ${canAdmin ? '<button class="btn btn-primary" style="width:auto" id="invite-btn">+ Convidar membro</button>' : ''}
    </div>
    <table class="data-table">
      <thead><tr><th>Membro</th><th>Email</th><th>Função</th>${canAdmin ? '<th></th>' : ''}</tr></thead>
      <tbody>${members.map((m) => `
        <tr>
          <td><div style="display:flex;align-items:center;gap:10px">
            <div class="user-avatar" style="background:${m.avatar_color};width:28px;height:28px;font-size:11px">${m.name.charAt(0)}</div>
            ${m.name}
          </div></td>
          <td>${m.email}</td>
          <td><span class="badge badge-${m.role.toLowerCase()}">${m.role}</span></td>
          ${canAdmin ? `<td><div class="table-actions">
            ${m.role !== 'OWNER' && m.id !== state.user.id ? `
              <button class="btn btn-sm btn-danger" onclick="removeMember('${m.id}')">Remover</button>
            ` : ''}
          </div></td>` : ''}
        </tr>
      `).join('')}</tbody>
    </table>
    ${canAdmin ? `
    <div style="margin-top:32px">
      <button class="btn btn-secondary" id="new-workspace-btn">+ Criar novo workspace</button>
    </div>` : ''}
  `;

  if (canAdmin) {
    $('#invite-btn').onclick = () => {
      showModal(`
        <h3>Convidar membro</h3>
        <div class="form-group"><label>Email</label><input id="invite-email" type="email" placeholder="email@exemplo.com"></div>
        <div class="form-group"><label>Função</label>
          <select id="invite-role"><option value="MEMBER">Membro</option><option value="ADMIN">Admin</option></select>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Se o usuário já tiver conta, será adicionado imediatamente. Caso contrário, será adicionado ao se cadastrar.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="send-invite-btn" style="width:auto">Convidar</button>
        </div>
      `);
      $('#send-invite-btn').onclick = async () => {
        await API.post(`/workspaces/${wsId}/invite`, {
          email: $('#invite-email').value,
          role: $('#invite-role').value,
        });
        closeModal();
        await navigate('team');
      };
    };

    $('#new-workspace-btn').onclick = () => {
      showModal(`
        <h3>Novo workspace</h3>
        <div class="form-group"><label>Nome</label><input id="ws-name" placeholder="Nome do workspace"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="create-ws-btn" style="width:auto">Criar</button>
        </div>
      `);
      $('#create-ws-btn').onclick = async () => {
        const ws = await API.post('/workspaces', { name: $('#ws-name').value });
        state.workspaces.push({ ...ws, role: 'OWNER' });
        state.currentWorkspace = { ...ws, role: 'OWNER' };
        closeModal();
        renderSidebar();
        await navigate('team');
      };
    };
  }
}

window.removeMember = async function (userId) {
  if (!confirm('Remover este membro?')) return;
  await API.delete(`/workspaces/${getWsId()}/members/${userId}`);
  await navigate('team');
};

// ─── Reports ────────────────────────────────

async function renderReportsPage(gen) {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const startVal = toLocalDateStr(yearStart);
  const endVal = toLocalDateStr(now);

  if (isNavStale(gen)) return;

  $('#page-content').innerHTML = `
    <div class="report-filters">
      <input type="date" id="report-start" value="${startVal}">
      <span style="color:var(--text-muted)">até</span>
      <input type="date" id="report-end" value="${endVal}">
      <select id="report-group">
        <option value="project">Por projeto</option>
        <option value="user">Por usuário</option>
        <option value="day">Por dia</option>
      </select>
      <button type="button" class="btn btn-primary" style="width:auto" id="report-run">Gerar relatório</button>
      <select id="report-format" class="timer-project-select" style="min-width:100px">
        <option value="csv">CSV</option>
        <option value="pdf">PDF</option>
      </select>
      <button type="button" class="btn btn-secondary" style="width:auto" id="report-download">Baixar</button>
    </div>
    <div id="report-results"><div class="empty-state"><p>Clique em "Gerar relatório" ou escolha CSV/PDF e clique em "Baixar"</p></div></div>
  `;

  document.getElementById('report-run').addEventListener('click', (e) => {
    e.preventDefault();
    loadReport(false);
  });
  document.getElementById('report-download').addEventListener('click', (e) => {
    e.preventDefault();
    downloadReport();
  });
  document.getElementById('report-group').addEventListener('change', () => loadReport(false));
  await loadReport(false);
}

async function downloadReport() {
  const wsId = getWsId();
  if (!wsId) {
    alert('Selecione um workspace.');
    return;
  }

  const startInput = document.getElementById('report-start');
  const endInput = document.getElementById('report-end');
  const formatSelect = document.getElementById('report-format');
  if (!startInput?.value || !endInput?.value) {
    alert('Informe as datas de início e fim.');
    return;
  }

  const start = startInput.value;
  const end = endInput.value;
  const format = formatSelect?.value || 'csv';
  const ext = format === 'pdf' ? 'pdf' : 'csv';
  const btn = document.getElementById('report-download');
  if (btn) { btn.disabled = true; btn.textContent = 'Baixando...'; }

  try {
    const startIso = encodeURIComponent(localDayStartIso(start));
    const endIso = encodeURIComponent(localDayEndIso(end));
    const url = `/workspaces/${wsId}/reports/export?start=${startIso}&end=${endIso}&format=${format}`;
    const res = await API.get(url);
    const blob = await res.blob();
    const filename = `relatorio-${start}-${end}.${ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);

    const el = document.getElementById('report-results');
    if (el && !state.lastReport) {
      el.innerHTML = `<div class="empty-state"><p>Arquivo ${ext.toUpperCase()} baixado com sucesso!</p></div>`;
    }
    await loadReport(true);
  } catch (err) {
    alert('Erro ao baixar: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Baixar'; }
  }
}

async function loadReport(skipLoadingMsg) {
  const el = document.getElementById('report-results');
  if (!el) return;

  const wsId = getWsId();
  if (!wsId) {
    el.innerHTML = '<div class="error-msg">Selecione um workspace para gerar o relatório.</div>';
    return;
  }

  const startInput = document.getElementById('report-start');
  const endInput = document.getElementById('report-end');
  const groupSelect = document.getElementById('report-group');
  if (!startInput || !endInput || !groupSelect) return;

  const start = startInput.value;
  const end = endInput.value;
  const groupBy = groupSelect.value;

  if (!start || !end) {
    el.innerHTML = '<div class="error-msg">Informe as datas de início e fim.</div>';
    return;
  }

  if (start > end) {
    el.innerHTML = '<div class="error-msg">A data inicial não pode ser maior que a data final.</div>';
    return;
  }

  if (!skipLoadingMsg) {
    el.innerHTML = '<div class="empty-state"><p>Gerando relatório...</p></div>';
  }

  const btn = document.getElementById('report-run');
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }

  try {
    const startIso = encodeURIComponent(localDayStartIso(start));
    const endIso = encodeURIComponent(localDayEndIso(end));
    const url = `/workspaces/${wsId}/reports/summary?start=${startIso}&end=${endIso}&groupBy=${encodeURIComponent(groupBy)}`;
    const data = await API.get(url);

    if (!Array.isArray(data)) {
      throw new Error('Resposta inválida do servidor');
    }

    state.lastReport = { data, groupBy, start, end, wsId };
    renderReportResults(data, groupBy, el, start, end);
  } catch (err) {
    console.error('loadReport error:', err);
    el.innerHTML = `<div class="error-msg">Erro ao gerar relatório: ${err.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Gerar relatório'; }
  }
}

function renderDurationCell(seconds) {
  const secs = Math.round(parseFloat(seconds) || 0);
  return `<span class="duration">${formatDuration(secs)}</span>
    <span style="display:block;font-size:11px;color:var(--text-muted);font-weight:400">${formatHoursDecimal(secs)}</span>`;
}

function renderReportResults(data, groupBy, el, start, end) {
  const totalSeconds = data.reduce((sum, d) => sum + (parseFloat(d.total_seconds) || 0), 0);
  const totalAmount = data.reduce((sum, d) => sum + (parseFloat(d.total_amount) || 0), 0);
  const maxSeconds = data.length ? Math.max(...data.map((d) => parseFloat(d.total_seconds) || 0)) : 0;

  const emptyNote = data.length === 0
    ? `<div class="empty-state" style="padding:24px"><p>Nenhuma entrada entre ${formatDate(start)} e ${formatDate(end)}. Registre tempo no <strong>Timer</strong>.</p></div>`
    : '';

  const summaryHtml = `
    <div class="stats-grid" style="margin-bottom:24px">
      <div class="stat-card">
        <div class="label">Total de horas</div>
        <div class="value">${formatDuration(totalSeconds)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${formatHoursDecimal(totalSeconds)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Valor total faturável</div>
        <div class="value" style="color:var(--success)">${formatMoney(totalAmount)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Taxa horária × horas (projetos faturáveis)</div>
      </div>
      <div class="stat-card">
        <div class="label">Período</div>
        <div class="value" style="font-size:16px">${formatDate(start)} — ${formatDate(end)}</div>
      </div>
    </div>
    ${emptyNote}
  `;

  if (!data.length) {
    el.innerHTML = summaryHtml;
    return;
  }

  if (groupBy === 'day') {
    el.innerHTML = summaryHtml + `
      <table class="data-table report-table">
        <thead><tr><th>Dia</th><th>Horas</th><th>Valor</th><th></th></tr></thead>
        <tbody>${data.map((d) => {
          const secs = parseFloat(d.total_seconds) || 0;
          const amount = parseFloat(d.total_amount) || 0;
          const pct = maxSeconds > 0 ? (secs / maxSeconds) * 100 : 0;
          const day = formatReportDay(d.day);
          return `<tr>
            <td>${day}</td>
            <td>${renderDurationCell(secs)}</td>
            <td class="report-money">${formatMoney(amount)}</td>
            <td style="width:40%"><div class="bar-track" style="height:8px"><div class="bar-fill" style="width:${pct}%"></div></div></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td><strong>Total</strong></td>
          <td>${renderDurationCell(totalSeconds)}</td>
          <td class="report-money"><strong>${formatMoney(totalAmount)}</strong></td>
          <td></td>
        </tr></tfoot>
      </table>`;
    return;
  }

  if (groupBy === 'project') {
    el.innerHTML = summaryHtml + `
      <table class="data-table report-table">
        <thead><tr><th>Projeto</th><th>Horas</th><th>Taxa/h</th><th>Valor total</th><th></th></tr></thead>
        <tbody>${data.map((d) => {
          const secs = parseFloat(d.total_seconds) || 0;
          const amount = parseFloat(d.total_amount) || 0;
          const pct = maxSeconds > 0 ? (secs / maxSeconds) * 100 : 0;
          const label = d.name || 'Sem projeto';
          const color = d.color || 'var(--text-muted)';
          const rate = d.hourly_rate ? formatMoney(d.hourly_rate) : '—';
          return `<tr>
            <td><span class="project-dot" style="background:${color}"></span>${label}</td>
            <td>${renderDurationCell(secs)}</td>
            <td>${rate}</td>
            <td class="report-money">${amount > 0 ? formatMoney(amount) : '—'}</td>
            <td style="width:30%"><div class="bar-track" style="height:8px"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td><strong>Total</strong></td>
          <td>${renderDurationCell(totalSeconds)}</td>
          <td></td>
          <td class="report-money"><strong>${formatMoney(totalAmount)}</strong></td>
          <td></td>
        </tr></tfoot>
      </table>`;
    return;
  }

  // groupBy === 'user'
  el.innerHTML = summaryHtml + `
    <table class="data-table report-table">
      <thead><tr><th>Usuário</th><th>Horas</th><th>Valor total</th><th></th></tr></thead>
      <tbody>${data.map((d) => {
        const secs = parseFloat(d.total_seconds) || 0;
        const amount = parseFloat(d.total_amount) || 0;
        const pct = maxSeconds > 0 ? (secs / maxSeconds) * 100 : 0;
        const color = d.avatar_color || 'var(--primary)';
        return `<tr>
          <td><span class="user-avatar" style="background:${color};width:24px;height:24px;font-size:11px;display:inline-flex;margin-right:8px">${d.name.charAt(0)}</span>${d.name}</td>
          <td>${renderDurationCell(secs)}</td>
          <td class="report-money">${amount > 0 ? formatMoney(amount) : '—'}</td>
          <td style="width:30%"><div class="bar-track" style="height:8px"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr>
        <td><strong>Total</strong></td>
        <td>${renderDurationCell(totalSeconds)}</td>
        <td class="report-money"><strong>${formatMoney(totalAmount)}</strong></td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

// ─── Init ───────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupAuthForms();
  init();
});
