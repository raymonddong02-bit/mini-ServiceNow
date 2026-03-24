import { Router } from 'express';
import { TableService } from '../../services/TableService.js';

const router = Router({ mergeParams: true });

// GET /api/now/table/:tableName/:sys_id
router.get('/', async (req, res, next) => {
  try {
    const { tableName, sys_id } = req.params;
    const doc = await TableService.getOne(tableName, sys_id);
    res.json({ result: doc });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/now/table/:tableName/:sys_id
router.patch('/', async (req, res, next) => {
  try {
    const { tableName, sys_id } = req.params;
    const doc = await TableService.update(tableName, sys_id, req.body);
    res.json({ result: doc });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/now/table/:tableName/:sys_id
router.delete('/', async (req, res, next) => {
  try {
    const { tableName, sys_id } = req.params;
    const result = await TableService.remove(tableName, sys_id);
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

export default router;
