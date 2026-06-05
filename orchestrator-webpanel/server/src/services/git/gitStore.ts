import { getCollection } from '../db/index';
import type { GitObjectType } from './gitObjects';

// DB-backed git object/ref store, scoped per flow. Objects are content-addressed
// (sha) and immutable; refs are mutable pointers. Object bytes are kept as base64
// because NeDB cannot round-trip a Buffer cleanly (it JSON-serializes to
// {type:'Buffer',data:[...]}), and Mongo stores the base64 string verbatim.

export interface StoredObject {
  objectType: GitObjectType;
  data: Buffer;
}

const objects = () => getCollection('git_objects');
const refs = () => getCollection('git_refs');

export async function getObject(flowId: string, sha: string): Promise<StoredObject | null> {
  const doc = await objects().findOne({ _id: `${flowId}:${sha}` });
  if (!doc) return null;
  return { objectType: doc.objectType, data: Buffer.from(doc.data, 'base64') };
}

export async function hasObject(flowId: string, sha: string): Promise<boolean> {
  return !!(await objects().findOne({ _id: `${flowId}:${sha}` }));
}

export async function putObject(
  flowId: string,
  sha: string,
  objectType: GitObjectType,
  data: Buffer,
): Promise<void> {
  const _id = `${flowId}:${sha}`;
  if (await objects().findOne({ _id })) return; // immutable — skip duplicates
  await objects().insert({ _id, flowId, sha, objectType, data: data.toString('base64') });
}

export interface RefRow {
  ref: string;
  sha: string;
}

export async function listRefs(flowId: string): Promise<RefRow[]> {
  const rows: any[] = await refs().find({ flowId });
  return rows.map((r) => ({ ref: r.ref, sha: r.sha }));
}

export async function getRef(flowId: string, ref: string): Promise<string | null> {
  const row = await refs().findOne({ _id: `${flowId}:${ref}` });
  return row ? row.sha : null;
}

export async function setRef(flowId: string, ref: string, sha: string): Promise<void> {
  const _id = `${flowId}:${ref}`;
  const existing = await refs().findOne({ _id });
  if (existing) {
    await refs().update({ _id }, { $set: { sha } });
  } else {
    await refs().insert({ _id, flowId, ref, sha });
  }
}

export async function deleteRef(flowId: string, ref: string): Promise<void> {
  await refs().remove({ _id: `${flowId}:${ref}` });
}
