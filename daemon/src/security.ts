// Pre-completion security gate. Before a root task is marked done, scan its
// task tree for the most recent security-auditor result and refuse the
// transition if it left an unresolved blocking finding.
import type { FleetDb } from './db.js';

export interface GateResult {
  blocked: boolean;
  reason?: string;
}

interface AuditorOutput {
  blocking?: unknown;
  findings?: Array<{ severity?: unknown }>;
}

export function unresolvedSecurityBlock(db: FleetDb, rootId: string): GateResult {
  const audits = db
    .getTaskTree(rootId)
    .filter((t) => t.assignedAgent === 'security-auditor')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (audits.length === 0) return { blocked: false }; // never audited → no finding to resolve

  const latest = audits[audits.length - 1]!;
  if (latest.status !== 'done') {
    return { blocked: true, reason: `latest security-auditor task is ${latest.status}, not done` };
  }
  const out = (latest.outputJson ?? null) as AuditorOutput | null;
  if (out && out.blocking === true) {
    return { blocked: true, reason: 'security-auditor reported blocking findings (high|critical)' };
  }
  const severities = (out?.findings ?? []).map((f) => String(f?.severity));
  if (severities.some((s) => s === 'high' || s === 'critical')) {
    return { blocked: true, reason: 'unresolved high|critical security finding in the tree' };
  }
  return { blocked: false };
}
