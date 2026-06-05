// Minimal ambient typings for @fusebit/cloud-git (ships no types).
// We only use GitRepository as a base class; the protocol internals are opaque.
declare module '@fusebit/cloud-git' {
  import type { Request, Response, NextFunction, Router } from 'express';

  export interface GitRef {
    ref: string;
    sha: string;
  }

  export interface GitObject {
    objectType: 'commit' | 'tree' | 'blob' | 'tag';
    data: Buffer;
  }

  // As delivered by the pack parser on push: sha is a Buffer.
  export interface ReceivedObject {
    objectType: 'commit' | 'tree' | 'blob' | 'tag';
    data: Buffer;
    sha: Buffer;
  }

  export interface ReceiveCommand {
    srcId: string;
    destId: string;
    ref: string;
  }

  export class GitRepository {
    constructor();
    isZeroId(id: string): boolean;
    authorize(req: Request, res: Response, next: NextFunction): Promise<void> | void;
    getRefs(req: Request): Promise<GitRef[]>;
    getHeadRef(req: Request): Promise<string | undefined>;
    receivePack(req: Request, commands: ReceiveCommand[], objects: ReceivedObject[]): Promise<void>;
    getObject(req: Request, sha: string): Promise<GitObject>;
    getReceivePackSuccessMessage(req: Request, commands: ReceiveCommand[], objects: ReceivedObject[]): Promise<string>;
    getUploadPackSuccessMessage(req: Request, objects: GitObject[]): Promise<string>;
    createExpress(express: { Router: () => Router }): Router;
  }

  export class MemoryGitRepository extends GitRepository {}
}
