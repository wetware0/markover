// A branch choice in the Save-to-GitHub dialog: an existing branch, or a new one.
export type BranchChoice =
  | { kind: 'existing'; name: string }
  | { kind: 'new'; name: string };

/** Default name for a freshly-created branch, derived from the file name. */
export function defaultNewBranchName(fileName: string): string {
  const base = fileName.split('/').pop() || fileName;
  return `markover/${base}`;
}
