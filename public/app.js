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
  li.dataset.json = JSON.stringify(inc, null, 2);
  li.dataset.incidentId = inc.sys_id;
  if (inc.source_event) li.dataset.eventId = inc.source_event;
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
  li.dataset.json = JSON.stringify(inc, null, 2);
  li.dataset.incidentId = inc.sys_id;
  if (inc.source_event) li.dataset.eventId = inc.source_event;
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
  li.id = `evt-${evt.sys_id}`;
  li.dataset.json = JSON.stringify(evt, null, 2);
  li.dataset.eventId = evt.sys_id;
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
  li.dataset.json = JSON.stringify(notif, null, 2);
  if (notif.related_incident) li.dataset.incidentId = notif.related_incident;
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

// ─── JSON tooltip on hover ─────────────────────────────────────────────────────

const tooltip = document.createElement('div');
tooltip.className = 'json-tooltip';
document.body.appendChild(tooltip);

document.addEventListener('mouseenter', (e) => {
  const li = e.target.closest('li[data-json]');
  if (!li) return;
  tooltip.textContent = li.dataset.json;
  tooltip.classList.add('visible');

  const rect = li.getBoundingClientRect();
  tooltip.style.left = `${rect.right + 8}px`;
  tooltip.style.top  = `${rect.top}px`;

  // Keep tooltip within viewport
  const tipRect = tooltip.getBoundingClientRect();
  if (tipRect.right > window.innerWidth) {
    tooltip.style.left = `${rect.left - tipRect.width - 8}px`;
  }
  if (tipRect.bottom > window.innerHeight) {
    tooltip.style.top = `${window.innerHeight - tipRect.height - 8}px`;
  }
}, true);

document.addEventListener('mouseleave', (e) => {
  const li = e.target.closest('li[data-json]');
  if (!li) return;
  tooltip.classList.remove('visible');
}, true);

// ─── Workflow arrows ──────────────────────────────────────────────────────────

const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svgOverlay.id = 'arrow-overlay';
document.body.appendChild(svgOverlay);

// Arrowhead marker
svgOverlay.innerHTML = `
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="#3b82f6"/>
    </marker>
  </defs>
`;

function clearWorkflow() {
  document.querySelectorAll('.wf-highlight').forEach(el => el.classList.remove('wf-highlight'));
  svgOverlay.querySelectorAll('.arrow-path').forEach(p => p.remove());
}

function drawArrow(fromEl, toEl) {
  const fr = fromEl.getBoundingClientRect();
  const tr = toEl.getBoundingClientRect();

  // Start from right-center of source, end at left-center of target
  let x1 = fr.right,  y1 = fr.top + fr.height / 2;
  let x2 = tr.left,   y2 = tr.top + tr.height / 2;

  // If target is mostly below source (different row), use bottom→top
  if (tr.top > fr.bottom - 10) {
    x1 = fr.left + fr.width / 2;  y1 = fr.bottom;
    x2 = tr.left + tr.width / 2;  y2 = tr.top;
  }

  const dx = x2 - x1;
  const cx1 = x1 + dx * 0.5, cy1 = y1;
  const cx2 = x2 - dx * 0.5, cy2 = y2;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`);
  path.setAttribute('class', 'arrow-path');
  path.setAttribute('marker-end', 'url(#arrowhead)');
  svgOverlay.appendChild(path);
}

document.addEventListener('click', (e) => {
  // Ignore action-button clicks
  if (e.target.closest('.action-btn, .btn')) return;

  const li = e.target.closest('li[data-json]');
  clearWorkflow();
  if (!li) return;

  // Resolve the incident and event IDs from whichever row was clicked
  let incidentId = li.dataset.incidentId || null;
  let eventId    = li.dataset.eventId    || null;

  // If we clicked an event but have no incident, search for a matching incident
  if (eventId && !incidentId) {
    const incEl = document.querySelector(`#incident-list li[data-event-id="${eventId}"]`);
    if (incEl) incidentId = incEl.dataset.incidentId;
  }

  // If we have an incident but no event, look it up from the incident row
  if (incidentId && !eventId) {
    const incEl = document.getElementById(`inc-${incidentId}`);
    if (incEl) eventId = incEl.dataset.eventId;
  }

  // Collect workflow elements in order: Event → Incident → Notification → Team
  const chain = [];

  if (eventId) {
    const el = document.getElementById(`evt-${eventId}`);
    if (el) chain.push(el);
  }

  if (incidentId) {
    const el = document.getElementById(`inc-${incidentId}`);
    if (el) chain.push(el);
  }

  if (incidentId) {
    const els = document.querySelectorAll(`#notification-list li[data-incident-id="${incidentId}"]`);
    els.forEach(el => chain.push(el));
  }

  if (incidentId) {
    const el = document.getElementById(`team-${incidentId}`);
    if (el) chain.push(el);
  }

  if (chain.length < 2) return;

  chain.forEach(el => el.classList.add('wf-highlight'));

  for (let i = 0; i < chain.length - 1; i++) {
    drawArrow(chain[i], chain[i + 1]);
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

openSSE();
loadInitialData();
