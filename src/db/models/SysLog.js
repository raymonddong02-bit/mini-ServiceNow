import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const sysLogSchema = new mongoose.Schema({
  level:      { type: String, enum: ['info', 'warn', 'error', 'debug'], default: 'info' },
  message:    { type: String, required: true },
  source:     { type: String },
  sys_id_ref: { type: String },  // optional related record sys_id
});

sysLogSchema.index({ level: 1, sys_created_on: -1 });
sysLogSchema.plugin(basePlugin);

export default mongoose.model('SysLog', sysLogSchema);
