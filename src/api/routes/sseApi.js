import { Router } from 'express';
import { sseManager } from '../../sse/SseManager.js';

const router = Router();

// GET /api/sse — establishes a persistent SSE stream
router.get('/', (req, res) => {
  sseManager.addClient(res);
});

export default router;
