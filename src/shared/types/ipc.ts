export interface FileData {
  filePath: string;
  content: string;
  fileName: string;
}

export interface SaveResult {
  success: boolean;
  filePath: string;
  error?: string;
  conflict?: boolean;
}

export const IPC_CHANNELS = {
  PATH_RELATIVE: 'path:relative',
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  FILE_SAVE_AS: 'file:save-as',
  FILE_NEW: 'file:new',
  FILE_CHANGED: 'file:changed',
  MENU_ACTION: 'menu:action',
  FIND_OPEN: 'find-open',
  REPLACE_OPEN: 'replace-open',
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
  GITHUB_START_AUTH: 'github:start-auth',
  GITHUB_POLL_AUTH: 'github:poll-auth',
  GITHUB_SIGN_OUT: 'github:sign-out',
  GITHUB_GET_USER: 'github:get-user',
  GITHUB_LIST_REPOS: 'github:list-repos',
  GITHUB_LIST_CONTENTS: 'github:list-contents',
  GITHUB_GET_FILE: 'github:get-file',
  GITHUB_PUT_FILE: 'github:put-file',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ElectronAPI {
  getPathForFile: (file: File) => string;
  getRelativePath: (fromDir: string, toPath: string) => Promise<string>;
  openFile: () => Promise<FileData | null>;
  saveFile: (filePath: string, content: string, force?: boolean) => Promise<SaveResult>;
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
  githubStartAuth: () => Promise<{ user_code: string; verification_uri: string; device_code: string; interval: number; expires_in: number }>;
  githubPollAuth: (deviceCode: string, interval: number, expiresIn: number) => Promise<boolean>;
  githubSignOut: () => Promise<void>;
  githubGetUser: () => Promise<{ login: string } | null>;
  githubListRepos: () => Promise<Array<{ full_name: string; default_branch: string }>>;
  githubListContents: (owner: string, repo: string, dirPath: string, ref?: string) => Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>>;
  githubGetFile: (owner: string, repo: string, filePath: string, ref?: string) => Promise<{ content: string; sha: string }>;
  githubPutFile: (owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) => Promise<{ sha: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
