# Mini ServiceNow Platform — Implementation Plan

## Context

Building a mini ServiceNow-inspired event management platform with a live UI and backend server. The backend mimics the GlideScript API (GlideRecord, gs, GlideDateTime) using Node.js + MongoDB. The frontend is a single HTML page that shows two service buttons, a live event/incident feed, and two team queues where incidents land. Business rules automatically create and route incidents when events are fired.

Project lives at: `C:/Users/Raymo/code/mini_ServiceNow/` (currently empty).

---

## Tech Stack

- **Runtime:** Node.js (ES2022, ESM — `"type": "module"`)
- **HTTP:** Express.js (serves both API and static frontend)
- **Database:** MongoDB via Mongoose
- **Real-time UI updates:** Server-Sent Events (SSE) — built into browsers, no extra package
- **Script sandbox:** Worker Threads (Node built-in)
- **HTTP requests in scripts:** native `fetch` (Node 18+)
- **Config:** dotenv

No email library needed — notifications are simulated as toast banners in the UI pushed via SSE.

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────┐
│      [ Fire Service A Event ]    [ Fire Service B Event ]    │  TOP
├─────────────────┬────────────────┬───────────────────────────┤
│   Event Log     │  Incident List │   Notification Log        │  MIDDLE
│  ────────────   │  ───────────── │  ─────────────────────    │
│  ● svc_a.event  │  INC001 [New]  │  📧 INC001 → Team A       │
│  ● svc_b.event  │  INC002 [Inv]  │  📧 INC002 → Team B       │
├─────────────────┴────────────────┴───────────────────────────┤
│        Team A                    │        Team B             │  BOTTOM
│  ─────────────────               │  ─────────────────        │
│  INC001  [Invest] [Res]          │  INC002  [Invest] [Res]   │
│  INC003  [Invest] [Res]          │  INC004  [Invest] [Res]   │
└──────────────────────────────────┴───────────────────────────┘
```

- Clicking **Fire Service A Event** sends `POST /api/now/event` with `name: "service_a.triggered"`
- Clicking **Fire Service B Event** sends `POST /api/now/event` with `name: "service_b.triggered"`
- The server processes the event → business rule creates an incident → dispatches to Team A or Team B
- All panels update live via SSE (no page reload)
- A toast notification slides in when an incident is created or status changes

---

## Event → Incident Flow

```
User clicks button
  → POST /api/now/event { name: "service_a.triggered", parm1: "Service A" }
  → gs.eventQueue() → SysEvent inserted (state: ready)
  → EventProcessor picks it up (polling every 3s)
  → BusinessRuleEngine: finds sys_script where collection="sysevent" + event_name matches
  → Business rule script runs in Worker Thread:
        const inc = new GlideRecord('incident');
        inc.setValue('short_description', 'Issue from ' + current.getValue('parm1'));
        inc.setValue('assigned_team', 'Team A');   // Service A → Team A
        inc.setValue('state', 'New');
        await inc.insert();
  → Incident saved to MongoDB
  → SSE broadcast: { type: 'incident_created', data: { ...incident } }
  → SSE broadcast: { type: 'toast', message: 'Incident INC0001001 created for Team A' }
  → UI updates all panels in real time
