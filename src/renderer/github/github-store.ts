import { create } from 'zustand';

// Identifies the GitHub file currently being edited, so Save knows where to commit.
export interface GitHubSource {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  sha: string;
}

// Identifies the pull request being reviewed (read-only) in the editor.
export interface ReviewSession {
  owner: string;
  repo: string;
  number: number;
  title: string;
  path: string;
}

interface GitHubState {
  login: string | null;
  source: GitHubSource | null;
  reviewSession: ReviewSession | null;
  reviewMode: boolean;
  setLogin: (login: string | null) => void;
  setSource: (source: GitHubSource | null) => void;
  setReviewSession: (s: ReviewSession | null) => void;
  setReviewMode: (on: boolean) => void;
}

export const useGitHubStore = create<GitHubState>((set) => ({
  login: null,
  source: null,
  reviewSession: null,
  reviewMode: false,
  setLogin: (login) => set({ login }),
  setSource: (source) => set({ source }),
  setReviewSession: (reviewSession) => set({ reviewSession }),
  setReviewMode: (reviewMode) => set({ reviewMode }),
}));
