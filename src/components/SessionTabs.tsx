import React, { useState, useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { X, Plus, Edit2, Server } from 'lucide-react';
import { apiClient } from '../utils/apiClient';

const SessionTabs: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    createSession,
    switchSession,
    closeSession,
    isLoading
  } = useSessionStore();

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [backendAddress, setBackendAddress] = useState('localhost:3000');

  // Load backend address from localStorage on mount
  useEffect(() => {
    const savedAddress = localStorage.getItem('orchestrator-backend-address');
    if (savedAddress) {
      setBackendAddress(savedAddress);
      apiClient.setBaseUrl(savedAddress);
    } else {
      // Set default and save it
      localStorage.setItem('orchestrator-backend-address', 'localhost:3000');
      apiClient.setBaseUrl('localhost:3000');
    }
  }, []);

  const handleBackendAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAddress = e.target.value;
    setBackendAddress(newAddress);
  };

  const handleBackendAddressBlur = () => {
    // Save to localStorage and update apiClient
    localStorage.setItem('orchestrator-backend-address', backendAddress);
    apiClient.setBaseUrl(backendAddress);
  };

  const handleBackendAddressKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      localStorage.setItem('orchestrator-backend-address', backendAddress);
      apiClient.setBaseUrl(backendAddress);
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleCreateSession = async () => {
    await createSession();
  };

  const handleCloseSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    await closeSession(sessionId);
  };

  const handleEditSession = (sessionId: string, currentName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingSessionId(sessionId);
    setEditingName(currentName);
  };

  const handleSaveEdit = () => {
    if (editingSessionId && editingName.trim()) {
      // Update session name in store
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map(session =>
          session.id === editingSessionId
            ? { ...session, name: editingName.trim() }
            : session
        ),
      }));
      useSessionStore.getState().saveSessions();
    }
    setEditingSessionId(null);
    setEditingName('');
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingName('');
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSaveEdit();
    } else if (event.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div className="flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 px-2 py-1 overflow-x-auto">
      {/* Backend Address Input */}
      <div className="flex items-center mr-4 px-3 py-1 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600">
        <Server size={14} className="mr-2 text-gray-500 dark:text-gray-400" />
        <input
          type="text"
          value={backendAddress}
          onChange={handleBackendAddressChange}
          onBlur={handleBackendAddressBlur}
          onKeyPress={handleBackendAddressKeyPress}
          placeholder="localhost:3000"
          className="bg-transparent border-none outline-none text-sm w-40 text-gray-700 dark:text-gray-200"
          title="Backend server address"
        />
      </div>

      {sessions.map((session) => (
        <div
          key={session.id}
          className={`flex items-center min-w-0 max-w-xs px-3 py-2 mr-1 rounded-t-lg cursor-pointer transition-colors ${
            activeSessionId === session.id
              ? 'bg-white dark:bg-gray-700 border-t border-l border-r border-gray-300 dark:border-gray-600'
              : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'
          }`}
          onClick={() => switchSession(session.id)}
        >
          {editingSessionId === session.id ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={handleKeyPress}
              className="flex-1 bg-transparent border-none outline-none text-sm"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate text-sm font-medium">
              {session.name}
            </span>
          )}

          <div className="flex items-center ml-2">
            <button
              onClick={(e) => handleEditSession(session.id, session.name, e)}
              className="p-1 hover:bg-gray-400 dark:hover:bg-gray-400 rounded opacity-60 hover:opacity-100 transition-opacity"
              title="Rename session"
            >
              <Edit2 size={12} />
            </button>

            {sessions.length > 1 && (
              <button
                onClick={(e) => handleCloseSession(session.id, e)}
                className="p-1 hover:bg-red-400 dark:hover:bg-red-400 rounded opacity-60 hover:opacity-100 transition-opacity ml-1"
                title="Close session"
                disabled={isLoading}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        onClick={handleCreateSession}
        className="flex items-center px-3 py-2 ml-1 rounded-t-lg bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        title="Create new session"
        disabled={isLoading}
      >
        <Plus size={14} />
        <span className="ml-1 text-sm">New</span>
      </button>
    </div>
  );
};

export default SessionTabs;