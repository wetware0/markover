import { create } from 'zustand';

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  wrap: boolean;
  inSelection: boolean;
  selectionFrom?: number;
  selectionTo?: number;
}

const defaultOptions: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  wrap: true,
  inSelection: false,
};

function loadHistory(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveHistory(key: string, history: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function addToHistory(history: string[], value: string): string[] {
  if (!value.trim()) return history;
  const deduped = history.filter((h) => h !== value);
  const next = [value, ...deduped].slice(0, 10);
  return next;
}

interface FindReplaceState {
  isOpen: boolean;
  activeTab: 'find' | 'replace';
  query: string;
  replacement: string;
  options: SearchOptions;
  matchCount: number;
  currentMatchIndex: number;
  scopeLabel: string | null;
  regexError: string | null;
  statusMessage: string | null;
  findHistory: string[];
  replaceHistory: string[];

  open: (tab?: 'find' | 'replace', prefill?: string) => void;
  close: () => void;
  setActiveTab: (tab: 'find' | 'replace') => void;
  setQuery: (query: string) => void;
  setReplacement: (replacement: string) => void;
  setOption: <K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => void;
  setMatchInfo: (count: number, index: number, scopeLabel?: string | null) => void;
  setRegexError: (error: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  clearMatchState: () => void;
  pushFindHistory: (query: string) => void;
  pushReplaceHistory: (replacement: string) => void;
}

export const useFindReplaceStore = create<FindReplaceState>((set, get) => ({
  isOpen: false,
  activeTab: 'find',
  query: '',
  replacement: '',
  options: defaultOptions,
  matchCount: 0,
  currentMatchIndex: 0,
  scopeLabel: null,
  regexError: null,
  statusMessage: null,
  findHistory: loadHistory('markover-find-history'),
  replaceHistory: loadHistory('markover-replace-history'),

  open: (tab = 'find', prefill) => {
    const update: Partial<FindReplaceState> = { isOpen: true, activeTab: tab };
    if (prefill !== undefined) update.query = prefill;
    set(update);
  },

  close: () => set({ isOpen: false }),

  setActiveTab: (activeTab) => set({ activeTab }),

  setQuery: (query) => set({ query, statusMessage: null }),

  setReplacement: (replacement) => set({ replacement }),

  setOption: (key, value) =>
    set((s) => ({ options: { ...s.options, [key]: value } })),

  setMatchInfo: (matchCount, currentMatchIndex, scopeLabel = null) =>
    set({ matchCount, currentMatchIndex, scopeLabel }),

  setRegexError: (regexError) => set({ regexError }),

  setStatusMessage: (statusMessage) => set({ statusMessage }),

  clearMatchState: () =>
    set({ matchCount: 0, currentMatchIndex: 0, scopeLabel: null, statusMessage: null }),

  pushFindHistory: (query) => {
    const next = addToHistory(get().findHistory, query);
    saveHistory('markover-find-history', next);
    set({ findHistory: next });
  },

  pushReplaceHistory: (replacement) => {
    const next = addToHistory(get().replaceHistory, replacement);
    saveHistory('markover-replace-history', next);
    set({ replaceHistory: next });
  },
}));
