// v19+v20: tests for the goal-defaults persistence + goal-modal counter.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGoalDefaults } from '@/lib/stores/useGoalDefaults';
import { useGoalModal } from '@/lib/stores/useGoalModal';

beforeEach(() => {
  // Reset both stores to a known baseline for each case.
  useGoalDefaults.setState({ agent: 'orchestrator', effort: 'medium', wdMode: 'current' });
  useGoalModal.setState({ open: false, prefillGoal: '', prefillSource: null, showCount: 0 });
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('useGoalDefaults (v19)', () => {
  it('mutates and persists via localStorage', () => {
    useGoalDefaults.getState().setEffort('high');
    useGoalDefaults.getState().setAgent('coder');
    useGoalDefaults.getState().setWdMode('recent');
    const raw = localStorage.getItem('aifleet-goal-defaults');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state).toMatchObject({
      effort: 'high',
      agent: 'coder',
      wdMode: 'recent',
    });
  });
});

describe('useGoalModal (v20)', () => {
  it('bumps showCount on every show', () => {
    const start = useGoalModal.getState().showCount;
    useGoalModal.getState().show({ goal: 'g1', source: 's1' });
    useGoalModal.getState().show({ goal: 'g2', source: 's2' });
    expect(useGoalModal.getState().showCount).toBe(start + 2);
    expect(useGoalModal.getState().prefillGoal).toBe('g2');
  });
  it('hide() clears the prefill (v5)', () => {
    useGoalModal.getState().show({ goal: 'g', source: 's' });
    useGoalModal.getState().hide();
    expect(useGoalModal.getState().open).toBe(false);
    expect(useGoalModal.getState().prefillGoal).toBe('');
    expect(useGoalModal.getState().prefillSource).toBeNull();
  });
});
