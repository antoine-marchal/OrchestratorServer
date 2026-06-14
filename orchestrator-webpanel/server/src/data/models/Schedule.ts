export interface Schedule {
  _id: string;
  flowId: string;
  type: 'cron' | 'event' | 'api';
  cronExpr?: string;
  timezone?: string;
  eventName?: string;
  label?: string;
  // Set when this schedule belongs to a flow "subrow" variant — fires the flow
  // with this worker/branch override instead of the flow defaults.
  variantId?: string;
  workerId?: string;
  branch?: string;
  createdBy: string;
  enabled: boolean;
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
}
