import { create } from 'zustand';

export interface TrackedChange {
  id: string;
  type: 'insertion' | 'deletion';
  author: string;
  date: string;
  text: string;
}

interface TrackChangesState {
  enabled: boolean;
  changes: TrackedChange[];
  currentAuthor: string;

  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  setChanges: (changes: TrackedChange[]) => void;
  addChange: (change: TrackedChange) => void;
  removeChange: (id: string) => void;
  setCurrentAuthor: (author: string) => void;
}

export const useTrackChangesStore = create<TrackChangesState>((set, get) => ({
  enabled: false,
  changes: [],
  currentAuthor: 'User',

  setEnabled: (enabled) => set({ enabled }),
  toggle: () => set({ enabled: !get().enabled }),
  setChanges: (changes) => set({ changes }),
  addChange: (change) => set({ changes: [...get().changes, change] }),
  removeChange: (id) => set({ changes: get().changes.filter((c) => c.id !== id) }),
  setCurrentAuthor: (author) => set({ currentAuthor: author }),
}));
