import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (kind: ToastKind, message: string, ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (kind, message, ttlMs = 5000) => {
    const id = nanoid(8);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (ttlMs > 0) {
      setTimeout(() => get().dismiss(id), ttlMs);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Convenience helpers for non-component call sites.
export const toast = {
  info: (m: string) => useToastStore.getState().show('info', m),
  success: (m: string) => useToastStore.getState().show('success', m),
  error: (m: string, ttlMs = 0) => useToastStore.getState().show('error', m, ttlMs), // errors stick until dismissed
};