```

---

## Project Structure

```
mini_ServiceNow/
├── package.json                        # "type": "module", no build step
├── .env.example
├── public/                             # Static frontend (served by Express)
│   ├── index.html                      # Single page — all 3 sections
│   ├── style.css                       # Layout + toast styles
│   └── app.js                          # fetch() calls + SSE listener + DOM updates
├── src/
│   ├── index.js                        # Express bootstrap + EventProcessor start
│   ├── config/
│   │   └── database.js                 # Mongoose connect
│   ├── db/
│   │   └── models/
│   │       ├── SysEvent.js             # sysevent collection
│   │       ├── SysScript.js            # sys_script (business rules)
│   │       ├── SysProperties.js        # sys_properties
│   │       ├── SysLog.js               # sys_log
│   │       ├── SysNotification.js      # notification log collection
│   │       └── Incident.js             # incident collection
│   ├── glide/
│   │   ├── GlideRecord.js              # Async ORM (Mongoose-backed)
│   │   ├── GlideDateTime.js            # Date/time utility (pure)
│   │   ├── GlideElement.js             # Field value wrapper
│   │   ├── GlideSystem.js              # gs singleton
│   │   └── index.js                    # Barrel export
│   ├── engine/
│   │   ├── sandbox-runner.js           # Worker thread entry point — runs user scripts
│   │   ├── Sandbox.js                  # Spawns worker thread, passes context, enforces timeout
│   │   ├── BusinessRuleEngine.js       # Loads sys_script docs, runSync(), runAsync()
│   │   ├── EventQueue.js               # enqueue() / dequeue() on sysevent collection
│   │   └── EventProcessor.js           # setInterval polling loop, dispatches events
│   ├── sse/
│   │   └── SseManager.js               # Manages SSE client connections, broadcast()
│   ├── services/
│   │   └── TableService.js             # CRUD orchestration for Table API
│   └── api/
│       ├── router.js
│       ├── middleware/
│       │   ├── errorHandler.js
│       │   └── requestLogger.js
│       └── routes/
│           ├── tableApi.js             # GET/POST /api/now/table/:tableName
│           ├── recordApi.js            # GET/PATCH/DELETE /api/now/table/:tableName/:sys_id
│           ├── eventApi.js             # POST /api/now/event (trigger events)
│           └── sseApi.js               # GET /api/sse (SSE stream endpoint)
```

---

## Data Models (Mongoose Schemas)

All collections share a base plugin that adds:
```
sys_id (UUID string, unique), sys_created_on, sys_updated_on, sys_created_by, sys_updated_by
```

### `Incident`
```js
{
  number:            String,   // auto-generated: INC0001001, INC0001002, ...
  short_description: String (required),
  description:       String,
  state:             String (enum: New | Investigating | Resolved, default: New),
  assigned_team:     String (enum: Team A | Team B),
  source_event:      String,   // sys_id of triggering sysevent
  source_service:    String,   // "Service A" or "Service B"
  resolved_at:       Date
}
```

### `SysEvent`
```js
{
  name:          String (required),   // e.g. "service_a.triggered"
  instance:      String,              // sys_id of related record (optional)
  parm1:         String,
  parm2:         String,
  table_name:    String,
  state:         String (enum: ready | processing | processed | error, default: ready),
  process_on:    Date (default: now),
  processed_on:  Date,
  error_message: String
}
Index: { state: 1, process_on: 1 }
```

### `SysScript` — Business Rules
```js
{
  name:          String (required),
  collection:    String (required),   // "sysevent" for event-triggered rules
  event_name:    String,              // matches sysevent.name (e.g. "service_a.triggered")
  when_to_run:   String (enum: before | after | async),
  action_insert: Boolean,
  action_update: Boolean,
  action_delete: Boolean,
  order_num:     Number (default: 100),
  active:        Boolean (default: true),
  script:        String (required),
  condition:     String
}
```

### `SysNotification` — Notification Log
```js
{
  message:          String (required),   // "Incident INC0001001 created for Team A"
  type:             String (enum: incident_created | incident_updated | info),
  related_incident: String,              // sys_id of related incident (if any)
  related_event:    String,              // sys_id of triggering sysevent (if any)
  team:             String               // "Team A" or "Team B" (if applicable)
}
```
Every call to `gs.broadcast('toast', ...)` also writes a `SysNotification` doc and pushes a `notification_created` SSE event to update the log panel live.

### `SysProperties`
```js
{ name: String (unique), value: String, type: String, description: String }
```

### `SysLog`
```js
{ level: String, message: String, source: String, sys_id_ref: String }
```

---

## GlideScript API

### GlideRecord (async — MongoDB/Mongoose backed)
```js
const gr = new GlideRecord('incident');
gr.addQuery('state', 'New');
gr.addQuery('severity', '<=', 2);
gr.addEncodedQuery('state=New^assigned_team=Team A');
gr.orderBy('sys_created_on');
gr.setLimit(50);

await gr.query();          // executes Mongoose find()
gr.next();                 // advance cursor (sync, after query loaded results)
await gr.get(sys_id);      // findOne by sys_id
await gr.get('state','New'); // findOne by field

gr.getValue('state');      // get field value
gr.setValue('state', 'Investigating');
gr.state;                  // Proxy shorthand for getValue('state')
gr.state = 'Resolved';     // Proxy shorthand for setValue

