'use client';
// Selected task + active tab for the detail surface. Persisted so a reload
// keeps you on the same task/tab. The tab set is extended in phase 12.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type DetailTab = 'log' | 'tree' | 'metrics' | 'output';

interface DetailPaneState {
  taskId: string | null;
  tab: DetailTab;
  open: (taskId: string) => void;
  close: () => void;
  setTab: (tab: DetailTab) => void;
}

export const useDetailPane = create<DetailPaneState>()(
  persist(
    (set) => ({
      taskId: null,
      tab: 'log',
      open: (taskId) => set({ taskId }),
      close: () => set({ taskId: null }),
      setTab: (tab) => set({ tab }),
    }),
    {
      name: 'aifleet-detail',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
