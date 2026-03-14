import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const USER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

interface UserState {
  name: string;
  color: string;
  setName: (name: string) => void;
  setColor: (color: string) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      name: '',
      color: USER_COLORS[0],
      setName: (name) => set({ name }),
      setColor: (color) => set({ color }),
    }),
    { name: 'markover-user' },
  ),
);

/** Returns the display name, falling back to 'User' if not set. */
export function getAuthorName(name: string): string {
  return name.trim() || 'User';
}

/** Returns up to 2 initials from the name. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
