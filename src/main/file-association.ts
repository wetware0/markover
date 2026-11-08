import { app, dialog, shell, type BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Per-user (HKCU) registration: no admin rights needed. Windows 10/11 won't let an app
// make itself the default handler, so this adds Markover to "Open with" and to the
// Default apps list; the user picks it there (see promptToSetDefault).
const APP_NAME = 'Markover';
const PROG_ID = 'Markover.md';
const EXTENSIONS = ['.md', '.markdown'];
const CLASSES = 'HKCU\\Software\\Classes';
const CAPABILITIES = 'Software\\Markover\\Capabilities';

export type RegCommand = string[];

/**
 * Squirrel installs a stub at <root>\Markover.exe that always launches the newest
 * app-x.y.z, so point at it rather than this versioned exe. The stub may not exist yet
 * while the install hook runs, so key off Update.exe, which always does.
 */
export function launcherPath(execPath = process.execPath, exists = fs.existsSync): string {
  const root = path.resolve(path.dirname(execPath), '..');
  return exists(path.join(root, 'Update.exe')) ? path.join(root, path.basename(execPath)) : execPath;
}

export function registerCommands(exe: string): RegCommand[] {
  const add = (key: string, name: string | null, data: string, type = 'REG_SZ'): RegCommand => [
    'add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', type, '/d', data, '/f',
  ];
  const progKey = `${CLASSES}\\${PROG_ID}`;
  return [
    add(progKey, null, 'Markdown Document'),
    add(`${progKey}\\DefaultIcon`, null, `"${exe}",0`),
    add(`${progKey}\\shell\\open\\command`, null, `"${exe}" "%1"`),
    ...EXTENSIONS.map((ext) => add(`${CLASSES}\\${ext}\\OpenWithProgids`, PROG_ID, '', 'REG_NONE')),
    add(`HKCU\\${CAPABILITIES}`, 'ApplicationName', APP_NAME),
    add(`HKCU\\${CAPABILITIES}`, 'ApplicationDescription', 'Markdown editor with comments and track changes'),
    ...EXTENSIONS.map((ext) => add(`HKCU\\${CAPABILITIES}\\FileAssociations`, ext, PROG_ID)),
    add('HKCU\\Software\\RegisteredApplications', APP_NAME, CAPABILITIES),
  ];
}

export function unregisterCommands(): RegCommand[] {
  return [
    ['delete', `${CLASSES}\\${PROG_ID}`, '/f'],
    ...EXTENSIONS.map((ext): RegCommand => ['delete', `${CLASSES}\\${ext}\\OpenWithProgids`, '/v', PROG_ID, '/f']),
    ['delete', 'HKCU\\Software\\Markover', '/f'],
    ['delete', 'HKCU\\Software\\RegisteredApplications', '/v', APP_NAME, '/f'],
  ];
}

function runReg(commands: RegCommand[]): boolean {
  let ok = true;
  for (const args of commands) {
    const result = spawnSync('reg.exe', args, { windowsHide: true, timeout: 5000 });
    if (result.status !== 0) ok = false;
  }
  return ok;
}

export function registerFileAssociation(exe = launcherPath()): boolean {
  return runReg(registerCommands(exe));
}

export function unregisterFileAssociation(): void {
  runReg(unregisterCommands());
}

/** Runs synchronously during Squirrel's install/update/uninstall hooks, before the app quits. */
export function handleSquirrelFileAssociation(argv = process.argv): void {
  if (process.platform !== 'win32') return;
  switch (argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      registerFileAssociation();
      break;
    case '--squirrel-uninstall':
      unregisterFileAssociation();
      break;
  }
}

export async function promptToSetDefault(window: BrowserWindow | null): Promise<void> {
  if (process.platform !== 'win32') return;
  const registered = !app.isPackaged || registerFileAssociation();
  const options = {
    type: registered ? 'info' : 'warning',
    title: 'Open Markdown files with Markover',
    message: registered
      ? 'Windows will open its Default apps settings.'
      : 'Markover could not register itself for .md files.',
    detail: registered
      ? 'Choose Markover for .md (and .markdown) files there. Markover is also listed under "Open with" when you right-click a Markdown file.'
      : 'You can still choose Markover with "Open with > Choose another app" when you right-click a Markdown file.',
    buttons: registered ? ['Open Default apps', 'Cancel'] : ['OK'],
    defaultId: 0,
    cancelId: registered ? 1 : 0,
  } as const;
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (registered && response === 0) {
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${APP_NAME}`);
  }
}
