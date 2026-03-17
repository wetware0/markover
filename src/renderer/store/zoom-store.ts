import { create } from 'zustand';

interface ZoomState {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const useZoomStore = create<ZoomState>((set) => ({
  zoomLevel: 100,
  zoomIn: () => set((s) => ({ zoomLevel: Math.min(200, s.zoomLevel + 10) })),
  zoomOut: () => set((s) => ({ zoomLevel: Math.max(50, s.zoomLevel - 10) })),
  resetZoom: () => set({ zoomLevel: 100 }),
}));
