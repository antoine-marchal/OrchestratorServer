import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { X, Plus, Edit2, Server, GripVertical, KeyRound } from 'lucide-react';
import { apiClient } from '../utils/apiClient';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';

type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

interface SortableTabProps {
  session: {
    id: string;
    name: string;
  };
  isActive: boolean;
  isEditing: boolean;
  editingName: string;
  onSwitch: () => void;
  onClose: (e: React.MouseEvent) => void;
  onEdit: (e: React.MouseEvent) => void;
  onNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  canClose: boolean;
  isLoading: boolean;
}

const SortableTab: React.FC<SortableTabProps> = ({
  session,
  isActive,
  isEditing,
  editingName,
  onSwitch,
  onClose,
  onEdit,
  onNameChange,
  onSaveEdit,
  onCancelEdit,
  canClose,
  isLoading,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      onSaveEdit();
    } else if (event.key === 'Escape') {
      onCancelEdit();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center min-w-0 max-w-xs px-3 py-2 mr-1 rounded-t-lg cursor-pointer transition-colors dark:text-gray-200 ${
        isActive
          ? 'bg-white dark:bg-gray-700 border-t border-l border-r border-gray-300 dark:border-gray-600'
          : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'
      }`}
      onClick={onSwitch}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="mr-2 cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} className="text-gray-400" />
      </div>

      {isEditing ? (
        <input
          type="text"
          value={editingName}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onSaveEdit}
          onKeyDown={handleKeyPress}
          className="flex-1 bg-transparent border-none outline-none text-sm min-w-0"
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
          onClick={onEdit}
          className="p-1 hover:bg-gray-400 dark:hover:bg-gray-400 rounded opacity-60 hover:opacity-100 transition-opacity"
          title="Rename session"
        >
          <Edit2 size={12} />
        </button>

        {canClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-red-400 dark:hover:bg-red-400 rounded opacity-60 hover:opacity-100 transition-opacity ml-1"
            title="Close session"
            disabled={isLoading}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

const SessionTabs: React.FC<{ flowId?: string; compact?: boolean }> = ({ flowId, compact = false }) => {
  const {
    sessions: allSessions,
    activeSessionId,
    createSession,
    switchSession,
    closeSession,
    reorderSessions,
    isLoading
  } = useSessionStore();

  const sessions = flowId
    ? allSessions.filter(s => (s as any).linkedFlowId === flowId)
    : allSessions;

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [backendAddress, setBackendAddress] = useState('localhost:3000');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('checking');
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pingBackend = useCallback(async () => {
    setConnStatus('checking');
    try {
      await apiClient.ping();
      setConnStatus('connected');
    } catch {
      setConnStatus('disconnected');
    }
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load backend address and API key from localStorage on mount and ping
  useEffect(() => {
    if (compact) {
      pingBackend();
      return;
    }

    const savedAddress = localStorage.getItem('orchestrator-backend-address');
    if (savedAddress) {
      setBackendAddress(savedAddress);
      apiClient.setBaseUrl(savedAddress);
    } else {
      localStorage.setItem('orchestrator-backend-address', 'localhost:3000');
      apiClient.setBaseUrl('localhost:3000');
    }
    const savedKey = localStorage.getItem('orchestrator-api-key');
    if (savedKey) {
      setApiKey(savedKey);
      apiClient.setApiKey(savedKey);
    }
    pingBackend();
  }, [pingBackend]);

  const handleBackendAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAddress = e.target.value;
    setBackendAddress(newAddress);
  };

  const applyBackendAddress = useCallback((addr: string) => {
    localStorage.setItem('orchestrator-backend-address', addr);
    apiClient.setBaseUrl(addr);
    if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
    pingTimeoutRef.current = setTimeout(pingBackend, 300);
  }, [pingBackend]);

  const handleBackendAddressBlur = () => {
    applyBackendAddress(backendAddress);
  };

  const handleBackendAddressKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyBackendAddress(backendAddress);
      (e.target as HTMLInputElement).blur();
    }
  };


  const applyApiKey = useCallback((key: string) => {
    const trimmed = key.trim();
    localStorage.setItem('orchestrator-api-key', trimmed);
    apiClient.setApiKey(trimmed);
  }, []);

  const handleApiKeyBlur = () => {
    applyApiKey(apiKey);
  };

  const handleApiKeyKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyApiKey(apiKey);
      (e.target as HTMLInputElement).blur();
    }
  };


  const handleCreateSession = async () => {
    await createSession(undefined, flowId);
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sessions.findIndex(s => s.id === active.id);
      const newIndex = sessions.findIndex(s => s.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderSessions(oldIndex, newIndex);
      }
    }
  };

  const connDot =
    connStatus === 'connected'
      ? 'bg-green-500'
      : connStatus === 'checking'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-red-500';

  const connTitle =
    connStatus === 'connected'
      ? 'Backend connected'
      : connStatus === 'checking'
      ? 'Checking connection…'
      : 'Backend unreachable';

  return (
    <div className={`flex items-center min-w-0 ${compact ? 'w-full flex-1 bg-white dark:bg-gray-900 border-0' : 'bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700'} px-2 py-1 overflow-x-auto`}>
      {/* Backend Address Input + connection indicator */}
      <div className={`${compact ? 'hidden' : 'flex'} items-center mr-2 px-3 py-1 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600`}>
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
        <span
          className={`ml-2 w-2 h-2 rounded-full flex-shrink-0 ${connDot}`}
          title={connTitle}
        />
      </div>

      {/* API Key Input */}
      <div className={`${compact ? 'hidden' : 'flex'} items-center mr-4 px-3 py-1 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600`}>
        <KeyRound size={14} className="mr-2 text-gray-500 dark:text-gray-400 flex-shrink-0" />
        <input
          type={showApiKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={handleApiKeyBlur}
          onKeyPress={handleApiKeyKeyPress}
          placeholder="API key"
          className="bg-transparent border-none outline-none text-sm w-32 text-gray-700 dark:text-gray-200"
          title="Server API key (shown in backend console)"
        />
        <button
          onClick={() => setShowApiKey(v => !v)}
          className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
          title={showApiKey ? 'Hide key' : 'Show key'}
        >
          {showApiKey ? '●' : '○'}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sessions.map(s => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          {sessions.map((session) => (
            <SortableTab
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              isEditing={editingSessionId === session.id}
              editingName={editingName}
              onSwitch={() => switchSession(session.id)}
              onClose={(e) => handleCloseSession(session.id, e)}
              onEdit={(e) => handleEditSession(session.id, session.name, e)}
              onNameChange={setEditingName}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              canClose={sessions.length > 1}
              isLoading={isLoading}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        onClick={handleCreateSession}
        className="flex items-center px-3 py-2 ml-1 rounded-t-lg bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        title="Create new session"
        disabled={isLoading}
      >
        <Plus size={14} className="dark:text-gray-200" />
        <span className="ml-1 text-sm dark:text-gray-200">New</span>
      </button>

      {/* Hero title */}
    </div>
  );
};

export default SessionTabs;
