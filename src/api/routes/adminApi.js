import { Router } from 'express';
import { TableService } from '../../services/TableService.js';

const router = Router();

// DELETE /api/admin/clear — wipe all incidents, events, and notifications
router.delete('/clear', async (req, res, next) => {
  try {
    const result = await TableService.clearAll();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
