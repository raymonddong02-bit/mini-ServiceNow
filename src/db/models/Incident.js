import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const incidentSchema = new mongoose.Schema({
  number:            { type: String, unique: true },
  short_description: { type: String, required: true },
  description:       { type: String },
  state:             { type: String, enum: ['New', 'Investigating', 'Resolved'], default: 'New' },
  assigned_team:     { type: String, enum: ['Team A', 'Team B'] },
  source_event:      { type: String },   // sys_id of triggering sysevent
  source_service:    { type: String },   // "Service A" or "Service B"
  resolved_at:       { type: Date },
});

incidentSchema.plugin(basePlugin);

// Auto-generate incident number (INC0001001, INC0001002, ...)
incidentSchema.pre('save', async function (next) {
  if (this.isNew && !this.number) {
    const count = await mongoose.model('Incident').countDocuments();
    this.number = 'INC' + String(1001 + count).padStart(7, '0');
  }
  next();
});

export default mongoose.model('Incident', incidentSchema);
