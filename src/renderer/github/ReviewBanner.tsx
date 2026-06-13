import React, { useState } from 'react';
import { useGitHubStore } from './github-store';
import { toast } from '../ui/toast/toast-store';

export function ReviewBanner({ onDone }: { onDone: () => void }) {
  const session = useGitHubStore((s) => s.reviewSession);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const submit = async (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') => {
    setBusy(true);
    try {
      const res = await window.electronAPI.githubSubmitReview(session.owner, session.repo, session.number, event, body);
      if (res.ok) {
        toast.success(`Review submitted (${event.replace('_', ' ').toLowerCase()})`);
        onDone();
      } else {
        const msg = res.error ?? 'unknown error';
        // GitHub forbids approving your own PR — show a plain sentence.
        if (/approve your own/i.test(msg)) {
          toast.error("You can't approve your own pull request — try Comment instead.");
        } else {
          toast.error(`Could not submit review: ${msg}`);
        }
      }
    } catch (e) {
      toast.error(`Could not submit review: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-300 px-3 py-2 text-sm">
      <span className="font-medium">Reviewing PR #{session.number}: {session.title}</span>
      <input className="flex-1 min-w-[12rem] border rounded px-2 py-1 dark:bg-gray-900" placeholder="Review summary (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => submit('APPROVE')} className="px-2 py-1 bg-emerald-600 text-white rounded disabled:opacity-50">Approve</button>
      <button type="button" disabled={busy} onClick={() => submit('REQUEST_CHANGES')} className="px-2 py-1 bg-red-600 text-white rounded disabled:opacity-50">Request changes</button>
      <button type="button" disabled={busy} onClick={() => submit('COMMENT')} className="px-2 py-1 border rounded disabled:opacity-50">Comment</button>
      <button type="button" onClick={onDone} className="px-2 py-1 border rounded">Done</button>
    </div>
  );
}
