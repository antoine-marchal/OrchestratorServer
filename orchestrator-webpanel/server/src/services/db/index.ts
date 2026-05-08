import path from 'path';
import fs from 'fs';

// NeDB datastore type (lazy-loaded to avoid errors if not installed)
type NeDBDatastore = any;

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Unified in-memory collection registry
const stores = new Map<string, NeDBDatastore>();

function promisify<T>(fn: Function, ...args: any[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn(...args, (err: any, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

class NeDBCollection {
  private ds: NeDBDatastore;
  constructor(ds: NeDBDatastore) {
    this.ds = ds;
  }

  find(query: object = {}): Promise<any[]> {
    return promisify(this.ds.find.bind(this.ds), query);
  }

  findOne(query: object): Promise<any | null> {
    return promisify(this.ds.findOne.bind(this.ds), query);
  }

  insert(doc: object): Promise<any> {
    return promisify(this.ds.insert.bind(this.ds), doc);
  }

  update(query: object, update: object, options: object = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ds.update(query, update, options, (err: any, numReplaced: number) => {
        if (err) reject(err);
        else resolve(numReplaced);
      });
    });
  }

  remove(query: object, options: object = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ds.remove(query, options, (err: any, numRemoved: number) => {
        if (err) reject(err);
        else resolve(numRemoved);
      });
    });
  }

  count(query: object = {}): Promise<number> {
    return promisify(this.ds.count.bind(this.ds), query);
  }

  ensureIndex(options: object): Promise<void> {
    return promisify(this.ds.ensureIndex.bind(this.ds), options);
  }
}

let _db: { [key: string]: NeDBCollection } = {};
let _connected = false;

export async function connectDB(): Promise<void> {
  if (_connected) return;

  const mongoUri = process.env.MONGO_URI;

  if (mongoUri) {
    // Use real MongoDB via mongoose
    const mongoose = await import('mongoose');
    await mongoose.connect(mongoUri);
    console.log('[DB] Connected to MongoDB');
    // mongoose models are used directly; _db stays unused for mongo path
  } else {
    // Use NeDB embedded
    const Datastore = (await import('@seald-io/nedb')).default;
    const collections = ['users', 'roles', 'secrets', 'flows', 'executions', 'schedules', 'trigger_tokens', 'workers', 'worker_jobs', 'sessions'];
    for (const name of collections) {
      const ds = new Datastore({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true });
      stores.set(name, ds);
      _db[name] = new NeDBCollection(ds);
    }
    console.log('[DB] Using NeDB embedded storage at', DATA_DIR);
  }

  _connected = true;
}

export function getCollection(name: string): NeDBCollection {
  const col = _db[name];
  if (!col) throw new Error(`Collection "${name}" not found. Did you call connectDB()?`);
  return col;
}

export function isMongoMode(): boolean {
  return !!process.env.MONGO_URI;
}

export { _db as db };
