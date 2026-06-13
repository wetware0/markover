import React, { useEffect, useState } from 'react';
import { useGitHubStore, type GitHubSource } from './github-store';
import { toast } from '../ui/toast/toast-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened: (source: GitHubSource, content: string, fileName: string) => void;
}

export function OpenFromGitHubDialog({ open, onClose, onOpened }: Props) {
  const setSource = useGitHubStore((s) => s.setSource);
  const [repos, setRepos] = useState<Array<{ full_name: string; default_branch: string }>>([]);
  const [repo, setRepo] = useState<{ full_name: string; default_branch: string } | null>(null);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<Array<{ name: string; path: string; type: 'file' | 'dir' }>>([]);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListContents(owner, name, dir, repo.default_branch)
      .then((e) => setEntries(e.filter((x) => x.type === 'dir' || /\.(md|markdown)$/i.test(x.name))))
      .catch((e) => toast.error(`Could not list folder: ${e.message}`));
  }, [repo, dir]);

  const openFile = async (filePath: string, fileName: string) => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    try {
      const { content, sha } = await window.electronAPI.githubGetFile(owner, name, filePath, repo.default_branch);
      const source: GitHubSource = { owner, repo: name, branch: repo.default_branch, path: filePath, sha };
      setSource(source);
      onOpened(source, content, fileName);
      onClose();
    } catch (e) {
      toast.error(`Could not open file: ${(e as Error).message}`);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Open from GitHub</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">
            {repos.map((r) => (
              <li key={r.full_name}>
                <button type="button" onClick={() => { setRepo(r); setDir(''); }} className="w-full text-left py-2 hover:bg-gray-100 dark:hover:bg-gray-700 px-2">
                  {r.full_name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="text-sm mb-2">
              <button type="button" onClick={() => { setRepo(null); setEntries([]); }} className="text-blue-600">← repos</button>
              {dir && <> / <button type="button" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))} className="text-blue-600">up</button></>}
              <span className="ml-2 font-mono">{repo.full_name}/{dir}</span>
            </div>
            <ul className="divide-y">
              {entries.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => e.type === 'dir' ? setDir(e.path) : openFile(e.path, e.name)}
                    className="w-full text-left py-2 hover:bg-gray-100 dark:hover:bg-gray-700 px-2"
                  >
                    {e.type === 'dir' ? '📁 ' : '📄 '}{e.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
