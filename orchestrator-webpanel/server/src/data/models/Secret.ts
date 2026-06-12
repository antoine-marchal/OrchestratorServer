export interface Secret {
  _id: string;
  name: string;
  value_enc: string;
  iv: string;
  ownerId: string;
  scope: 'global' | 'flow';
  flowId?: string;
  createdAt: string;
  updatedAt: string;
}
