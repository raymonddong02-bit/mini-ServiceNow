import mongoose from 'mongoose';

/**
 * EventQueue — thin wrapper around the sysevent MongoDB collection.
 */
export class EventQueue {
  /**
   * Enqueue a new event. Returns the created SysEvent document.
   */
  static async enqueue({ name, instance = '', parm1 = '', parm2 = '', table_name = '' }) {
    const SysEvent = mongoose.model('SysEvent');
    return SysEvent.create({
      name,
      instance,
      parm1,
      parm2,
      table_name,
      state:      'ready',
      process_on: new Date(),
    });
  }

  /**
   * Claim and return the next batch of ready events (up to `limit`).
   * Marks them as 'processing' atomically.
   */
  static async dequeue(limit = 10) {
    const SysEvent = mongoose.model('SysEvent');
    const now      = new Date();

    // Use findOneAndUpdate per event to minimise race conditions
    const claimed = [];
    for (let i = 0; i < limit; i++) {
      const doc = await SysEvent.findOneAndUpdate(
        { state: 'ready', process_on: { $lte: now } },
        { $set: { state: 'processing' } },
        { sort: { process_on: 1 }, new: true },
      );
      if (!doc) break;
      claimed.push(doc);
    }
    return claimed;
  }

  /**
   * Mark an event as processed.
   */
  static async markProcessed(sysId) {
    const SysEvent = mongoose.model('SysEvent');
    await SysEvent.updateOne(
      { sys_id: sysId },
      { $set: { state: 'processed', processed_on: new Date() } },
    );
  }

  /**
   * Mark an event as errored.
   */
  static async markError(sysId, message) {
    const SysEvent = mongoose.model('SysEvent');
    await SysEvent.updateOne(
      { sys_id: sysId },
      { $set: { state: 'error', error_message: message, processed_on: new Date() } },
    );
  }
}
