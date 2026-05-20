'use client';
// t7: remember the last-used effort + starting agent across sessions so the
// goal modal opens with the same defaults you ended on. Persisted to
// localStorage like the rest of the user-pref stores.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Effort = 'low' | 'medium' | 'high' | 'max';

interface GoalDefaultsState {
  agent: string;
  effort: Effort;
  setAgent: (a: string) => void;
  setEffort: (e: Effort) => void;
}

export const useGoalDefaults = create<GoalDefaultsState>()(
  persist(
    (set) => ({
      agent: 'orchestrator',
      effort: 'medium',
      setAgent: (agent) => set({ agent }),
      setEffort: (effort) => set({ effort }),
    }),
    {
      name: 'aifleet-goal-defaults',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
