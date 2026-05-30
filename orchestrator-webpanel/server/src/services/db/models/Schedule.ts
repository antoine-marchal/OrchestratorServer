export interface Schedule {
  _id: string;
  flowId: string;
  type: 'cron' | 'event' | 'api';
  cronExpr?: string;
  timezone?: string;
  eventName?: string;
  label?: string;
  createdBy: string;
  enabled: boolean;
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
}
