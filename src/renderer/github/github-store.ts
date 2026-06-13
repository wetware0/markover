import { create } from 'zustand';

// Identifies the GitHub file currently being edited, so Save knows where to commit.
export interface GitHubSource {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  sha: string;
}

interface GitHubState {
  login: string | null;
  source: GitHubSource | null;
  setLogin: (login: string | null) => void;
  setSource: (source: GitHubSource | null) => void;
}

export const useGitHubStore = create<GitHubState>((set) => ({
  login: null,
  source: null,
  setLogin: (login) => set({ login }),
  setSource: (source) => set({ source }),
}));
