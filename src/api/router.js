import { Router } from 'express';
import tableApi  from './routes/tableApi.js';
import recordApi from './routes/recordApi.js';
import eventApi  from './routes/eventApi.js';
import sseApi    from './routes/sseApi.js';

const router = Router();

// SSE stream
router.use('/sse', sseApi);

// Event trigger
router.use('/now/event', eventApi);

// Table API — collection and single-record routes
router.use('/now/table/:tableName/:sys_id', recordApi);
router.use('/now/table/:tableName',         tableApi);

export default router;
