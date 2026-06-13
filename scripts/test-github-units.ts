import { composeTitle } from '../src/renderer/github/compose-title';
import { defaultNewBranchName } from '../src/renderer/github/branch-plan';

let pass = 0, fail = 0;
function eq(name: string, got: string, want: string) {
  if (got === want) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
}

eq('signed out', composeTitle('notes.md', null), 'notes.md — Markover');
eq('default branch name', defaultNewBranchName('notes.md'), 'markover/notes.md');
eq('default branch name strips dir', defaultNewBranchName('docs/notes.md'), 'markover/notes.md');
eq('signed in', composeTitle('notes.md', 'alice'), 'notes.md — Markover · GitHub: alice');
eq('untitled signed in', composeTitle('Untitled', 'alice'), 'Untitled — Markover · GitHub: alice');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
