import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const sysScriptSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  collection:    { type: String, required: true },  // e.g. "sysevent", "incident"
  event_name:    { type: String },                   // for event-triggered rules
  when_to_run:   { type: String, enum: ['before', 'after', 'async'], default: 'after' },
  action_insert: { type: Boolean, default: false },
  action_update: { type: Boolean, default: false },
  action_delete: { type: Boolean, default: false },
  order_num:     { type: Number, default: 100 },
  active:        { type: Boolean, default: true },
  script:        { type: String, required: true },
  condition:     { type: String },
});

sysScriptSchema.index({ collection: 1, when_to_run: 1, active: 1 });
sysScriptSchema.plugin(basePlugin);

export default mongoose.model('SysScript', sysScriptSchema);
