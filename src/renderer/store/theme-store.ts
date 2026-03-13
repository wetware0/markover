import { create } from 'zustand';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

const stored = localStorage.getItem('markover-theme') as ThemeMode | null;
const initialMode: ThemeMode = stored && ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
const initialResolved = resolve(initialMode);
applyTheme(initialResolved);

export const useThemeStore = create<ThemeState>((set, get) => {
  // Listen for OS theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { mode } = get();
    if (mode === 'system') {
      const resolved = getSystemTheme();
      applyTheme(resolved);
      set({ resolved });
    }
  });

  return {
    mode: initialMode,
    resolved: initialResolved,

    setMode: (mode) => {
      const resolved = resolve(mode);
      applyTheme(resolved);
      localStorage.setItem('markover-theme', mode);
      set({ mode, resolved });
    },

    cycle: () => {
      const order: ThemeMode[] = ['light', 'dark', 'system'];
      const { mode } = get();
      const next = order[(order.indexOf(mode) + 1) % order.length];
      get().setMode(next);
    },
  };
});
