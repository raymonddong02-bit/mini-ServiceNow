/**
 * Worker thread entry point for running business rule scripts in isolation.
 *
 * workerData shape:
 *   { script, currentData, previousData, tableName, mongoUri }
 *
 * Posts back:
 *   { success, broadcasts, logs, error? }
 */
import { workerData, parentPort } from 'worker_threads';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

// Import real model files so pre-save hooks (e.g. incident auto-number) are registered
import '../db/models/Incident.js';
import '../db/models/SysEvent.js';
import '../db/models/SysScript.js';
import '../db/models/SysNotification.js';
import '../db/models/SysProperties.js';
import '../db/models/SysLog.js';

const { script, currentData, previousData, tableName, mongoUri } = workerData;

// ─── Collected side effects (applied by main thread after worker exits) ────────
const broadcasts = [];
const logs       = [];

// ─── Table → model name map ───────────────────────────────────────────────────
const TABLE_MODEL_MAP = {
  incident:         'Incident',
  sysevent:         'SysEvent',
  sys_script:       'SysScript',
  sys_notification: 'SysNotification',
  sys_properties:   'SysProperties',
  sys_log:          'SysLog',
};

// ─── GlideRecord (sandbox version) ───────────────────────────────────────────
// Real DB ops via Mongoose; broadcasts/eventQueue collected as side effects.

class GlideRecord {
  #tableName;
  #model;
  #filter  = {};
  #sort    = {};
  #limit   = 1000;
  #results = [];
  #cursor  = -1;
  #current = {};
  #isNew   = false;

  constructor(tbl) {
    const modelName = TABLE_MODEL_MAP[tbl];
    if (!modelName) throw new Error(`Unknown table: "${tbl}"`);
    this.#tableName = tbl;
    this.#model     = mongoose.model(modelName);
    return this.#proxy();
  }

