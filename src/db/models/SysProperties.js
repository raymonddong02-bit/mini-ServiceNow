import mongoose from 'mongoose';
import { basePlugin } from './basePlugin.js';

const sysPropertiesSchema = new mongoose.Schema({
  name:        { type: String, unique: true, required: true },
  value:       { type: String },
  type:        { type: String, enum: ['string', 'integer', 'boolean', 'password'], default: 'string' },
  description: { type: String },
});

sysPropertiesSchema.plugin(basePlugin);

export default mongoose.model('SysProperties', sysPropertiesSchema);
