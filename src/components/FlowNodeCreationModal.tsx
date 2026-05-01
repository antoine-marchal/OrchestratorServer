import React, { useState } from 'react';
import { X, Upload, List } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

interface FlowNodeCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string, sessionName: string) => void;
  onUploadFile: (file: File) => void;
  flowId?: string;
}

export default function FlowNodeCreationModal({
  isOpen,
  onClose,
  onSelectSession,
  onUploadFile,
  flowId,
}: FlowNodeCreationModalProps) {
  const [selectedOption, setSelectedOption] = useState<'session' | null>(null);
  const { sessions: allSessions } = useSessionStore();
  const sessions = flowId ? allSessions.filter(session => session.linkedFlowId === flowId) : allSessions;

  if (!isOpen) return null;

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.or';
    input.style.display = 'none';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.or')) {
        alert('Please select a valid .or file');
        return;
      }
      onUploadFile(file);
      onClose();
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  const handleSessionSelect = (sessionId: string, sessionName: string) => {
    onSelectSession(sessionId, sessionName);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Create Flow Node
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {!selectedOption ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Choose how to create the flow node:
              </p>

              <button
                onClick={() => setSelectedOption('session')}
                className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-emerald-500 dark:hover:border-emerald-500 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900 rounded-lg group-hover:bg-emerald-200 dark:group-hover:bg-emerald-800 transition-colors">
                    <List className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      Select Existing Session
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Reference a flow from an open session
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={handleFileUpload}
                className="w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800 transition-colors">
                    <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      Upload .or File
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Load a flow from a file on your computer
                    </p>
                  </div>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">Select a session:</p>
                <button
                  onClick={() => setSelectedOption(null)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Back
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                    No sessions available
                  </p>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => handleSessionSelect(session.id, session.name)}
                      className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-emerald-500 dark:hover:border-emerald-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {session.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {session.flowState.nodes.length} nodes, {session.flowState.edges.length} edges
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
