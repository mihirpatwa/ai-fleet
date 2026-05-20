'use client';
// t7: remember the last-used effort + starting agent across sessions so the
// goal modal opens with the same defaults you ended on. Persisted to
// localStorage like the rest of the user-pref stores.
// u8: also persists the workdir-mode preference (Current / Recent / Pick).
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Effort = 'low' | 'medium' | 'high' | 'max';
export type WdMode = 'current' | 'recent' | 'pick';

interface GoalDefaultsState {
  agent: string;
  effort: Effort;
  wdMode: WdMode;
  setAgent: (a: string) => void;
  setEffort: (e: Effort) => void;
  setWdMode: (m: WdMode) => void;
}

export const useGoalDefaults = create<GoalDefaultsState>()(
  persist(
    (set) => ({
      agent: 'orchestrator',
      effort: 'medium',
      wdMode: 'current',
      setAgent: (agent) => set({ agent }),
      setEffort: (effort) => set({ effort }),
      setWdMode: (wdMode) => set({ wdMode }),
    }),
    {
      name: 'aifleet-goal-defaults',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
