'use client';
// Selected agent model id. The roster of models is a phase-13 endpoint
// (/api/models); until then `current` stays null and the header picker renders
// disabled. The store + persistence are wired now so phase 13 only adds data.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ModelState {
  current: string | null;
  setModel: (id: string | null) => void;
}

export const useModel = create<ModelState>()(
  persist(
    (set) => ({
      current: null,
      setModel: (current) => set({ current }),
    }),
    {
      name: 'aifleet-model',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
