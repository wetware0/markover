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
  FIND_OPEN: 'menu:find-open',
  REPLACE_OPEN: 'menu:replace-open',
  GET_WORD_COUNT: 'editor:word-count',
  SPELLCHECK_GET_LANGUAGES: 'spellcheck:get-languages',
  SPELLCHECK_SET_LANGUAGES: 'spellcheck:set-languages',
  SPELLCHECK_ADD_WORD: 'spellcheck:add-word',
  PRINT: 'print:print',
  EXPORT_PDF: 'print:export-pdf',
  CONFIRM_CLOSE: 'app:confirm-close',
  GET_OS_USERNAME: 'os:get-username',
  SHELL_OPEN_PATH: 'shell:open-path',
  FILE_OPEN_PATH: 'file:open-path',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ElectronAPI {
  openFile: () => Promise<FileData | null>;
  saveFile: (filePath: string, content: string) => Promise<SaveResult>;
  saveFileAs: (content: string) => Promise<SaveResult | null>;
  newFile: () => void;
  onMenuAction: (callback: (action: string) => void) => () => void;
  onFileChanged: (callback: (data: FileData) => void) => () => void;
  spellcheckGetLanguages: () => Promise<string[]>;
  spellcheckSetLanguages: (languages: string[]) => Promise<void>;
  spellcheckAddWord: (word: string) => Promise<void>;
  print: () => Promise<void>;
  exportPdf: () => Promise<{ success: boolean; filePath?: string } | null>;
  confirmClose: () => void;
  getOsUsername: () => Promise<string>;
  openPath: (path: string) => Promise<void>;
  openFilePath: (filePath: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
