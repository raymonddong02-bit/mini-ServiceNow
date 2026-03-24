import { Router } from 'express';
import { EventQueue } from '../../engine/EventQueue.js';
import { sseManager } from '../../sse/SseManager.js';

const router = Router();

// POST /api/now/event
// Body: { name, parm1?, parm2?, table_name?, instance? }
router.post('/', async (req, res, next) => {
  try {
    const { name, parm1 = '', parm2 = '', table_name = '', instance = '' } = req.body;
    if (!name) {
      return res.status(400).json({ error: { message: 'Event name is required', status: 400 } });
    }

    const doc = await EventQueue.enqueue({ name, parm1, parm2, table_name, instance });

    // Notify UI immediately so event log updates before the processor picks it up
    sseManager.broadcast('event_created', {
      sys_id:         doc.sys_id,
      name:           doc.name,
      parm1:          doc.parm1,
      parm2:          doc.parm2,
      state:          doc.state,
      sys_created_on: doc.sys_created_on,
    });

    res.status(202).json({ result: { sys_id: doc.sys_id, name: doc.name, state: doc.state } });
  } catch (err) {
    next(err);
  }
});

export default router;
