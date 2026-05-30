import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

class OrchestratorEventBus extends EventEmitter {
  private inboxWatcher: fs.FSWatcher | null = null;

  watchInbox(dir: string): void {
    if (this.inboxWatcher) return;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.inboxWatcher = fs.watch(dir, (eventType, filename) => {
      if (eventType === 'rename' && filename && !filename.endsWith('.stop')) {
        const filePath = path.join(dir, filename);
        if (fs.existsSync(filePath)) {
          this.emit('file.arrived', { path: filePath, filename });
        }
      }
    });
    console.log(`[EventBus] Watching inbox: ${dir}`);
  }

  stopWatcher(): void {
    if (this.inboxWatcher) {
      this.inboxWatcher.close();
      this.inboxWatcher = null;
    }
  }
}

export const eventBus = new OrchestratorEventBus();
