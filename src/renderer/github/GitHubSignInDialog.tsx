import React, { useEffect, useState } from 'react';
import { useGitHubStore } from './github-store';
import { toast } from '../ui/toast/toast-store';

export function GitHubSignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setLogin = useGitHubStore((s) => s.setLogin);
  const [code, setCode] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setCode(null); setUri(null); setBusy(false); }
  }, [open]);

  const begin = async () => {
    setBusy(true);
    try {
      const dc = await window.electronAPI.githubStartAuth();
      setCode(dc.user_code);
      setUri(dc.verification_uri);
      await window.electronAPI.openPath(dc.verification_uri); // opens in default browser (https branch of shell handler)
      const ok = await window.electronAPI.githubPollAuth(dc.device_code, dc.interval, dc.expires_in);
      if (ok) {
        const user = await window.electronAPI.githubGetUser();
        setLogin(user?.login ?? null);
        toast.success(`Signed in to GitHub as ${user?.login ?? 'user'}`);
        onClose();
      } else {
        toast.error('GitHub sign-in was not completed.');
      }
    } catch (err) {
      toast.error(`GitHub sign-in failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[28rem] max-w-[90vw]">
        <h2 className="text-lg font-semibold mb-3">Sign in to GitHub</h2>
        {!code ? (
          <>
            <p className="text-sm mb-4">Markover will open github.com in your browser and give you a one-time code to authorise access.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded">Cancel</button>
              <button type="button" disabled={busy} onClick={begin} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50">
                {busy ? 'Starting…' : 'Sign in'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm mb-2">Enter this code at <span className="font-mono">{uri}</span>:</p>
            <p className="text-2xl font-mono tracking-widest text-center my-4">{code}</p>
            <p className="text-xs text-gray-500">Waiting for authorisation… you can close this once approved.</p>
          </>
        )}
      </div>
    </div>
  );
}
