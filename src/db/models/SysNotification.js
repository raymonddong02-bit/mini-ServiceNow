import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const sysNotificationSchema = new mongoose.Schema({
  message:          { type: String, required: true },
  type:             { type: String, enum: ['incident_created', 'incident_updated', 'info'], default: 'info' },
  related_incident: { type: String },   // sys_id of related incident
  related_event:    { type: String },   // sys_id of triggering sysevent
  team:             { type: String },   // "Team A" or "Team B"
});

sysNotificationSchema.plugin(basePlugin);

export default mongoose.model('SysNotification', sysNotificationSchema);
