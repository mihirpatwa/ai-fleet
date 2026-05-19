// The fleet's subagent roster (mirrors /home/.../agents + link-agents.sh).
// Used for the SubmitGoal starting-agent picker and the Settings model table
// so every agent shows even before it has any task history.
export const AGENTS = [
  'orchestrator',
  'planner',
  'researcher',
  'coder',
  'reviewer',
  'tester',
  'debugger',
  'security-auditor',
  'devops',
  'doc-writer',
  'frontend-architect',
  'a11y-auditor',
  'scribe',
  'retrospector',
] as const;

export type AgentName = (typeof AGENTS)[number];
