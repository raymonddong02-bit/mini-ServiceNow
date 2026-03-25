import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, 'sandbox-runner.js');
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SCRIPT_TIMEOUT_MS, 10) || 30000;

/**
 * Runs a business rule script in an isolated worker thread.
 *
 * @param {object} options
 * @param {string}  options.script       - The script source to execute
 * @param {object}  options.currentData  - Serialized current GlideRecord fields
 * @param {object}  [options.previousData] - Serialized previous GlideRecord fields (for updates)
 * @param {string}  options.tableName    - Table name for current record
 * @param {string}  options.mongoUri     - MongoDB connection URI
 * @param {number}  [options.timeoutMs]  - Max execution time in ms (default 5000)
 * @returns {Promise<{success: boolean, broadcasts: Array, logs: Array, error?: string}>}
 */
export function runInSandbox({ script, currentData, previousData = null, tableName, mongoUri, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const worker = new Worker(RUNNER_PATH, {
      workerData: { script, currentData, previousData, tableName, mongoUri },
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve({
        success:    false,
        broadcasts: [],
        logs:       [],
        error:      `Script timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    worker.on('message', (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });

    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, broadcasts: [], logs: [], error: err.message });
    });

    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success:    false,
        broadcasts: [],
        logs:       [],
        error:      `Worker exited with code ${code}`,
      });
    });
  });
}
