/**
 * Type definitions for Electron API
 */

interface ElectronAPI {
  /**
   * Set the window title
   * @param title The title to set
   */
  setTitle: (title: string) => void;
  
  /**
   * Register a callback for when a flow JSON is loaded
   * @param callback The callback function
   */
  onLoadFlowJson: (callback: (data: [string, string | null]) => void) => void;
  
  /**
   * Save flow data to a specific path
   * @param filePath The file path to save to
   * @param data The data to save
   */
  saveFlowToPath: (filePath: string, data: string) => void;
  
  /**
   * Open a file dialog to select a flow file (.or or .json)
   * @returns The selected file path and data, or null if cancelled
   */
  openFlowFile: () => Promise<{filePath: string, data: string} | null>;
  
  /**
   * Open a flow file in a new window
   * @param flowFilePath Path to the flow file to open
   * @returns True if successful, false otherwise
   */
  openFlowInNewWindow: (flowFilePath: string) => Promise<boolean>;
  
  /**
   * Open a save dialog to save flow data to a file (.or or .json)
   * @param data The data to save
   * @returns The saved file path, or null if cancelled
   */
  saveFlowAs: (data: string) => Promise<string | null>;
  
  /**
   * Ensure a directory exists, creating it if necessary
   * @param dirPath The directory path to ensure exists
   * @returns A promise that resolves when the directory exists
   */
  ensureDirectoryExists: (dirPath: string) => Promise<void>;
  
  /**
   * Write text content to a file
   * @param filePath The file path to write to
   * @param content The text content to write
   * @returns A promise that resolves when the file is written
   */
  writeTextFile: (filePath: string, content: string) => Promise<void>;
  
  /**
   * Read text content from a file
   * @param filePath The file path to read from
   * @returns A promise that resolves with the file content
   */
  readTextFile: (filePath: string) => Promise<string>;
  
  /**
   * Check if a directory exists
   * @param dirPath The directory path to check
   * @returns A promise that resolves with a boolean indicating if the directory exists
   */
  directoryExists: (dirPath: string) => Promise<boolean>;
  
  /**
   * Move a directory and its contents to a new location
   * @param sourcePath The source directory path
   * @param targetPath The target directory path
   * @returns A promise that resolves when the directory is moved
   */
  moveDirectory: (sourcePath: string, targetPath: string) => Promise<void>;
  
  /**
   * Deletes a directory and all its contents recursively.
   * @param dirPath - The absolute path to the directory to delete.
   * @returns A promise that resolves when the directory has been successfully deleted.
   */
  deleteDirectory: (dirPath: string) => Promise<void>;

  /**
   * Deletes a single file at the given path.
   * @param filePath - The absolute path to the file to delete.
   * @returns A promise that resolves when the file has been successfully deleted.
   */
  deleteFile: (filePath: string) => Promise<void>;

  /**
   * Renames or moves a file from one path to another.
   * @param oldPath - The current full path of the file.
   * @param newPath - The new full path for the file, including the desired filename.
   * @returns A promise that resolves when the file has been successfully renamed or moved.
   */
  renameFile: (oldPath: string, newPath: string) => Promise<void>;

  /**
   * Check if a file exists
   * @param filePath The file path to check
   * @returns A promise that resolves with a boolean indicating if the file exists
   */
  fileExists: (filePath: string) => Promise<boolean>;
  
  /**
   * Convert a relative path to an absolute path
   * @param relativePath The relative path to convert
   * @param basePath The base path to resolve from
   * @returns The absolute path
   */
  getAbsolutePath: (relativePath: string, basePath: string) => string;
  
  /**
   * Convert an absolute path to a relative path
   * @param absolutePath The absolute path to convert
   * @param basePath The base path to resolve from
   * @returns The relative path
   */
  getRelativePath: (absolutePath: string, basePath: string) => string;
}

interface BackendAPI {
  /**
   * Execute a node job through the backend process
   * @param payload The job payload
   * @returns The job result
   */
  executeNodeJob: (payload: any) => Promise<any>;
  
  /**
   * Execute a flow file directly
   * @param flowFilePath Path to the flow file to execute
   * @param input Optional input data for the flow
   * @returns The result of the flow execution
   */
  executeFlowFile: (flowFilePath: string, input?: any) => Promise<any>;
  
  /**
   * Create a stop signal file for a running job
   * @param jobId The ID of the job to stop
   * @returns A promise that resolves when the stop signal is created
   */
  createStopSignal: (jobId: string) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
  backendAPI?: BackendAPI;
}