// Repository layer — one typed repository per business entity, wrapping its
// collection. Import the singletons from here; never call getCollection for a
// business entity from the http/domain layers.
//
//   import { flowRepository, workerRepository } from '../../data/repositories';
//
// Infra-internal stores (git objects/refs, artifact blobs/chunks, execution
// logs) intentionally keep direct collection access — they are storage adapters,
// not domain entities.
import { BaseRepository } from './BaseRepository';
import type { Flow } from '../models/Flow';
import type { Execution } from '../models/Execution';
import type { Worker } from '../models/Worker';
import type { User } from '../models/User';
import type { Secret } from '../models/Secret';
import type { Schedule } from '../models/Schedule';
import type { TriggerToken } from '../models/TriggerToken';

// Reads stay permissive (`any`) — matching the pre-repository getCollection
// behavior — so existing dynamic field access keeps compiling. The entity type
// is carried as the generic argument for documentation and for future typed
// intent methods; tighten read typing per entity later without touching callers.
type Doc<T> = T extends never ? never : any;

class FlowRepository extends BaseRepository<Doc<Flow>> { constructor() { super('flows'); } }
class ExecutionRepository extends BaseRepository<Doc<Execution>> { constructor() { super('executions'); } }
class WorkerRepository extends BaseRepository<Doc<Worker>> { constructor() { super('workers'); } }
class WorkerJobRepository extends BaseRepository<Record<string, any>> { constructor() { super('worker_jobs'); } }
class UserRepository extends BaseRepository<Doc<User>> { constructor() { super('users'); } }
class SecretRepository extends BaseRepository<Doc<Secret>> { constructor() { super('secrets'); } }
class ScheduleRepository extends BaseRepository<Doc<Schedule>> { constructor() { super('schedules'); } }
class TriggerTokenRepository extends BaseRepository<Doc<TriggerToken>> { constructor() { super('trigger_tokens'); } }

export const flowRepository = new FlowRepository();
export const executionRepository = new ExecutionRepository();
export const workerRepository = new WorkerRepository();
export const workerJobRepository = new WorkerJobRepository();
export const userRepository = new UserRepository();
export const secretRepository = new SecretRepository();
export const scheduleRepository = new ScheduleRepository();
export const triggerTokenRepository = new TriggerTokenRepository();
