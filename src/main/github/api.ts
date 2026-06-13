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

export interface Branch { name: string; protected: boolean; }

export async function listBranches(owner: string, repo: string): Promise<Branch[]> {
  const res = await gh(`/repos/${owner}/${repo}/branches?per_page=100`);
  if (!res.ok) throw new Error(`List branches failed (${res.status})`);
  return (await res.json()) as Branch[];
}

export async function getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string> {
  const res = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!res.ok) throw new Error(`Get branch head failed (${res.status})`);
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

export async function createBranch(owner: string, repo: string, newBranch: string, fromSha: string): Promise<void> {
  const res = await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create branch failed (${res.status}): ${body}`);
  }
}

export interface PullRequest { number: number; title: string; user: string; base: string; head: string; updated_at: string; }

export async function listPullRequests(owner: string, repo: string): Promise<PullRequest[]> {
  const res = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  if (!res.ok) throw new Error(`List pull requests failed (${res.status})`);
  const data = (await res.json()) as Array<{ number: number; title: string; user: { login: string }; base: { ref: string }; head: { ref: string }; updated_at: string }>;
  return data.map((p) => ({ number: p.number, title: p.title, user: p.user.login, base: p.base.ref, head: p.head.ref, updated_at: p.updated_at }));
}

export async function listPullRequestFiles(owner: string, repo: string, num: number): Promise<{ filename: string; status: string }[]> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}/files?per_page=100`);
  if (!res.ok) throw new Error(`List PR files failed (${res.status})`);
  return (await res.json()) as { filename: string; status: string }[];
}

export async function getPullRequest(owner: string, repo: string, num: number): Promise<{ baseSha: string; headSha: string; baseRef: string; headRef: string; author: string }> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}`);
  if (!res.ok) throw new Error(`Get PR failed (${res.status})`);
  const p = (await res.json()) as { base: { sha: string; ref: string }; head: { sha: string; ref: string }; user: { login: string } };
  return { baseSha: p.base.sha, headSha: p.head.sha, baseRef: p.base.ref, headRef: p.head.ref, author: p.user.login };
}

export async function submitReview(owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string): Promise<void> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ event, body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Submit review failed (${res.status}): ${txt}`);
  }
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
