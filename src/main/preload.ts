import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type ElectronAPI } from '../shared/types/ipc';

const api: ElectronAPI = {
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
  spellcheckGetLanguages: () => ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_GET_LANGUAGES),
  spellcheckSetLanguages: (languages: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_SET_LANGUAGES, languages),
  spellcheckAddWord: (word: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_ADD_WORD, word),
};

contextBridge.exposeInMainWorld('electronAPI', api);
