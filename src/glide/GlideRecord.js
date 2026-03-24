import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

// Map of table name → Mongoose model name
const TABLE_MODEL_MAP = {
  incident:         'Incident',
  sysevent:         'SysEvent',
  sys_script:       'SysScript',
  sys_notification: 'SysNotification',
  sys_properties:   'SysProperties',
  sys_log:          'SysLog',
};

function getModel(tableName) {
  const modelName = TABLE_MODEL_MAP[tableName];
  if (!modelName) throw new Error(`Unknown table: "${tableName}"`);
  return mongoose.model(modelName);
}

// Parse ServiceNow-style encoded query: "state=New^assigned_team=Team A^severity<=2"
function parseEncodedQuery(encoded) {
  const filter = {};
  const parts = encoded.split('^');
  for (const part of parts) {
    const match = part.match(/^(\w+)(<=|>=|!=|<|>|=|STARTSWITH|LIKE|IN)(.+)$/i);
    if (!match) continue;
    const [, field, op, val] = match;
    switch (op.toUpperCase()) {
      case '=':         filter[field] = val; break;
      case '!=':        filter[field] = { $ne: val }; break;
      case '>':         filter[field] = { $gt: isNaN(val) ? val : Number(val) }; break;
      case '<':         filter[field] = { $lt: isNaN(val) ? val : Number(val) }; break;
      case '>=':        filter[field] = { $gte: isNaN(val) ? val : Number(val) }; break;
      case '<=':        filter[field] = { $lte: isNaN(val) ? val : Number(val) }; break;
      case 'LIKE':      filter[field] = { $regex: val, $options: 'i' }; break;
      case 'STARTSWITH':filter[field] = { $regex: `^${val}`, $options: 'i' }; break;
      case 'IN':        filter[field] = { $in: val.split(',').map(v => v.trim()) }; break;
    }
  }
  return filter;
}

export class GlideRecord {
  #tableName;
  #model;
  #filter = {};
  #orConditions = [];
  #sort = {};
  #limit = 1000;
  #results = [];
  #cursor = -1;
  #current = {};
  #isNew = false;
  #abortAction = false;
  #businessRuleEngine = null;

  constructor(tableName) {
    this.#tableName = tableName;
    this.#model = getModel(tableName);
    return this.#createProxy();
  }

