import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const sysEventSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  instance:      { type: String },        // sys_id of related record
  parm1:         { type: String },
  parm2:         { type: String },
  table_name:    { type: String },
  state:         { type: String, enum: ['ready', 'processing', 'processed', 'error'], default: 'ready' },
  process_on:    { type: Date, default: Date.now },
  processed_on:  { type: Date },
  error_message: { type: String },
});

sysEventSchema.index({ state: 1, process_on: 1 });
sysEventSchema.plugin(basePlugin);

export default mongoose.model('SysEvent', sysEventSchema);
