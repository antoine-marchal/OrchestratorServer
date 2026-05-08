import React, { useState } from 'react';
import { Users, Lock } from 'lucide-react';
import UsersPanel from './UsersPanel';
import SecretsPanel from './SecretsPanel';

type AdminTab = 'users' | 'secrets';

const tabs: { id: AdminTab; label: string; icon: React.ElementType }[] = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'secrets', label: 'Secrets', icon: Lock },
];

export const AdminLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex-shrink-0 px-4 pt-4 pb-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div className="flex items-center gap-1 mb-0">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`tc-flow-tab${activeTab === t.id ? ' active' : ''}`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'users' && <UsersPanel />}
        {activeTab === 'secrets' && <SecretsPanel />}
      </div>
    </div>
  );
};

export default AdminLayout;
