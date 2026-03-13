import { Menu, BrowserWindow, dialog, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/types/ipc';

export function buildMenu(window: BrowserWindow, onFileOpened?: (filePath: string) => void): Menu {
  const sendAction = (action: string) => {
    window.webContents.send(IPC_CHANNELS.MENU_ACTION, action);
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendAction('new'),
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(window, {
              properties: ['openFile'],
              filters: [
                { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
                { name: 'Text', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const filePath = result.filePaths[0];
            try {
              const content = await fs.readFile(filePath, 'utf-8');
              onFileOpened?.(filePath);
              window.webContents.send(IPC_CHANNELS.FILE_CHANGED, {
                filePath,
                content,
                fileName: path.basename(filePath),
              });
            } catch (err) {
              console.error('Failed to read file:', err);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendAction('save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendAction('print'),
        },
        {
          label: 'Export PDF...',
          click: () => sendAction('export-pdf'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Format',
      submenu: [
        {
          label: 'Bold',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendAction('bold'),
        },
        {
          label: 'Italic',
          accelerator: 'CmdOrCtrl+I',
          click: () => sendAction('italic'),
        },
        {
          label: 'Underline',
          accelerator: 'CmdOrCtrl+U',
          click: () => sendAction('underline'),
        },
        {
          label: 'Strikethrough',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => sendAction('strike'),
        },
        { type: 'separator' },
        {
          label: 'Code',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendAction('code'),
        },
        {
          label: 'Code Block',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendAction('code-block'),
        },
        { type: 'separator' },
        {
          label: 'Blockquote',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => sendAction('blockquote'),
        },
        {
          label: 'Horizontal Rule',
          click: () => sendAction('horizontal-rule'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
