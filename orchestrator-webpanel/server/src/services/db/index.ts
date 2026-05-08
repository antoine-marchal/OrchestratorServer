import path from 'path';
import fs from 'fs';

const COLLECTION_NAMES = [
  'users', 'roles', 'secrets', 'flows', 'executions',
  'schedules', 'trigger_tokens', 'workers', 'worker_jobs', 'sessions',
] as const;

/* ─── Shared interface ───────────────────────────────────────────────────── */

export interface ICollection {
  find(query?: object): Promise<any[]>;
  findOne(query: object): Promise<any | null>;
  insert(doc: object): Promise<any>;
  update(query: object, update: object, options?: { multi?: boolean; [k: string]: any }): Promise<number>;
  remove(query: object, options?: { multi?: boolean; [k: string]: any }): Promise<number>;
  count(query?: object): Promise<number>;
  ensureIndex(options: object): Promise<void>;
}

/* ─── MongoDB wrapper ────────────────────────────────────────────────────── */

class MongoCollection implements ICollection {
  constructor(private col: any) {}

  find(query: object = {}): Promise<any[]> {
    return this.col.find(query).toArray();
  }

  findOne(query: object): Promise<any | null> {
    return this.col.findOne(query);
  }

  async insert(doc: any): Promise<any> {
    await this.col.insertOne(doc);
    return doc;
  }

  async update(query: object, update: object, options: { multi?: boolean } = {}): Promise<number> {
    const result = options.multi
      ? await this.col.updateMany(query, update)
      : await this.col.updateOne(query, update);
    return result.modifiedCount ?? result.matchedCount ?? 0;
  }

  async remove(query: object, options: { multi?: boolean } = {}): Promise<number> {
    const result = options.multi
      ? await this.col.deleteMany(query)
      : await this.col.deleteOne(query);
    return result.deletedCount ?? 0;
  }

  count(query: object = {}): Promise<number> {
    return this.col.countDocuments(query);
  }

  async ensureIndex(options: any): Promise<void> {
    try {
      const field = options.fieldName;
      const key = Array.isArray(field)
        ? Object.fromEntries(field.map((f: string) => [f, 1]))
        : { [field]: 1 };
      await this.col.createIndex(key, { unique: !!options.unique, sparse: !!options.sparse });
    } catch { /* already exists */ }
  }
}

/* ─── NeDB wrapper ───────────────────────────────────────────────────────── */

function promisify<T>(fn: Function, ...args: any[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn(...args, (err: any, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

class NeDBCollection implements ICollection {
  constructor(private ds: any) {}

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
      this.ds.update(query, update, options, (err: any, n: number) => {
        if (err) reject(err); else resolve(n);
      });
    });
  }

  remove(query: object, options: object = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ds.remove(query, options, (err: any, n: number) => {
        if (err) reject(err); else resolve(n);
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

/* ─── Registry ───────────────────────────────────────────────────────────── */

let _db: Record<string, ICollection> = {};
let _connected = false;

export async function connectDB(): Promise<void> {
  if (_connected) return;

  const mongoUri = process.env.MONGO_URI;

  if (mongoUri) {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(mongoUri);
    await client.connect();
    // db() with no args uses the database name embedded in the URI
    const nativeDb = client.db();
    for (const name of COLLECTION_NAMES) {
      _db[name] = new MongoCollection(nativeDb.collection(name));
    }
    console.log('[DB] Connected to MongoDB:', mongoUri.replace(/\/\/[^@]+@/, '//***@'));
  } else {
    const DATA_DIR = path.join(process.env.ORCHESTRATOR_WORK_DIR || process.cwd(), 'data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const Datastore = (await import('@seald-io/nedb')).default;
    for (const name of COLLECTION_NAMES) {
      const ds = new Datastore({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true });
      _db[name] = new NeDBCollection(ds);
    }
    console.log('[DB] Using NeDB at', DATA_DIR);
  }

  _connected = true;
}

export function getCollection(name: string): ICollection {
  const col = _db[name];
  if (!col) throw new Error(`Collection "${name}" not found — call connectDB() first`);
  return col;
}

export function isMongoMode(): boolean {
  return !!process.env.MONGO_URI;
}

export { _db as db };
