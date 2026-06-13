import { loadToken } from './token-store';

const BASE = 'https://api.github.com';

async function gh(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const token = await loadToken();
  if (!token) throw new Error('Not signed in to GitHub');
  return fetch(`${BASE}${pathAndQuery}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

export interface Repo { full_name: string; default_branch: string; }
export interface ContentEntry { name: string; path: string; type: 'file' | 'dir'; }

export async function getUser(): Promise<{ login: string } | null> {
  const res = await gh('/user');
  return res.ok ? ((await res.json()) as { login: string }) : null;
}

export async function listRepos(): Promise<Repo[]> {
  const res = await gh('/user/repos?per_page=100&sort=updated');
  if (!res.ok) throw new Error(`List repos failed (${res.status})`);
  return (await res.json()) as Repo[];
}

export async function listContents(owner: string, repo: string, dirPath = '', ref?: string): Promise<ContentEntry[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(dirPath)}${q}`);
  if (!res.ok) throw new Error(`List contents failed (${res.status})`);
  return (await res.json()) as ContentEntry[];
}

export interface FileContent { content: string; sha: string; }

export async function getFile(owner: string, repo: string, filePath: string, ref?: string): Promise<FileContent> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await gh(`/repos/${owner}/${repo}/contents/${filePath}${q}`);
  if (!res.ok) throw new Error(`Get file failed (${res.status})`);
  const data = (await res.json()) as { content: string; sha: string; encoding: string };
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

// Commit a file via the Contents API. `sha` must be the current blob sha when updating.
export async function putFile(
  owner: string, repo: string, filePath: string,
  content: string, message: string, branch: string, sha?: string,
): Promise<{ sha: string }> {
  const res = await gh(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Commit failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}
