import { app, BrowserWindow, ipcMain, dialog, Menu, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import { IPC_CHANNELS } from '../shared/types/ipc';
import { buildMenu } from './menu';

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;
let recentFiles: string[] = [];

const RECENT_PATH = path.join(app.getPath('userData'), 'recent-files.json');
const MAX_RECENT = 10;

// --- Recent files ---

async function loadRecentFiles(): Promise<void> {
  try {
    const data = await fs.readFile(RECENT_PATH, 'utf-8');
    recentFiles = JSON.parse(data) as string[];
  } catch {
    recentFiles = [];
  }
}

async function addRecentFile(filePath: string): Promise<void> {
  recentFiles = [filePath, ...recentFiles.filter((p) => p !== filePath)].slice(0, MAX_RECENT);
  await fs.writeFile(RECENT_PATH, JSON.stringify(recentFiles), 'utf-8').catch((_err) => { /* ignore write errors */ });
  rebuildMenu();
}

// --- Window / title ---

function updateTitle() {
  if (!mainWindow) return;
  const fileName = currentFilePath ? path.basename(currentFilePath) : 'Untitled';
  mainWindow.setTitle(`${fileName} — Markover`);
}

function rebuildMenu() {
  if (!mainWindow) return;
  Menu.setApplicationMenu(buildMenu(mainWindow, recentFiles, openFileByPath));
}

// --- Open a file (used by menu and CLI) ---

async function openFileByPath(filePath: string): Promise<void> {
  if (!mainWindow) return;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    currentFilePath = filePath;
    updateTitle();
    await addRecentFile(filePath);
    mainWindow.webContents.send(IPC_CHANNELS.FILE_CHANGED, {
      filePath,
      content,
      fileName: path.basename(filePath),
    });
  } catch (err) {
    console.error('Failed to open file:', err);
  }
}

// --- CLI file argument ---

function getCliFilePath(): string | null {
  // dev:  argv = [electron, '.', ...userArgs]
  // prod: argv = [markover.exe, ...userArgs]
  const args = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('--') && a !== '.');
  return args[0] || null;
}

// --- Window creation ---

const createWindow = async () => {
  await loadRecentFiles();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Markover',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  rebuildMenu();

  // Enable spell checking
  session.defaultSession.setSpellCheckerLanguages(['en-US']);

  // Handle spell check context menu
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (params.misspelledWord) {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];

      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuItems.push({
          label: suggestion,
          click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
        });
      }

      if (menuItems.length > 0) {
        menuItems.push({ type: 'separator' });
      }

      menuItems.push({
        label: 'Add to Dictionary',
        click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });

      menuItems.push({ type: 'separator' });
      menuItems.push({ role: 'cut' });
      menuItems.push({ role: 'copy' });
      menuItems.push({ role: 'paste' });

      const contextMenu = Menu.buildFromTemplate(menuItems);
      contextMenu.popup();
    }
  });

  // Guard: warn before close if renderer signals unsaved changes via beforeunload
  mainWindow.webContents.on('will-prevent-unload', async (event) => {
    event.preventDefault(); // Let us handle it
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Save & Close', 'Close Without Saving', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'You have unsaved changes',
      detail: 'Do you want to save your changes before closing?',
    });
    if (response === 0) {
      // Ask renderer to save, then signal back to close
      mainWindow?.webContents.send(IPC_CHANNELS.MENU_ACTION, 'save-and-close');
    } else if (response === 1) {
      mainWindow?.destroy();
    }
    // response === 2: cancel — do nothing
  });

  // Open CLI file after renderer is ready
  const cliFile = getCliFilePath();
  if (cliFile) {
    mainWindow.webContents.once('did-finish-load', () => {
      // Small delay to let the React app mount and register its IPC listener
      setTimeout(() => openFileByPath(cliFile), 300);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// IPC Handlers

ipcMain.handle(IPC_CHANNELS.FILE_OPEN, async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  currentFilePath = filePath;
  updateTitle();
  await addRecentFile(filePath);

  return {
    filePath,
    content,
    fileName: path.basename(filePath),
  };
});

ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, filePath: string, content: string) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    currentFilePath = filePath;
    updateTitle();
    await addRecentFile(filePath);
    return { success: true, filePath };
  } catch {
    return { success: false, filePath };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_SAVE_AS, async (_event, content: string) => {
  if (!mainWindow) return null;

  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    defaultPath: currentFilePath || 'untitled.md',
  });

  if (result.canceled || !result.filePath) return null;

  try {
    await fs.writeFile(result.filePath, content, 'utf-8');
    currentFilePath = result.filePath;
    updateTitle();
    await addRecentFile(result.filePath);
    return { success: true, filePath: result.filePath };
  } catch {
    return null;
  }
});

// Print & PDF Export
ipcMain.handle(IPC_CHANNELS.PRINT, async () => {
  if (!mainWindow) return;
  mainWindow.webContents.print({ silent: false, printBackground: true });
});

ipcMain.handle(IPC_CHANNELS.EXPORT_PDF, async () => {
  if (!mainWindow) return null;

  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    defaultPath: currentFilePath
      ? currentFilePath.replace(/\.[^.]+$/, '.pdf')
      : 'untitled.pdf',
  });

  if (result.canceled || !result.filePath) return null;

  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' },
    });
    await fs.writeFile(result.filePath, pdfData);
    return { success: true, filePath: result.filePath };
  } catch {
    return { success: false };
  }
});

// Renderer signals that save is done and the window can now close
ipcMain.on(IPC_CHANNELS.CONFIRM_CLOSE, () => {
  mainWindow?.destroy();
});

// Spellcheck IPC
ipcMain.handle(IPC_CHANNELS.SPELLCHECK_GET_LANGUAGES, () => {
  return session.defaultSession.getSpellCheckerLanguages();
});

ipcMain.handle(IPC_CHANNELS.SPELLCHECK_SET_LANGUAGES, (_event, languages: string[]) => {
  session.defaultSession.setSpellCheckerLanguages(languages);
});

ipcMain.handle(IPC_CHANNELS.SPELLCHECK_ADD_WORD, (_event, word: string) => {
  session.defaultSession.addWordToSpellCheckerDictionary(word);
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
