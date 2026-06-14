import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

class OrchestratorEventBus extends EventEmitter {
  private inboxWatcher: fs.FSWatcher | null = null;
  // Debounce per filename — fs.watch can fire 'rename' twice for one create,
  // and editors/copies may touch a file repeatedly. Collapse bursts so one
  // arrived file emits exactly one 'file.arrived'.
  private debounce = new Map<string, NodeJS.Timeout>();
  private static DEBOUNCE_MS = 250;

  watchInbox(dir: string): void {
    if (this.inboxWatcher) return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.inboxWatcher = fs.watch(dir, (eventType, filename) => {
      // `filename` can be null on some platforms — skip, we can't act on it.
      if (eventType !== 'rename' || !filename || filename.endsWith('.stop')) return;
      const name = filename.toString();
      const existing = this.debounce.get(name);
      if (existing) clearTimeout(existing);
      this.debounce.set(name, setTimeout(() => {
        this.debounce.delete(name);
        const filePath = path.join(dir, name);
        // Only emit on creation (rename also fires on delete) — existence check
        // after the debounce window confirms the file is actually there.
        if (fs.existsSync(filePath)) {
          this.emit('file.arrived', { path: filePath, filename: name });
        }
      }, OrchestratorEventBus.DEBOUNCE_MS));
    });
    console.log(`[EventBus] Watching inbox: ${dir}`);
  }

  stopWatcher(): void {
    if (this.inboxWatcher) {
      this.inboxWatcher.close();
      this.inboxWatcher = null;
    }
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
  }
}

export const eventBus = new OrchestratorEventBus();
