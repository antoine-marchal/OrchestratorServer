import path from 'path';
import fs from 'fs';

const COLLECTION_NAMES = [
  'users', 'roles', 'secrets', 'flows', 'flow_versions', 'executions',
  'schedules', 'trigger_tokens', 'workers', 'worker_jobs', 'sessions',
] as const;

/* ─── Shared interface ───────────────────────────────────────────────────── */

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
}

export interface ICollection {
  find(query?: object, options?: FindOptions): Promise<any[]>;
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

  find(query: object = {}, options: FindOptions = {}): Promise<any[]> {
    let cursor = this.col.find(query);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray();
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

  find(query: object = {}, options: FindOptions = {}): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let cursor = this.ds.find(query);
      if (options.sort) cursor = cursor.sort(options.sort);
      if (options.skip) cursor = cursor.skip(options.skip);
      if (options.limit) cursor = cursor.limit(options.limit);
      cursor.exec((err: any, docs: any[]) => err ? reject(err) : resolve(docs));
    });
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
      ds.setAutocompactionInterval(10 * 60 * 1000);
      _db[name] = new NeDBCollection(ds);
    }
    console.log('[DB] Using NeDB at', DATA_DIR);
  }

  _connected = true;

  // Hot-path indexes. ensureIndex is idempotent on both Mongo and NeDB.
  try {
    await _db['users'].ensureIndex({ fieldName: 'apiKeys.keyHash' });
    await _db['users'].ensureIndex({ fieldName: 'login', unique: true });
    await _db['workers'].ensureIndex({ fieldName: 'name' });
    await _db['workers'].ensureIndex({ fieldName: 'lastSeenAt' });
    await _db['worker_jobs'].ensureIndex({ fieldName: 'workerId' });
    await _db['worker_jobs'].ensureIndex({ fieldName: 'status' });
    await _db['worker_jobs'].ensureIndex({ fieldName: 'executionId' });
    await _db['executions'].ensureIndex({ fieldName: 'flowId' });
    await _db['executions'].ensureIndex({ fieldName: 'status' });
    await _db['executions'].ensureIndex({ fieldName: 'startTime' });
    await _db['schedules'].ensureIndex({ fieldName: 'flowId' });
    await _db['secrets'].ensureIndex({ fieldName: 'name' });
    await _db['flow_versions'].ensureIndex({ fieldName: 'flowId' });
    await _db['flow_versions'].ensureIndex({ fieldName: 'savedAt' });
  } catch (err: any) {
    console.warn('[DB] ensureIndex failed:', err.message);
  }
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
