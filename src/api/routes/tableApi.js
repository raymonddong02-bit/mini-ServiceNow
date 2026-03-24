import { Router } from 'express';
import { TableService } from '../../services/TableService.js';

const router = Router({ mergeParams: true });

// GET /api/now/table/:tableName
router.get('/', async (req, res, next) => {
  try {
    const { tableName } = req.params;
    const docs = await TableService.list(tableName, req.query);
    res.json({ result: docs });
  } catch (err) {
    next(err);
  }
});

// POST /api/now/table/:tableName
router.post('/', async (req, res, next) => {
  try {
    const { tableName } = req.params;
    const doc = await TableService.create(tableName, req.body);
    res.status(201).json({ result: doc });
  } catch (err) {
    next(err);
  }
});

export default router;
