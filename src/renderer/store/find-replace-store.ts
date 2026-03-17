import { create } from 'zustand';

const FIND_HISTORY_KEY = 'markover-find-history';
const REPLACE_HISTORY_KEY = 'markover-replace-history';

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
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
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
  findHistory: loadHistory(FIND_HISTORY_KEY),
  replaceHistory: loadHistory(REPLACE_HISTORY_KEY),

  open: (tab = 'find', prefill) => {
    const update: Partial<FindReplaceState> = { isOpen: true, activeTab: tab };
    if (prefill !== undefined) update.query = prefill;
    set(update);
  },

  close: () => set({ isOpen: false }),

  setActiveTab: (activeTab) => set({ activeTab }),

  setQuery: (query) => set({ query, statusMessage: null, regexError: null }),

  setReplacement: (replacement) => set({ replacement }),

  setOption: (key, value) =>
    set((s) => ({ options: { ...s.options, [key]: value } })),

  setMatchInfo: (matchCount, currentMatchIndex, scopeLabel = null) =>
    set({ matchCount, currentMatchIndex, scopeLabel }),

  setRegexError: (regexError) => set({ regexError }),

  setStatusMessage: (statusMessage) => set({ statusMessage }),

  clearMatchState: () =>
    set({ matchCount: 0, currentMatchIndex: 0, scopeLabel: null, statusMessage: null, regexError: null }),

  pushFindHistory: (query) => {
    const next = addToHistory(get().findHistory, query);
    saveHistory(FIND_HISTORY_KEY, next);
    set({ findHistory: next });
  },

  pushReplaceHistory: (replacement) => {
    const next = addToHistory(get().replaceHistory, replacement);
    saveHistory(REPLACE_HISTORY_KEY, next);
    set({ replaceHistory: next });
  },
}));