await gr.insert();         // → sys_id (fires before/after INSERT business rules)
await gr.update();         // (fires before/after UPDATE business rules)
await gr.deleteRecord();
gr.getTableName();
gr.isNewRecord();
gr.getUniqueValue();       // returns sys_id
```

### GlideSystem — `gs` (singleton, exported)
```js
gs.log(msg, source?)       // → SysLog doc + console
gs.info / warn / error / debug(msg, source?)
await gs.eventQueue(name, gr, parm1?, parm2?)  // → SysEvent doc
await gs.getProperty(name, default?)
await gs.setProperty(name, value)
gs.now()                   // ISO timestamp string (sync)
gs.generateGuid()          // crypto.randomUUID() (sync)
gs.nil(value)              // true if null/undefined/'' (sync)
gs.broadcast(type, data)   // sends SSE event to all connected UI clients
```

`gs.broadcast()` is the new addition — it lets business rule scripts push UI updates directly:
```js
// Inside a business rule script:
gs.broadcast('toast', { message: 'Incident created for Team A' });
gs.broadcast('incident_created', incidentData);
```

### GlideDateTime (pure, sync)
```js
new GlideDateTime(isoString?)
.getValue()         // ISO string
.getDisplayValue()  // human-readable
.addDays(n) / .addSeconds(n) / .addMonths(n)
.getNumericValue()  // ms since epoch
.before(other) / .after(other)
```

---

## Worker Thread Sandbox

Business rule scripts run in a **worker thread** (`sandbox-runner.js`), isolated from the main process.

### How it works:
1. `Sandbox.js` spawns a `new Worker('./src/engine/sandbox-runner.js', { workerData })`
2. `workerData` contains: `{ script, currentData, previousData, gsData }`
3. `sandbox-runner.js` reconstructs lightweight GlideRecord/gs objects from the serialized data
4. The user script runs via `eval()` inside the worker
5. Side effects (setValue calls, gs.eventQueue calls, gs.broadcast calls, setAbortAction) are collected into a result object
6. Worker posts result back via `parentPort.postMessage(result)`
7. Main thread receives result, applies side effects (actual DB writes, SSE broadcasts)
8. Timeout: `worker.terminate()` called after 5000ms (configurable via sys_properties)

### Sandbox context available in scripts:
```js
current       // GlideRecord-like object (serialized)
previous      // previous state (null for insert)
gs            // subset of GlideSystem (log, eventQueue queued, broadcast queued)
GlideRecord   // can instantiate for additional queries
GlideDateTime // date utility
```

---

## SSE (Server-Sent Events)

`GET /api/sse` — browser opens this connection once on page load and keeps it open.

`SseManager.js` maintains a list of active response objects and provides:
```js
SseManager.addClient(res)     // add new SSE client
SseManager.removeClient(res)  // cleanup on disconnect
SseManager.broadcast(type, data)  // sends to all connected clients
```

Event types pushed to UI:
| Type | Trigger | UI Action |
|---|---|---|
| `event_created` | new sysevent inserted | add row to Event Log panel |
| `incident_created` | new incident inserted | add row to Incident List + correct Team panel, show toast |
| `incident_updated` | incident state changed | update row in both Incident List and Team panel |
| `notification_created` | notification log entry saved | add row to Notification Log panel |
| `toast` | any broadcast from business rule | show toast banner (auto-dismisses after 3s) |

---

## REST API

```
GET  /                                    → serves public/index.html
GET  /api/sse                             → SSE stream
GET  /api/now/table/sys_notification      → fetch notification log history (on page load)

POST /api/now/event                       → trigger event (fires EventQueue)
     Body: { name, parm1?, parm2?, table_name?, instance? }

