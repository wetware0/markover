import React, { useEffect, useState } from 'react';
import { useGitHubStore, type GitHubSource } from './github-store';
import { defaultNewBranchName } from './branch-plan';
import { toast } from '../ui/toast/toast-store';

interface Props {
  open: boolean;
  onClose: () => void;
  initialFileName: string;
  getContent: () => string;
  onSaved: (source: GitHubSource, fileName: string) => void;
}

type Repo = { full_name: string; default_branch: string };
type Entry = { name: string; path: string; type: 'file' | 'dir' };
type Branch = { name: string; protected: boolean };

export function SaveToGitHubDialog({ open, onClose, initialFileName, getContent, onSaved }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [dir, setDir] = useState('');
  const [dirs, setDirs] = useState<Entry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fileName, setFileName] = useState(initialFileName);
  const [branchMode, setBranchMode] = useState<'existing' | 'new'>('existing');
  const [existingBranch, setExistingBranch] = useState('');
  const [newBranch, setNewBranch] = useState(defaultNewBranchName(initialFileName));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepo(null); setDir(''); setFileName(initialFileName);
    setNewBranch(defaultNewBranchName(initialFileName));
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open, initialFileName]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    setExistingBranch(repo.default_branch);
    setMessage(`Add ${fileName} via Markover`);
    window.electronAPI.githubListContents(owner, name, dir, repo.default_branch)
      .then((e) => setDirs(e.filter((x) => x.type === 'dir')))
      .catch((e) => toast.error(`Could not list folder: ${e.message}`));
    window.electronAPI.githubListBranches(owner, name).then(setBranches).catch(() => setBranches([]));
  }, [repo, dir]); // eslint-disable-line

  const commit = async () => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    const branch = branchMode === 'new' ? newBranch : existingBranch;
    const path = dir ? `${dir}/${fileName}` : fileName;
    setBusy(true);
    try {
      if (branchMode === 'new') {
        const baseSha = await window.electronAPI.githubGetBranchSha(owner, name, repo.default_branch);
        await window.electronAPI.githubCreateBranch(owner, name, branch, baseSha);
      }
      const { sha } = await window.electronAPI.githubPutFile(owner, name, path, getContent(), message || `Add ${fileName} via Markover`, branch);
      const source: GitHubSource = { owner, repo: name, branch, path, sha };
      useGitHubStore.getState().setSource(source);
      onSaved(source, fileName);
      toast.success(branch === repo.default_branch
        ? 'Saved to GitHub'
        : `Committed to ${branch} — open a pull request on GitHub to merge`);
      onClose();
    } catch (e) {
      toast.error(`Save to GitHub failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Save to GitHub</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">
            {repos.map((r) => (
              <li key={r.full_name}>
                <button type="button" onClick={() => setRepo(r)} className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700">{r.full_name}</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <button type="button" onClick={() => { setRepo(null); setDir(''); }} className="text-blue-600">← repos</button>
              <span className="ml-2 font-mono">{repo.full_name}/{dir}</span>
            </div>
            <div>
              <div className="mb-1 text-gray-500">Folder</div>
              <ul className="divide-y border rounded max-h-32 overflow-auto">
                {dir && <li><button type="button" className="w-full text-left px-2 py-1 text-blue-600" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))}>↑ up</button></li>}
                {dirs.map((d) => (
                  <li key={d.path}><button type="button" className="w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setDir(d.path)}>📁 {d.name}</button></li>
                ))}
              </ul>
            </div>
            <label className="block">File name
              <input className="mt-1 w-full border rounded px-2 py-1 dark:bg-gray-900" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </label>
            <fieldset className="space-y-1">
              <legend className="text-gray-500">Branch</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={branchMode === 'existing'} onChange={() => setBranchMode('existing')} />
                <select className="border rounded px-2 py-1 dark:bg-gray-900" value={existingBranch} onChange={(e) => setExistingBranch(e.target.value)} disabled={branchMode !== 'existing'}>
                  {branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={branchMode === 'new'} onChange={() => setBranchMode('new')} />
                <span>New branch</span>
                <input className="border rounded px-2 py-1 dark:bg-gray-900 flex-1" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} disabled={branchMode !== 'new'} />
              </label>
            </fieldset>
            <label className="block">Commit message
              <input className="mt-1 w-full border rounded px-2 py-1 dark:bg-gray-900" value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">Cancel</button>
              <button type="button" disabled={busy || !fileName} onClick={commit} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">{busy ? 'Saving…' : 'Commit'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
