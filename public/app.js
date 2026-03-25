// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateBadge(state) {
  const cls = {
    'New':           'badge-new',
    'Investigating': 'badge-investigating',
    'Resolved':      'badge-resolved',
  }[state] || 'badge-new';
  return `<span class="badge ${cls}">${state}</span>`;
}

function actionButtons(inc) {
  const id    = inc.sys_id;
  const state = inc.state;
  const canInvestigate = state === 'New';
  const canResolve     = state === 'New' || state === 'Investigating';
  return `
    <button class="action-btn investigate" data-action="Investigating" data-sys-id="${id}" ${canInvestigate ? '' : 'disabled'}>Investigate</button>
    <button class="action-btn resolve"     data-action="Resolved"      data-sys-id="${id}" ${canResolve     ? '' : 'disabled'}>Resolve</button>
  `;
}

function incidentLi(inc) {
  const li = document.createElement('li');
  li.id = `inc-${inc.sys_id}`;
  li.innerHTML = `
    <span class="dot dot-${inc.assigned_team === 'Team A' ? 'a' : 'b'}"></span>
    <span style="flex:1;font-weight:600">${inc.number || inc.sys_id.slice(0,8)}</span>
    ${stateBadge(inc.state)}
  `;
  return li;
}

function teamLi(inc) {
  const li = document.createElement('li');
  li.id = `team-${inc.sys_id}`;
  li.innerHTML = `
    <span style="flex:1;font-weight:600">${inc.number || inc.sys_id.slice(0,8)}</span>
    <span style="flex:2;font-size:.8rem;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${inc.short_description || ''}</span>
    ${stateBadge(inc.state)}
    ${actionButtons(inc)}
  `;
  return li;
}

// ─── DOM update functions ──────────────────────────────────────────────────────

function addEventRow(evt) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot dot-info"></span><span>${evt.name}</span><span style="margin-left:auto;font-size:.75rem;color:#64748b">${new Date(evt.sys_created_on).toLocaleTimeString()}</span>`;
  document.getElementById('event-list').prepend(li);
}

function addIncidentRow(inc) {
  // Incident list panel
  const incList = document.getElementById('incident-list');
  const existing = document.getElementById(`inc-${inc.sys_id}`);
  if (existing) {
    existing.replaceWith(incidentLi(inc));
  } else {
    incList.prepend(incidentLi(inc));
  }

  // Team queue panel
  const teamListId = inc.assigned_team === 'Team A' ? 'team-a-list' : 'team-b-list';
  const teamList   = document.getElementById(teamListId);
  const teamExisting = document.getElementById(`team-${inc.sys_id}`);
  if (teamExisting) {
    teamExisting.replaceWith(teamLi(inc));
  } else {
    teamList.prepend(teamLi(inc));
  }
}

function updateIncidentRow(inc) {
  // Re-render in place (incident list)
  const incEl = document.getElementById(`inc-${inc.sys_id}`);
  if (incEl) incEl.replaceWith(incidentLi(inc));

  // Re-render in place (team panel)
  const teamEl = document.getElementById(`team-${inc.sys_id}`);
  if (teamEl) teamEl.replaceWith(teamLi(inc));
}

function addNotificationRow(notif) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="dot dot-info"></span>${notif.message || ''}`;
  document.getElementById('notification-list').prepend(li);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.getElementById('toast-container').appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

function openSSE() {
  const evtSource = new EventSource('/api/sse');

  evtSource.onmessage = (e) => {
    let parsed;
    try { parsed = JSON.parse(e.data); } catch { return; }
    const { type, data } = parsed;

    switch (type) {
      case 'event_created':        addEventRow(data);        break;
      case 'incident_created':     addIncidentRow(data);     break;
      case 'incident_updated':     updateIncidentRow(data);  break;
      case 'notification_created': addNotificationRow(data); break;
      case 'toast':                showToast(data.message);  break;
    }
  };

  evtSource.onerror = () => {
    // Browser will auto-reconnect on error — no manual handling needed
  };
}

// ─── Initial data load ────────────────────────────────────────────────────────

async function loadInitialData() {
  try {
    // Load existing incidents
    const incRes = await fetch('/api/now/table/incident?sysparm_limit=100');
    const { result: incidents } = await incRes.json();
    for (const inc of [...incidents].reverse()) {
      addIncidentRow(inc);
    }

    // Load notification history
    const notifRes = await fetch('/api/now/table/sys_notification?sysparm_limit=50');
    const { result: notifs } = await notifRes.json();
    for (const n of notifs) {
      addNotificationRow(n);
    }

    // Load recent events
    const evtRes = await fetch('/api/now/table/sysevent?sysparm_limit=50');
    const { result: events } = await evtRes.json();
    for (const evt of events) {
      addEventRow(evt);
    }
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }
}

// ─── Button handlers ──────────────────────────────────────────────────────────

document.getElementById('btn-service-a').addEventListener('click', () => {
  fetch('/api/now/event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: 'service_a.triggered', parm1: 'Disk usage critical' }),
  });
});

document.getElementById('btn-service-b').addEventListener('click', () => {
  fetch('/api/now/event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: 'service_b.triggered', parm1: 'CPU spike detected' }),
  });
});

// ─── Incident action buttons in team panels (delegated) ───────────────────────

async function handleIncidentAction(e) {
  const btn = e.target.closest('[data-action][data-sys-id]');
  if (!btn || btn.disabled) return;

  const { action, sysId } = btn.dataset;
  btn.disabled = true;

  await fetch(`/api/now/table/incident/${sysId}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ state: action }),
  });
}

document.getElementById('team-a-list').addEventListener('click', handleIncidentAction);
document.getElementById('team-b-list').addEventListener('click', handleIncidentAction);

// ─── Clear all data ────────────────────────────────────────────────────────────

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('Clear all incidents, events, and notifications?')) return;

  await fetch('/api/admin/clear', { method: 'DELETE' });

  document.getElementById('incident-list').innerHTML    = '';
  document.getElementById('team-a-list').innerHTML      = '';
  document.getElementById('team-b-list').innerHTML      = '';
  document.getElementById('event-list').innerHTML       = '';
  document.getElementById('notification-list').innerHTML = '';
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

openSSE();
loadInitialData();