  #createProxy() {
    return new Proxy(this, {
      get(target, prop) {
        if (typeof prop === 'symbol') return target[prop];
        if (prop in target) {
          const val = target[prop];
          // Bind methods to the real instance so private fields (#current, etc.) are accessible
          return typeof val === 'function' ? val.bind(target) : val;
        }
        // Proxy field access: gr.state → gr.getValue('state')
        return target.getValue(prop);
      },
      set(target, prop, value) {
        if (prop in target) { target[prop] = value; return true; }
        // Proxy field set: gr.state = 'New' → gr.setValue('state', 'New')
        target.setValue(prop, value);
        return true;
      }
    });
  }

  // ─── Query building (sync) ────────────────────────────────────────────────

  addQuery(field, operatorOrValue, value) {
    if (value === undefined) {
      // Two-arg form: addQuery('state', 'New')
      this.#filter[field] = operatorOrValue;
    } else {
      // Three-arg form: addQuery('severity', '<=', 2)
      const op = operatorOrValue;
      switch (op) {
        case '=':  this.#filter[field] = value; break;
        case '!=': this.#filter[field] = { $ne: value }; break;
        case '>':  this.#filter[field] = { $gt: value }; break;
        case '<':  this.#filter[field] = { $lt: value }; break;
        case '>=': this.#filter[field] = { $gte: value }; break;
        case '<=': this.#filter[field] = { $lte: value }; break;
        case 'LIKE': this.#filter[field] = { $regex: value, $options: 'i' }; break;
        case 'IN': this.#filter[field] = { $in: Array.isArray(value) ? value : value.split(',') }; break;
        default: this.#filter[field] = value;
      }
    }
  }

  addOrCondition(field, operatorOrValue, value) {
    const condition = {};
    if (value === undefined) {
      condition[field] = operatorOrValue;
    } else {
      this.#applyOp(condition, field, operatorOrValue, value);
    }
    this.#orConditions.push(condition);
  }

  #applyOp(obj, field, op, value) {
    switch (op) {
      case '=':  obj[field] = value; break;
      case '!=': obj[field] = { $ne: value }; break;
      case '>':  obj[field] = { $gt: value }; break;
      case '<':  obj[field] = { $lt: value }; break;
      case '>=': obj[field] = { $gte: value }; break;
      case '<=': obj[field] = { $lte: value }; break;
      default:   obj[field] = value;
    }
  }

  addEncodedQuery(encoded) {
    const parsed = parseEncodedQuery(encoded);
    Object.assign(this.#filter, parsed);
  }

  orderBy(field) {
    this.#sort[field] = 1;
  }

  orderByDesc(field) {
    this.#sort[field] = -1;
  }

  setLimit(n) {
    this.#limit = n;
  }

  // ─── Execution (async) ────────────────────────────────────────────────────

  async query() {
    const mongoFilter = this.#buildMongoFilter();
    this.#results = await this.#model.find(mongoFilter)
      .sort(this.#sort)
      .limit(this.#limit)
      .lean();
    this.#cursor = -1;
  }

  async get(fieldOrSysId, value) {
    let doc;
    if (value === undefined) {
      // get(sys_id)
      doc = await this.#model.findOne({ sys_id: fieldOrSysId }).lean();
    } else {
      // get(field, value)
      doc = await this.#model.findOne({ [fieldOrSysId]: value }).lean();
    }
    if (doc) {
      this.#current = doc;
      this.#isNew = false;
      return true;
    }
    return false;
  }

  async getRowCount() {
    return this.#model.countDocuments(this.#buildMongoFilter());
  }

  #buildMongoFilter() {
    if (this.#orConditions.length > 0) {
      return { $and: [this.#filter, { $or: this.#orConditions }] };
    }
    return this.#filter;
  }

  // ─── Cursor (sync after query()) ─────────────────────────────────────────

  next() {
    this.#cursor++;
    if (this.#cursor < this.#results.length) {
      this.#current = { ...this.#results[this.#cursor] };
      this.#isNew = false;
      return true;
    }
    return false;
  }

  hasNext() {
    return this.#cursor + 1 < this.#results.length;
  }

  // ─── Field access ─────────────────────────────────────────────────────────

  getValue(field) {
    const val = this.#current[field];
    return val == null ? '' : String(val);
  }

  setValue(field, value) {
    this.#current[field] = value;
  }

  getDisplayValue(field) {
    return this.getValue(field);
  }

  // ─── CRUD (async) ─────────────────────────────────────────────────────────

  async insert() {
    const sysId = randomUUID();
    this.#current.sys_id = sysId;
    this.#isNew = true;

    // Run before-insert business rules
    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('before', 'insert', this.#tableName, this);
      if (this.#abortAction) throw new Error('Insert aborted by business rule');
    }

    const doc = new this.#model(this.#current);
    const saved = await doc.save();
    this.#current = saved.toObject();
    this.#isNew = false;

    // Run after-insert business rules
    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('after', 'insert', this.#tableName, this);
    }

    return sysId;
  }

  async update() {
    if (!this.#current.sys_id) return false;

    // Run before-update business rules
    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('before', 'update', this.#tableName, this);
      if (this.#abortAction) return false;
    }

    this.#current.sys_updated_on = new Date();
    await this.#model.updateOne({ sys_id: this.#current.sys_id }, { $set: this.#current });

    // Run after-update business rules
    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('after', 'update', this.#tableName, this);
    }

    return true;
  }

  async deleteRecord() {
    if (!this.#current.sys_id) return false;

    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('before', 'delete', this.#tableName, this);
      if (this.#abortAction) return false;
    }

    await this.#model.deleteOne({ sys_id: this.#current.sys_id });

    if (this.#businessRuleEngine) {
      await this.#businessRuleEngine.runSync('after', 'delete', this.#tableName, this);
    }

    return true;
  }

  async deleteMultiple() {
    await this.#model.deleteMany(this.#buildMongoFilter());
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  initialize() {
    this.#current = {};
    this.#isNew = true;
    this.#abortAction = false;
  }

  newRecord() {
    this.initialize();
  }

  // ─── Metadata ─────────────────────────────────────────────────────────────

  getTableName() { return this.#tableName; }
  isNewRecord()  { return this.#isNew; }
  isValid()      { return !!this.#current.sys_id; }
  getUniqueValue() { return this.#current.sys_id || ''; }
  getEncodedQuery() { return JSON.stringify(this.#filter); }

  // Returns a plain object of current record (used by sandbox serialization)
  toObject() { return { ...this.#current }; }

  // Called from business rules to abort an operation
  setAbortAction(val) { this.#abortAction = !!val; }

  // Called by BusinessRuleEngine to inject itself
  _setBusinessRuleEngine(engine) {
    this.#businessRuleEngine = engine;
  }
}
