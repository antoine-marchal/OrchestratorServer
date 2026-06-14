import path from 'path';
import fs from 'fs';

const COLLECTION_NAMES = [
  'users', 'roles', 'secrets', 'flows', 'executions', 'execution_logs',
  'schedules', 'trigger_tokens', 'workers', 'worker_jobs', 'artifact_blobs', 'artifact_chunks', 'sessions',
  'git_objects', 'git_object_chunks', 'git_refs',
] as const;

/* ─── Shared interface ───────────────────────────────────────────────────── */

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  // Field inclusion/exclusion map. Same shape on Mongo and NeDB. Exclusion-only
  // ({ field: 0 }) is the portable form — NeDB forbids mixing include/exclude
  // (except _id). Used to keep heavy fields (logs, nodes, edges) out of list
  // queries.
  projection?: Record<string, 0 | 1>;
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
    if (options.projection) cursor = cursor.project(options.projection);
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

/*
 * NeDB forbids field names that contain '.' or start with '$' — even in nested
 * *data* values (see @seald-io/nedb lib/model.js checkKey). Node outputs are
 * arbitrary, so a payload like {"M26.1": 1} crashes the datastore on write.
 * We transparently escape offending keys before persisting and restore them on
 * read using fullwidth substitutes (U+FF0E '．', U+FF04 '＄'). Mongo is left
 * untouched: it accepts these keys natively.
 */
const NEDB_DOT = '．';
const NEDB_DOLLAR = '＄';

function escapeKey(k: string): string {
  let r = k.replace(/\./g, NEDB_DOT);
  if (r.startsWith('$')) r = NEDB_DOLLAR + r.slice(1);
  return r;
}

function unescapeKey(k: string): string {
  let r = k;
  if (r.startsWith(NEDB_DOLLAR)) r = '$' + r.slice(1);
  return r.replace(new RegExp(NEDB_DOT, 'g'), '.');
}

function mapKeysDeep(value: any, fn: (k: string) => string): any {
  if (Array.isArray(value)) return value.map((v) => mapKeysDeep(v, fn));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[fn(k)] = mapKeysDeep(v, fn);
    return out;
  }
  return value;
}

const escapeDoc = (doc: any) => mapKeysDeep(doc, escapeKey);
const unescapeDoc = (doc: any) => mapKeysDeep(doc, unescapeKey);

/*
 * Updates carry modifier operators ($set, $unset, …) at the top level whose
 * immediate keys are field *paths* — those must stay intact. Only the values
 * being written are arbitrary data, so we escape just those.
 */
function escapeUpdate(update: any): any {
  if (!update || typeof update !== 'object') return update;
  const ops = Object.keys(update).filter((k) => k.startsWith('$'));
  if (ops.length === 0) return escapeDoc(update); // full-document replacement
  const out: any = {};
  for (const [op, val] of Object.entries(update)) {
    if (op === '$unset' || !val || typeof val !== 'object' || Array.isArray(val)) {
      out[op] = val; // $unset values are flags; field paths preserved
      continue;
    }
    const inner: any = {};
    for (const [field, fv] of Object.entries(val)) inner[field] = escapeDoc(fv);
    out[op] = inner;
  }
  return out;
}

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
      let cursor = options.projection ? this.ds.find(query, options.projection) : this.ds.find(query);
      if (options.sort) cursor = cursor.sort(options.sort);
      if (options.skip) cursor = cursor.skip(options.skip);
      if (options.limit) cursor = cursor.limit(options.limit);
      cursor.exec((err: any, docs: any[]) => err ? reject(err) : resolve(docs.map(unescapeDoc)));
    });
  }

  async findOne(query: object): Promise<any | null> {
    const doc = await promisify<any>(this.ds.findOne.bind(this.ds), query);
    return doc ? unescapeDoc(doc) : null;
  }

  async insert(doc: object): Promise<any> {
    const saved = await promisify<any>(this.ds.insert.bind(this.ds), escapeDoc(doc));
    return unescapeDoc(saved);
  }

  update(query: object, update: object, options: object = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      this.ds.update(query, escapeUpdate(update), options, (err: any, n: number) => {
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
    await _db['worker_jobs'].ensureIndex({ fieldName: 'completedAt' });
    await _db['executions'].ensureIndex({ fieldName: 'flowId' });
    await _db['executions'].ensureIndex({ fieldName: 'status' });
    await _db['executions'].ensureIndex({ fieldName: 'startTime' });
    await _db['schedules'].ensureIndex({ fieldName: 'flowId' });
    await _db['secrets'].ensureIndex({ fieldName: 'name' });
    await _db['artifact_chunks'].ensureIndex({ fieldName: 'sha' });
    await _db['git_object_chunks'].ensureIndex({ fieldName: 'key' });
    await _db['git_objects'].ensureIndex({ fieldName: 'flowId' });
    await _db['git_objects'].ensureIndex({ fieldName: 'sha' });
    await _db['git_refs'].ensureIndex({ fieldName: 'flowId' });
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
