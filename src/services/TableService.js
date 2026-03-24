import mongoose from 'mongoose';
import { sseManager } from '../sse/SseManager.js';

const TABLE_MODEL_MAP = {
  incident:         'Incident',
  sysevent:         'SysEvent',
  sys_script:       'SysScript',
  sys_notification: 'SysNotification',
  sys_properties:   'SysProperties',
  sys_log:          'SysLog',
};

function getModel(tableName) {
  const name = TABLE_MODEL_MAP[tableName];
  if (!name) throw Object.assign(new Error(`Unknown table: "${tableName}"`), { status: 404 });
  return mongoose.model(name);
}

// Parse sysparm_query string into a Mongoose filter object
function parseQuery(queryString) {
  if (!queryString) return {};
  const filter = {};
  for (const part of queryString.split('^')) {
    const m = part.match(/^(\w+)(!=|<=|>=|<|>|=|LIKE|IN|STARTSWITH)(.+)$/i);
    if (!m) continue;
    const [, field, op, val] = m;
    switch (op.toUpperCase()) {
      case '=':         filter[field] = val; break;
      case '!=':        filter[field] = { $ne: val }; break;
      case '>':         filter[field] = { $gt: isNaN(val) ? val : +val }; break;
      case '<':         filter[field] = { $lt: isNaN(val) ? val : +val }; break;
      case '>=':        filter[field] = { $gte: isNaN(val) ? val : +val }; break;
      case '<=':        filter[field] = { $lte: isNaN(val) ? val : +val }; break;
      case 'LIKE':      filter[field] = { $regex: val, $options: 'i' }; break;
      case 'STARTSWITH':filter[field] = { $regex: `^${val}`, $options: 'i' }; break;
      case 'IN':        filter[field] = { $in: val.split(',').map(v => v.trim()) }; break;
    }
  }
  return filter;
}

export class TableService {
  // ─── List ─────────────────────────────────────────────────────────────────

  static async list(tableName, { sysparm_query, sysparm_limit = 100, sysparm_offset = 0 } = {}) {
    const model  = getModel(tableName);
    const filter = parseQuery(sysparm_query);
    const docs   = await model.find(filter)
      .sort({ sys_created_on: -1 })
      .skip(Number(sysparm_offset))
      .limit(Number(sysparm_limit))
      .lean();
    return docs;
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  static async create(tableName, body) {
    const model = getModel(tableName);
    const doc   = await model.create(body);
    return doc.toObject();
  }

  // ─── Get one ──────────────────────────────────────────────────────────────

  static async getOne(tableName, sysId) {
    const model = getModel(tableName);
    const doc   = await model.findOne({ sys_id: sysId }).lean();
    if (!doc) throw Object.assign(new Error('Record not found'), { status: 404 });
    return doc;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  static async update(tableName, sysId, body) {
    const model = getModel(tableName);
    const doc   = await model.findOne({ sys_id: sysId });
    if (!doc) throw Object.assign(new Error('Record not found'), { status: 404 });

    // Validate incident state machine
    if (tableName === 'incident' && body.state) {
      const current = doc.state;
      const next    = body.state;
      if (current === 'Resolved' && next === 'New') {
        throw Object.assign(new Error('Cannot reopen a Resolved incident'), { status: 400 });
      }
      if (next === 'Resolved' && !body.resolved_at) {
        body.resolved_at = new Date();
      }
    }

    Object.assign(doc, body);
    doc.sys_updated_on = new Date();
    const saved = await doc.save();
    const result = saved.toObject();

    // Broadcast incident state changes
    if (tableName === 'incident') {
      sseManager.broadcast('incident_updated', result);
    }

    return result;
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  static async remove(tableName, sysId) {
    const model = getModel(tableName);
    const doc   = await model.findOneAndDelete({ sys_id: sysId });
    if (!doc) throw Object.assign(new Error('Record not found'), { status: 404 });
    return { deleted: true, sys_id: sysId };
  }
}
