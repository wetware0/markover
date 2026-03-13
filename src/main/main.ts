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

const createWindow = () => {
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

  Menu.setApplicationMenu(buildMenu(mainWindow, (filePath) => {
    currentFilePath = filePath;
    updateTitle();
  }));

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

function updateTitle() {
  if (!mainWindow) return;
  const fileName = currentFilePath ? path.basename(currentFilePath) : 'Untitled';
  mainWindow.setTitle(`${fileName} — Markover`);
}

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
