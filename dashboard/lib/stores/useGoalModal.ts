'use client';
// t10: process-wide store for the SubmitGoal modal so other routes can pop
// it open with a prefilled prompt (e.g. /work-items "Send as goal") without
// the sessionStorage + URL-param dance.
import { create } from 'zustand';

interface GoalModalState {
  open: boolean;
  prefillGoal: string;
  prefillSource: string | null;
  show: (opts?: { goal?: string; source?: string }) => void;
  hide: () => void;
}

export const useGoalModal = create<GoalModalState>((set) => ({
  open: false,
  prefillGoal: '',
  prefillSource: null,
  show: ({ goal = '', source = null } = {}) =>
    set({ open: true, prefillGoal: goal, prefillSource: source }),
  hide: () => set({ open: false, prefillGoal: '', prefillSource: null }),
}));
