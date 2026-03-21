import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, type ElectronAPI } from '../shared/types/ipc';

const api: ElectronAPI = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getRelativePath: (fromDir: string, toPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PATH_RELATIVE, fromDir, toPath),
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN),
  saveFile: (filePath: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, filePath, content),
  saveFileAs: (content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_AS, content),
  newFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_NEW),
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on(IPC_CHANNELS.MENU_ACTION, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_ACTION, handler);
  },
  onFileChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never);
    ipcRenderer.on(IPC_CHANNELS.FILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_CHANGED, handler);
  },
  confirmClose: () => ipcRenderer.send(IPC_CHANNELS.CONFIRM_CLOSE),
  print: () => ipcRenderer.invoke(IPC_CHANNELS.PRINT),
  exportPdf: () => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PDF),
  spellcheckGetLanguages: () => ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_GET_LANGUAGES),
  spellcheckSetLanguages: (languages: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_SET_LANGUAGES, languages),
  spellcheckAddWord: (word: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_ADD_WORD, word),
  getOsUsername: () => ipcRenderer.invoke(IPC_CHANNELS.GET_OS_USERNAME),
  openPath: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, filePath),
  openFilePath: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_PATH, filePath),
};

contextBridge.exposeInMainWorld('electronAPI', api);
