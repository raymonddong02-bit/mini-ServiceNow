import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

class GlideSystem {
  #sseManager = null;

  // Called after SseManager is initialized to break circular dependency
  _setSseManager(manager) {
    this.#sseManager = manager;
  }

  // ─── Logging ──────────────────────────────────────────────────────────────

  log(message, source = 'GlideSystem') {
    this.#writeLog('info', message, source);
  }

  info(message, source = 'GlideSystem') {
    this.#writeLog('info', message, source);
  }

  warn(message, source = 'GlideSystem') {
    this.#writeLog('warn', message, source);
  }

  error(message, source = 'GlideSystem') {
    this.#writeLog('error', message, source);
  }

  debug(message, source = 'GlideSystem') {
    this.#writeLog('debug', message, source);
  }

  #writeLog(level, message, source) {
    const consoleFn = level === 'warn' ? console.warn
      : level === 'error' ? console.error
      : level === 'debug' ? console.debug
      : console.log;
    consoleFn(`[${level.toUpperCase()}] [${source}] ${message}`);

    try {
      const SysLog = mongoose.model('SysLog');
      SysLog.create({ level, message, source }).catch(() => {});
    } catch {
      // Model not yet registered during early startup — ignore
    }
  }

  // ─── Event Queue ──────────────────────────────────────────────────────────

  async eventQueue(name, gr = null, parm1 = '', parm2 = '') {
    const SysEvent = mongoose.model('SysEvent');
    const doc = await SysEvent.create({
      name,
      instance:   gr ? gr.getUniqueValue() : '',
      parm1:      parm1 || '',
      parm2:      parm2 || '',
      table_name: gr ? gr.getTableName() : '',
      state:      'ready',
      process_on: new Date(),
    });

    if (this.#sseManager) {
      this.#sseManager.broadcast('event_created', {
        sys_id:         doc.sys_id,
        name:           doc.name,
        parm1:          doc.parm1,
        parm2:          doc.parm2,
        state:          doc.state,
        sys_created_on: doc.sys_created_on,
      });
    }

    return doc;
  }

  // ─── Properties ───────────────────────────────────────────────────────────

  async getProperty(name, defaultValue = null) {
    try {
      const SysProperties = mongoose.model('SysProperties');
      const doc = await SysProperties.findOne({ name }).lean();
      return doc ? doc.value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  async setProperty(name, value) {
    const SysProperties = mongoose.model('SysProperties');
    await SysProperties.findOneAndUpdate({ name }, { name, value }, { upsert: true });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  now() {
    return new Date().toISOString();
  }

  generateGuid() {
    return randomUUID();
  }

  nil(value) {
    return value === null || value === undefined || value === '';
  }

  // ─── SSE Broadcast ────────────────────────────────────────────────────────

  async broadcast(type, data) {
    // Persist toast and notification_log events as SysNotification docs
    if (type === 'toast' || type === 'notification_log') {
      try {
        const SysNotification = mongoose.model('SysNotification');
        const notifData = type === 'toast'
          ? { message: data.message || '', type: 'info' }
          : {
              message:          data.message || '',
              type:             data.type || 'info',
              related_incident: data.related_incident || '',
              related_event:    data.related_event || '',
              team:             data.team || '',
            };
        const notif = await SysNotification.create(notifData);

        if (this.#sseManager) {
          this.#sseManager.broadcast('notification_created', notif.toObject());
        }
      } catch (err) {
        console.error('[GlideSystem] Failed to write SysNotification:', err.message);
      }
    }

    if (this.#sseManager) {
      this.#sseManager.broadcast(type, data);
    }
  }
}

export const gs = new GlideSystem();
