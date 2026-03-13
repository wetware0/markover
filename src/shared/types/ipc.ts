export interface FileData {
  filePath: string;
  content: string;
  fileName: string;
}

export interface SaveResult {
  success: boolean;
  filePath: string;
}

export const IPC_CHANNELS = {
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  FILE_SAVE_AS: 'file:save-as',
  FILE_NEW: 'file:new',
  FILE_CHANGED: 'file:changed',
  MENU_ACTION: 'menu:action',
  GET_WORD_COUNT: 'editor:word-count',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ElectronAPI {
  openFile: () => Promise<FileData | null>;
  saveFile: (filePath: string, content: string) => Promise<SaveResult>;
  saveFileAs: (content: string) => Promise<SaveResult | null>;
  newFile: () => void;
  onMenuAction: (callback: (action: string) => void) => () => void;
  onFileChanged: (callback: (data: FileData) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
