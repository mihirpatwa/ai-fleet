'use client';
// t10: process-wide store for the SubmitGoal modal so other routes can pop
// it open with a prefilled prompt (e.g. /work-items "Send as goal") without
// the sessionStorage + URL-param dance.
import { create } from 'zustand';

interface GoalModalState {
  open: boolean;
  prefillGoal: string;
  prefillSource: string | null;
  /** u20: monotonic counter — bumps on every show() even if the modal is
   *  already open, so consumers can re-apply the prefill when a second
   *  Send-as-goal fires before the first close. */
  showCount: number;
  show: (opts?: { goal?: string; source?: string }) => void;
  hide: () => void;
}

export const useGoalModal = create<GoalModalState>((set) => ({
  open: false,
  prefillGoal: '',
  prefillSource: null,
  showCount: 0,
  show: ({ goal = '', source = null } = {}) =>
    set((s) => ({
      open: true,
      prefillGoal: goal,
      prefillSource: source,
      showCount: s.showCount + 1,
    })),
  hide: () => set({ open: false, prefillGoal: '', prefillSource: null }),
}));
