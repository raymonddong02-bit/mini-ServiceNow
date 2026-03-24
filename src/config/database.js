import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/mini_servicenow';
  await mongoose.connect(uri);
  console.log(`[DB] Connected to MongoDB: ${uri}`);
}
