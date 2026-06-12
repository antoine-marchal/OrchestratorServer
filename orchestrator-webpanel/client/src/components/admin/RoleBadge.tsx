// Small role chip (admin/operator/viewer) used across admin views.
export const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--accent)',
  operator: 'var(--ok)',
  viewer: 'var(--text-3)',
};

export function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      background: 'var(--surface-hi)', border: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)', fontSize: 11,
      color: ROLE_COLORS[role] ?? 'var(--text-3)',
    }}>
      {role}
    </span>
  );
}
