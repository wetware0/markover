// Headless checks for src/main/file-association.ts. On Windows, also runs the real reg.exe
// commands against a throwaway key (HKCU\Software\MarkoverRegTest) and reads them back.
import { spawnSync } from 'node:child_process';
import { launcherPath, registerCommands, unregisterCommands } from '../src/main/file-association';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
}

const installedExe = 'C:\\Users\\A B\\AppData\\Local\\Markover\\app-1.1.7\\Markover.exe';
const stub = 'C:\\Users\\A B\\AppData\\Local\\Markover\\Markover.exe';
check('Squirrel install points at the root stub', launcherPath(installedExe, (p) => p.endsWith('Update.exe')) === stub);
check('without Update.exe the exe itself is used', launcherPath(installedExe, () => false) === installedExe);

const cmds = registerCommands(stub);
const flat = cmds.map((c) => c.join(' '));
check('open command quotes exe and %1', flat.some((c) => c.includes(`/d "${stub}" "%1"`)));
check('.md and .markdown get OpenWithProgids', ['.md', '.markdown'].every((e) => flat.some((c) => c.includes(`\\${e}\\OpenWithProgids /v Markover.md /t REG_NONE`))));
check('registered for Default apps', flat.some((c) => c.includes('RegisteredApplications /v Markover')));
check('never overrides the existing default handler', !cmds.some((c) => /\\\.(md|markdown)$/.test(c[1]) && c.includes('/ve')));

if (process.platform === 'win32') {
  const SANDBOX = 'HKCU\\Software\\MarkoverRegTest';
  const sandbox = (c: string[]) => c.map((a) => a.replace(/^HKCU\\Software/, SANDBOX));
  const reg = (args: string[]) => spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  try {
    const results = cmds.map((c) => reg(sandbox(c)));
    check('all reg add commands succeed', results.every((r) => r.status === 0), results.find((r) => r.status !== 0)?.stderr);
    const q = reg(['query', `${SANDBOX}\\Classes\\Markover.md\\shell\\open\\command`, '/ve']).stdout;
    check('open command reads back exactly', q.includes(`"${stub}" "%1"`), q);
    const ow = reg(['query', `${SANDBOX}\\Classes\\.md\\OpenWithProgids`, '/v', 'Markover.md']).stdout;
    check('OpenWithProgids value is REG_NONE', /Markover\.md\s+REG_NONE/.test(ow), ow);
    const cap = reg(['query', `${SANDBOX}\\Markover\\Capabilities\\FileAssociations`, '/v', '.markdown']).stdout;
    check('Capabilities maps .markdown to the ProgID', cap.includes('Markover.md'), cap);
    const un = unregisterCommands().map((c) => reg(sandbox(c)));
    check('all reg delete commands succeed', un.every((r) => r.status === 0), un.find((r) => r.status !== 0)?.stderr);
    check('ProgID removed on uninstall', reg(['query', `${SANDBOX}\\Classes\\Markover.md`]).status !== 0);
  } finally {
    reg(['delete', SANDBOX, '/f']);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