GET  /api/now/table/:table                → list documents (sysparm_query, limit, offset)
POST /api/now/table/:table                → create document
GET  /api/now/table/:table/:sys_id        → get single document
PATCH /api/now/table/:table/:sys_id       → update document (state changes fire SSE)
DELETE /api/now/table/:table/:sys_id      → delete document
```

State transitions on `PATCH /api/now/table/incident/:sys_id`:
- `New → Investigating` ✓
- `Investigating → Resolved` ✓
- `Resolved → New` ✗ (returns 400)
- Each valid transition broadcasts `incident_updated` SSE event

---

## Seed Data (loaded on first startup)

Two default business rules inserted into `sys_script` collection:

**Rule 1 — Service A creates incident for Team A:**
```js
// name: "Service A - Create Incident"
// collection: "sysevent", event_name: "service_a.triggered"
const inc = new GlideRecord('incident');
await inc.newRecord();
inc.setValue('short_description', 'Alert from Service A: ' + current.getValue('parm1'));
inc.setValue('assigned_team', 'Team A');
inc.setValue('source_service', 'Service A');
inc.setValue('source_event', current.getUniqueValue());
const sysId = await inc.insert();
gs.broadcast('toast', { message: 'Incident created and routed to Team A' });
gs.broadcast('notification_log', {
  message: inc.getValue('number') + ' created and assigned to Team A',
  type: 'incident_created',
  related_incident: sysId,
  team: 'Team A'
});
```

**Rule 2 — Service B creates incident for Team B:**
```js
// name: "Service B - Create Incident"
// collection: "sysevent", event_name: "service_b.triggered"
const inc = new GlideRecord('incident');
await inc.newRecord();
inc.setValue('short_description', 'Alert from Service B: ' + current.getValue('parm1'));
inc.setValue('assigned_team', 'Team B');
inc.setValue('source_service', 'Service B');
inc.setValue('source_event', current.getUniqueValue());
const sysId = await inc.insert();
gs.broadcast('toast', { message: 'Incident created and routed to Team B' });
gs.broadcast('notification_log', {
  message: inc.getValue('number') + ' created and assigned to Team B',
  type: 'incident_created',
  related_incident: sysId,
  team: 'Team B'
});
```

---

## Frontend (public/)

**`index.html`** — single page, 3-section grid layout (CSS Grid)

**`style.css`:**
- CSS Grid: top bar / middle split / bottom split
- Toast styles: fixed bottom-right, slide-in animation, auto-fade
- Incident row action buttons: `[Investigating]` `[Resolved]` with color-coded states

**`app.js`:**
```js
// On load: open SSE, fetch initial data
const evtSource = new EventSource('/api/sse');
evtSource.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'event_created')    addEventRow(data);
  if (type === 'incident_created') addIncidentRow(data);
  if (type === 'incident_updated') updateIncidentRow(data);
  if (type === 'toast')            showToast(data.message);
};

// Button handlers
document.getElementById('btn-service-a').addEventListener('click', () => {
  fetch('/api/now/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'service_a.triggered', parm1: 'Disk usage critical' })
  });
});

// Incident action buttons (delegated event listener)
document.getElementById('incident-list').addEventListener('click', async (e) => {
  if (e.target.dataset.action && e.target.dataset.sysId) {
    await fetch(`/api/now/table/incident/${e.target.dataset.sysId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: e.target.dataset.action })
    });
  }
});
```

---

## Implementation Order

1. **Foundation** — `package.json`, `database.js`, all 5 Mongoose models
2. **GlideScript API** — `GlideDateTime.js`, `GlideElement.js`, `GlideRecord.js` (stub business rules), `GlideSystem.js` (stub eventQueue + broadcast)
3. **SSE Manager** — `SseManager.js`, wire `gs.broadcast()` to it
4. **Worker Thread Sandbox** — `sandbox-runner.js`, `Sandbox.js`
5. **Business Rule Engine** — `BusinessRuleEngine.js`, wire into GlideRecord CRUD and EventProcessor
6. **Event Queue + Processor** — `EventQueue.js`, implement `gs.eventQueue()`, `EventProcessor.js`
7. **REST API** — middleware, `TableService.js`, route files, `router.js`, `index.js`
8. **Seed data** — insert default sys_script rules on startup if collection empty
9. **Frontend** — `index.html`, `style.css`, `app.js`

---

## Verification

- Start server, open `http://localhost:3000` in browser
- Click **Fire Service A Event** → Event Log shows new entry → Team A panel gains a new incident row → toast appears
- Click **Fire Service B Event** → same for Team B
- Click **[Investigating]** on an incident → row updates state in real time across all panels
- Click **[Resolved]** → state updates, resolved_at timestamp set
- Check MongoDB: `sysevent` doc has `state: processed`, `incident` doc exists with correct team