  #proxy() {
    return new Proxy(this, {
      get(t, p) {
        if (typeof p === 'symbol') return t[p];
        if (p in t) {
          const val = t[p];
          return typeof val === 'function' ? val.bind(t) : val;
        }
        return t.getValue(p);
      },
      set(t, p, v) {
        if (p in t) { t[p] = v; return true; }
        t.setValue(p, v);
        return true;
      },
    });
  }

  addQuery(field, opOrVal, value) {
    if (value === undefined) {
      this.#filter[field] = opOrVal;
    } else {
      this.#applyOp(this.#filter, field, opOrVal, value);
    }
  }

  #applyOp(obj, field, op, value) {
    switch (op) {
      case '!=': obj[field] = { $ne: value }; break;
      case '>':  obj[field] = { $gt: value }; break;
      case '<':  obj[field] = { $lt: value }; break;
      case '>=': obj[field] = { $gte: value }; break;
      case '<=': obj[field] = { $lte: value }; break;
      default:   obj[field] = value;
    }
  }

  orderBy(field)     { this.#sort[field] =  1; }
  orderByDesc(field) { this.#sort[field] = -1; }
  setLimit(n)        { this.#limit = n; }

  async query() {
    this.#results = await this.#model.find(this.#filter).sort(this.#sort).limit(this.#limit).lean();
    this.#cursor  = -1;
  }

  async get(fieldOrSysId, value) {
    const doc = value === undefined
      ? await this.#model.findOne({ sys_id: fieldOrSysId }).lean()
      : await this.#model.findOne({ [fieldOrSysId]: value }).lean();
    if (doc) { this.#current = doc; this.#isNew = false; return true; }
    return false;
  }

  next() {
    this.#cursor++;
    if (this.#cursor < this.#results.length) {
      this.#current = { ...this.#results[this.#cursor] };
      this.#isNew   = false;
      return true;
    }
    return false;
  }

  getValue(field) {
    const v = this.#current[field];
    return v == null ? '' : String(v);
  }

  setValue(field, value) { this.#current[field] = value; }
  getDisplayValue(field) { return this.getValue(field); }

  initialize() { this.#current = {}; this.#isNew = true; }
  newRecord()  { this.initialize(); }

  async insert() {
    const sysId = randomUUID();
    this.#current.sys_id = sysId;
    const doc   = new this.#model(this.#current);
    const saved = await doc.save();
    this.#current = saved.toObject();
    this.#isNew   = false;

    broadcasts.push({ type: '__db_insert', data: { tableName: this.#tableName, record: this.#current } });
    return sysId;
  }

  async update() {
    if (!this.#current.sys_id) return false;
    this.#current.sys_updated_on = new Date();
    await this.#model.updateOne({ sys_id: this.#current.sys_id }, { $set: this.#current });
    broadcasts.push({ type: '__db_update', data: { tableName: this.#tableName, record: this.#current } });
    return true;
  }

  async deleteRecord() {
    if (!this.#current.sys_id) return false;
    await this.#model.deleteOne({ sys_id: this.#current.sys_id });
    return true;
  }

  getTableName()   { return this.#tableName; }
  isNewRecord()    { return this.#isNew; }
  isValid()        { return !!this.#current.sys_id; }
  getUniqueValue() { return this.#current.sys_id || ''; }
  toObject()       { return { ...this.#current }; }
  setAbortAction() {}  // no-op inside sandbox
}

// ─── GlideDateTime ────────────────────────────────────────────────────────────

class GlideDateTime {
  #date;
  constructor(iso) { this.#date = iso ? new Date(iso) : new Date(); }
  getValue()        { return this.#date.toISOString(); }
  getDisplayValue() { return this.#date.toLocaleString(); }
  getNumericValue() { return this.#date.getTime(); }
  addDays(n)    { this.#date = new Date(this.#date.getTime() + n * 86400000); return this; }
  addSeconds(n) { this.#date = new Date(this.#date.getTime() + n * 1000);     return this; }
  addMonths(n)  { const d = new Date(this.#date); d.setMonth(d.getMonth() + n); this.#date = d; return this; }
  before(other) { return this.#date < new Date(other instanceof GlideDateTime ? other.getValue() : other); }
  after(other)  { return this.#date > new Date(other instanceof GlideDateTime ? other.getValue() : other); }
}

// ─── gs (sandbox mock — broadcasts collected, not sent immediately) ────────────

const gs = {
  log  (msg, src = 'script') { logs.push({ level: 'info',  message: String(msg), source: src }); },
  info (msg, src = 'script') { logs.push({ level: 'info',  message: String(msg), source: src }); },
  warn (msg, src = 'script') { logs.push({ level: 'warn',  message: String(msg), source: src }); },
  error(msg, src = 'script') { logs.push({ level: 'error', message: String(msg), source: src }); },
  debug(msg, src = 'script') { logs.push({ level: 'debug', message: String(msg), source: src }); },
  now()          { return new Date().toISOString(); },
  generateGuid() { return randomUUID(); },
  nil(v)         { return v === null || v === undefined || v === ''; },

  broadcast(type, data) {
    broadcasts.push({ type, data });
  },

  async eventQueue(name, gr = null, parm1 = '', parm2 = '') {
    broadcasts.push({
      type: '__eventQueue',
      data: { name, instance: gr?.getUniqueValue() ?? '', parm1: parm1 || '', parm2: parm2 || '', table_name: gr?.getTableName() ?? '' },
    });
  },

  async getProperty(name, defaultValue = null) {
    try {
      const doc = await mongoose.model('SysProperties').findOne({ name }).lean();
      return doc ? doc.value : defaultValue;
    } catch { return defaultValue; }
  },
};

// ─── Populate a GlideRecord from serialized field data ────────────────────────

function buildRecord(data, tbl) {
  const rec = new GlideRecord(tbl);
  rec.newRecord();
  for (const [k, v] of Object.entries(data || {})) {
    rec.setValue(k, v == null ? '' : String(v));
  }
  return rec;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const current  = buildRecord(currentData, tableName);
  const previous = previousData ? buildRecord(previousData, tableName) : null;

  // Run the user script with sandbox globals in scope
  await eval(`(async () => { ${script} })()`);

  parentPort.postMessage({ success: true, broadcasts, logs });
} catch (err) {
  parentPort.postMessage({ success: false, error: err.message, broadcasts, logs });
} finally {
  try { await mongoose.disconnect(); } catch { /* ignore */ }
}
