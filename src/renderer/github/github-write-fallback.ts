import { toast } from '../ui/toast/toast-store';

// True for GitHub write rejections caused by protection / permissions / SSO,
// where the right move is to offer another branch or a local save (not a raw error).
export function isProtectedOrForbidden(err: unknown): boolean {
  const m = (err as Error)?.message ?? '';
  return /\((403|404|409|422)\)/.test(m) || /protected|not\s*found|pull request/i.test(m);
}

export interface FallbackChoice { action: 'choose-branch' | 'save-local' | 'cancel'; }

// Shows a clear, actionable dialog for a rejected write and returns the user's choice.
export function offerWriteFallback(repoLabel: string, branch: string): FallbackChoice {
  const msg =
    `${repoLabel} blocked a direct change to "${branch}".\n\n` +
    `OK = choose another branch (or create one)\n` +
    `Cancel = save a copy to your computer instead.`;
  const chooseBranch = window.confirm(msg);
  if (chooseBranch) return { action: 'choose-branch' };
  return { action: 'save-local' };
}

export function notifyWriteFailed(err: unknown): void {
  toast.error(`GitHub save failed: ${(err as Error)?.message ?? 'unknown error'}`);
}
