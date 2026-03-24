import { randomUUID } from 'crypto';

// Adds ServiceNow-style sys_* fields to every schema
export function basePlugin(schema) {
  schema.add({
    sys_id:         { type: String, default: () => randomUUID(), unique: true, index: true },
    sys_created_on: { type: Date, default: Date.now },
    sys_updated_on: { type: Date, default: Date.now },
    sys_created_by: { type: String, default: 'system' },
    sys_updated_by: { type: String, default: 'system' },
  });

  schema.pre('save', function (next) {
    this.sys_updated_on = new Date();
    next();
  });
}
