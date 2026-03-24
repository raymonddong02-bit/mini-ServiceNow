class SseManager {
  #clients = new Set();

  addClient(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Keep connection alive with periodic heartbeat comments
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
    }, 25000);

    this.#clients.add(res);

    res.on('close', () => {
      clearInterval(heartbeat);
      this.#clients.delete(res);
    });
  }

  removeClient(res) {
    this.#clients.delete(res);
  }

  broadcast(type, data) {
    const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
    for (const res of this.#clients) {
      try {
        res.write(payload);
      } catch {
        this.#clients.delete(res);
      }
    }
  }

  get clientCount() {
    return this.#clients.size;
  }
}

export const sseManager = new SseManager();
