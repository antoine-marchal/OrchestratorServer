export interface TriggerToken {
  _id: string;
  scheduleId: string;
  label: string;
  tokenHash: string;
  createdBy: string;
  expiresAt?: string;
  singleUse: boolean;
  used: boolean;
  revokedAt?: string;
  createdAt: string;
}
