const { contextBridge, ipcRenderer } = require('electron');

console.log('!!! PRELOAD LOADED !!!');

// Expose backend API
contextBridge.exposeInMainWorld('backendAPI', {
  executeNodeJob: async (payload) => ipcRenderer.invoke('execute-node-job', payload),
  createStopSignal: async (jobId) => ipcRenderer.invoke('create-stop-signal', jobId),
});

// Expose electron API
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  onLoadFlowJson: (callback) => ipcRenderer.on('load-flow-json', (event, data) => callback(data)),
  saveFlowToPath: (filePath, data) => ipcRenderer.send('save-flow-to-path', filePath, data),
  openFlowFile: () => ipcRenderer.invoke('open-flow-file'),
  openFlowInNewWindow: (flowFilePath) => ipcRenderer.invoke('open-flow-in-new-window', flowFilePath),
  saveFlowAs: (data) => ipcRenderer.invoke('save-flow-as', data),

  //  Extra utilities
  ensureDirectoryExists: async (dirPath) => {
    const fs = require('fs').promises;
    await fs.mkdir(dirPath, { recursive: true });
  },
  writeTextFile: async (filePath, content) => {
    const fs = require('fs').promises;
    await fs.writeFile(filePath, content, 'utf8');
  },
  readTextFile: async (filePath) => {
    const fs = require('fs').promises;
    return await fs.readFile(filePath, 'utf8');
  },
  directoryExists: async (dirPath) => {
    const fs = require('fs').promises;
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  },
  moveDirectory: async (sourcePath, targetPath) => {
    const fs = require('fs').promises;
    await fs.rename(sourcePath, targetPath);
  },
  deleteDirectory: async (dirPath) => {
    const fs = require('fs').promises;
    await fs.rm(dirPath, { recursive: true, force: true });
  },
  deleteFile: async(filePath)=>{
    const fs = require('fs').promises;
    await fs.unlink(filePath);
  },
  renameFile: async (oldPath, newPath) => {
    const fs = require('fs').promises;
    await fs.rename(oldPath, newPath);
  },
  fileExists: async (filePath) => {
    const fs = require('fs').promises;
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  },
  getAbsolutePath: (relativePath, basePath) => {
    const path = require('path');
    return path.resolve(basePath, relativePath);
  },
  getRelativePath: (absolutePath, basePath) => {
    const path = require('path');
    return path.relative(basePath, absolutePath);
  },
});
