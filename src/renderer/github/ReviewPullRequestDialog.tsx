import React, { useEffect, useState } from 'react';
import { toast } from '../ui/toast/toast-store';
import { toTrackedMarkdown } from './pr-diff';
import type { ReviewSession } from './github-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onReview: (session: ReviewSession, trackedMarkdown: string) => void;
}
type Repo = { full_name: string; default_branch: string };
type PR = { number: number; title: string; user: string; base: string; head: string };

export function ReviewPullRequestDialog({ open, onClose, onReview }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [pr, setPr] = useState<PR | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepo(null); setPr(null); setFiles([]);
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListPullRequests(owner, name).then(setPrs).catch((e) => toast.error(`Could not list PRs: ${e.message}`));
  }, [repo]);

  useEffect(() => {
    if (!repo || !pr) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListPullRequestFiles(owner, name, pr.number)
      .then((fs) => setFiles(fs.filter((f) => /\.(md|markdown)$/i.test(f.filename)).map((f) => f.filename)))
      .catch((e) => toast.error(`Could not list PR files: ${e.message}`));
  }, [repo, pr]);

  const reviewFile = async (path: string) => {
    if (!repo || !pr) return;
    const [owner, name] = repo.full_name.split('/');
    setBusy(true);
    try {
      const meta = await window.electronAPI.githubGetPullRequest(owner, name, pr.number);
      const baseFile = await window.electronAPI.githubGetFile(owner, name, path, meta.baseSha).catch(() => ({ content: '', sha: '' }));
      const headFile = await window.electronAPI.githubGetFile(owner, name, path, meta.headSha);
      const tracked = toTrackedMarkdown(baseFile.content, headFile.content, meta.author, new Date(0).toISOString().slice(0, 10));
      onReview({ owner, repo: name, number: pr.number, title: pr.title, path }, tracked);
      onClose();
    } catch (e) {
      toast.error(`Could not load PR file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Review a Pull Request</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">{repos.map((r) => <li key={r.full_name}><button type="button" className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setRepo(r)}>{r.full_name}</button></li>)}</ul>
        ) : !pr ? (
          <>
            <button type="button" onClick={() => setRepo(null)} className="text-blue-600 text-sm mb-2">← repos</button>
            <ul className="divide-y">{prs.map((p) => <li key={p.number}><button type="button" className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setPr(p)}>#{p.number} {p.title} <span className="text-gray-500">({p.user}: {p.head} → {p.base})</span></button></li>)}</ul>
            {prs.length === 0 && <div className="text-sm text-gray-500">No open pull requests.</div>}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setPr(null)} className="text-blue-600 text-sm mb-2">← pull requests</button>
            <div className="text-sm mb-2">#{pr.number} {pr.title}</div>
            <ul className="divide-y">{files.map((f) => <li key={f}><button type="button" disabled={busy} className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50" onClick={() => reviewFile(f)}>📄 {f}</button></li>)}</ul>
            {files.length === 0 && <div className="text-sm text-gray-500">No changed markdown files in this PR.</div>}
          </>
        )}
      </div>
    </div>
  );
}
