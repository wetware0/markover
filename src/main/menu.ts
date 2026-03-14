import { Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/types/ipc';

export function buildMenu(
  window: BrowserWindow,
  recentFiles: string[],
  openFile: (filePath: string) => Promise<void>,
): Menu {
  const sendAction = (action: string) => {
    window.webContents.send(IPC_CHANNELS.MENU_ACTION, action);
  };

  const recentSubmenu: MenuItemConstructorOptions[] =
    recentFiles.length > 0
      ? [
          ...recentFiles.map((filePath) => ({
            label: path.basename(filePath),
            sublabel: path.dirname(filePath),
            click: () => openFile(filePath),
          })),
        ]
      : [{ label: 'No Recent Files', enabled: false }];

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
          click: () => sendAction('open'),
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
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
        {
          label: 'Publish...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendAction('publish'),
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
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => sendAction('bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => sendAction('italic') },
        { label: 'Underline', accelerator: 'CmdOrCtrl+U', click: () => sendAction('underline') },
        { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+X', click: () => sendAction('strike') },
        { type: 'separator' },
        { label: 'Code', accelerator: 'CmdOrCtrl+E', click: () => sendAction('code') },
        { label: 'Code Block', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendAction('code-block') },
        { type: 'separator' },
        { label: 'Blockquote', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendAction('blockquote') },
        { label: 'Horizontal Rule', click: () => sendAction('horizontal-rule') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Raw Mode', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendAction('toggle-raw') },
        { type: 'separator' },
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
