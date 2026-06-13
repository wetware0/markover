import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, type ElectronAPI } from '../shared/types/ipc';

const api: ElectronAPI = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getRelativePath: (fromDir: string, toPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PATH_RELATIVE, fromDir, toPath),
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN),
  saveFile: (filePath: string, content: string, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, filePath, content, force),
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
  githubStartAuth: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_START_AUTH),
  githubPollAuth: (deviceCode: string, interval: number, expiresIn: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_POLL_AUTH, deviceCode, interval, expiresIn),
  githubSignOut: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_SIGN_OUT),
  githubGetUser: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_USER),
  githubListRepos: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS),
  githubListContents: (owner: string, repo: string, dirPath: string, ref?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_CONTENTS, owner, repo, dirPath, ref),
  githubGetFile: (owner: string, repo: string, filePath: string, ref?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_FILE, owner, repo, filePath, ref),
  githubPutFile: (owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PUT_FILE, owner, repo, filePath, content, message, branch, sha),
  notifySessionState: (documentName: string, githubLogin: string | null) =>
    ipcRenderer.send(IPC_CHANNELS.SESSION_STATE, documentName, githubLogin),
};

contextBridge.exposeInMainWorld('electronAPI', api);

// Expose the e2e-test flag so the renderer can suppress dialogs (e.g. the
// beforeunload "you have unsaved changes" guard) that race Playwright's
// teardown and produce spurious "No dialog is showing" failures.
// Vite inlines process.env as {} in this bundle, so the main process passes
// the flag via additionalArguments in webPreferences instead.
contextBridge.exposeInMainWorld(
  '__MARKOVER_E2E__',
  process.argv.includes('--markover-e2e-test'),
);
