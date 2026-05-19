'use client';
// Theme mode store. Persisted under the localStorage key "aifleet-theme" — the
// SAME key the inline anti-FOUC script in app/layout.tsx reads pre-paint, so
// the two never disagree. Shape on disk: {"state":{"mode":...},"version":0}.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'aifleet-theme',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
