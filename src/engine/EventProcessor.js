import { EventQueue } from './EventQueue.js';
import { gs } from '../glide/GlideSystem.js';

const POLL_INTERVAL_MS = 3000;

/**
 * EventProcessor — polls sysevent for ready events and dispatches them
 * through the BusinessRuleEngine every POLL_INTERVAL_MS milliseconds.
 */
export class EventProcessor {
  #engine;
  #timer = null;
  #running = false;

  constructor(businessRuleEngine) {
    this.#engine = businessRuleEngine;
  }

  start() {
    if (this.#timer) return;
    gs.info('EventProcessor started', 'EventProcessor');
    this.#timer = setInterval(() => this.#tick(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
      gs.info('EventProcessor stopped', 'EventProcessor');
    }
  }

  async #tick() {
    if (this.#running) return; // prevent overlapping runs
    this.#running = true;
    try {
      const events = await EventQueue.dequeue(10);
      for (const event of events) {
        await this.#process(event);
      }
    } catch (err) {
      gs.error(`EventProcessor tick error: ${err.message}`, 'EventProcessor');
    } finally {
      this.#running = false;
    }
  }

  async #process(event) {
    try {
      gs.info(`Processing event: ${event.name} (${event.sys_id})`, 'EventProcessor');
      await this.#engine.runForEvent(event.toObject ? event.toObject() : event);
      await EventQueue.markProcessed(event.sys_id);
    } catch (err) {
      gs.error(`Failed to process event ${event.sys_id}: ${err.message}`, 'EventProcessor');
      await EventQueue.markError(event.sys_id, err.message);
    }
  }
}
