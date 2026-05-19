'use client';
// Current project_root + a small MRU list. The board still reads ?project= for
// SSR filtering; this store mirrors it and feeds the header picker's recents.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const MAX_RECENT = 8;

interface ProjectState {
  current: string | null;
  recent: string[];
  setProject: (root: string) => void;
}

export const useProject = create<ProjectState>()(
  persist(
    (set, get) => ({
      current: null,
      recent: [],
      setProject: (root) => {
        if (!root) return;
        const recent = [root, ...get().recent.filter((r) => r !== root)].slice(0, MAX_RECENT);
        set({ current: root, recent });
      },
    }),
    {
      name: 'aifleet-project',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
