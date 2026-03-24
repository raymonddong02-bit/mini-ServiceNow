import mongoose from 'mongoose';
import { runInSandbox } from './Sandbox.js';
import { gs } from '../glide/GlideSystem.js';

/**
 * BusinessRuleEngine
 *
 * Loads active sys_script records and executes them at the right lifecycle points.
 *
 * GlideRecord calls _setBusinessRuleEngine(engine) so that insert/update/delete
 * automatically trigger before/after rules.
 *
 * EventProcessor calls runForEvent() to trigger async event-based rules.
 */
export class BusinessRuleEngine {
  #mongoUri;
  #sseManager;

  constructor(mongoUri, sseManager) {
    this.#mongoUri    = mongoUri;
    this.#sseManager  = sseManager;
  }

  // ─── Called by GlideRecord (before/after insert|update|delete) ─────────────

  async runSync(when, action, tableName, grInstance) {
    const rules = await this.#loadRules({
      collection:  tableName,
      when_to_run: when,
      active:      true,
      [`action_${action}`]: true,
    });

    for (const rule of rules) {
      await this.#execute(rule, grInstance.toObject(), null, tableName);
    }
  }

  // ─── Called by EventProcessor for event-triggered rules ────────────────────

  async runForEvent(eventDoc) {
    const rules = await this.#loadRules({
      collection: 'sysevent',
      event_name: eventDoc.name,
      active:     true,
    });

    if (rules.length === 0) {
      gs.warn(`No active rules found for event: ${eventDoc.name}`, 'BusinessRuleEngine');
    }

    for (const rule of rules) {
      await this.#execute(rule, eventDoc, null, 'sysevent');
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  async #loadRules(filter) {
    const SysScript = mongoose.model('SysScript');
    return SysScript.find(filter).sort({ order_num: 1 }).lean();
  }

  async #execute(rule, currentData, previousData, tableName) {
    gs.info(`Running rule: "${rule.name}"`, 'BusinessRuleEngine');

    // JSON round-trip strips Mongoose ObjectId / Date objects so structured clone
    // (used by Worker threads) can serialize the workerData without throwing.
    const safeCurrentData  = JSON.parse(JSON.stringify(currentData));
    const safePreviousData = previousData ? JSON.parse(JSON.stringify(previousData)) : null;

    const result = await runInSandbox({
      script:       rule.script,
      currentData:  safeCurrentData,
      previousData: safePreviousData,
      tableName,
      mongoUri:     this.#mongoUri,
    });

    // Flush collected logs to main-thread gs
    for (const entry of result.logs) {
      gs[entry.level]?.(entry.message, entry.source);
    }

    if (!result.success) {
      gs.error(`Rule "${rule.name}" failed: ${result.error}`, 'BusinessRuleEngine');
    }

    // Apply side effects collected by sandbox
    for (const item of result.broadcasts) {
      await this.#applySideEffect(item);
    }
  }

  async #applySideEffect(item) {
    const { type, data } = item;

    if (type === '__eventQueue') {
      // Script called gs.eventQueue() — create a new sysevent
      try {
        const SysEvent = mongoose.model('SysEvent');
        const doc = await SysEvent.create({
          name:       data.name,
          instance:   data.instance || '',
          parm1:      data.parm1 || '',
          parm2:      data.parm2 || '',
          table_name: data.table_name || '',
          state:      'ready',
          process_on: new Date(),
        });
        if (this.#sseManager) {
          this.#sseManager.broadcast('event_created', {
            sys_id:         doc.sys_id,
            name:           doc.name,
            parm1:          doc.parm1,
            state:          doc.state,
            sys_created_on: doc.sys_created_on,
          });
        }
      } catch (err) {
        gs.error(`Failed to enqueue event: ${err.message}`, 'BusinessRuleEngine');
      }
      return;
    }

    if (type === '__db_insert') {
      // Script inserted a record — broadcast appropriate SSE event
      if (data.tableName === 'incident' && this.#sseManager) {
        this.#sseManager.broadcast('incident_created', data.record);
      }
      return;
    }

    if (type === '__db_update') {
      if (data.tableName === 'incident' && this.#sseManager) {
        this.#sseManager.broadcast('incident_updated', data.record);
      }
      return;
    }

    // Regular gs.broadcast() call — delegate to main-thread gs (persists + SSE)
    await gs.broadcast(type, data);
  }
}
