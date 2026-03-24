import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectDB }          from './config/database.js';
import { sseManager }         from './sse/SseManager.js';
import { gs }                 from './glide/GlideSystem.js';
import { BusinessRuleEngine } from './engine/BusinessRuleEngine.js';
import { EventProcessor }     from './engine/EventProcessor.js';
import apiRouter              from './api/router.js';
import { errorHandler }       from './api/middleware/errorHandler.js';
import { requestLogger }      from './api/middleware/requestLogger.js';

// ─── Import models so Mongoose registers them ─────────────────────────────────
import './db/models/Incident.js';
import './db/models/SysEvent.js';
import './db/models/SysScript.js';
import './db/models/SysNotification.js';
import './db/models/SysProperties.js';
import './db/models/SysLog.js';

import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mini_servicenow';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  // 1. Connect to MongoDB
  await connectDB();

  // 2. Wire gs → sseManager (breaks import circularity)
  gs._setSseManager(sseManager);

  // 3. Seed default business rules if not present
  await seedBusinessRules();

  // 4. Create engine + processor
  const engine    = new BusinessRuleEngine(MONGO_URI, sseManager);
  const processor = new EventProcessor(engine);

  // 5. Build Express app
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  // Serve static frontend
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // API routes
  app.use('/api', apiRouter);

  // Catch-all: serve index.html for client-side navigation
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.use(errorHandler);

  // 6. Start HTTP server
  app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });

  // 7. Start event polling
  processor.start();
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

async function seedBusinessRules() {
  const SysScript = mongoose.model('SysScript');
  const count     = await SysScript.countDocuments();
  if (count > 0) return;

  gs.info('Seeding default business rules…', 'Seed');

  await SysScript.insertMany([
    {
      name:         'Service A - Create Incident',
      collection:   'sysevent',
      event_name:   'service_a.triggered',
      when_to_run:  'async',
      active:       true,
      order_num:    100,
      script: `
const inc = new GlideRecord('incident');
inc.newRecord();
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
      `.trim(),
    },
    {
      name:         'Service B - Create Incident',
      collection:   'sysevent',
      event_name:   'service_b.triggered',
      when_to_run:  'async',
      active:       true,
      order_num:    100,
      script: `
const inc = new GlideRecord('incident');
inc.newRecord();
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
      `.trim(),
    },
  ]);

  gs.info('Default business rules seeded.', 'Seed');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('[Fatal] Bootstrap failed:', err);
  process.exit(1);
});
