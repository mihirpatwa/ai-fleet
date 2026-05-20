// Phase 18g: Azure DevOps connection persistence. Connection metadata
// (org_url + project + validated_at) is stored in ~/.aifleet/azure.json;
// the PAT itself goes into ~/.aifleet/secrets.env as AZURE_DEVOPS_PAT so
// it shares the chmod 600 + load-on-boot path with other provider secrets.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { aifleetDir } from '../config.js';
import { readSecrets, writeSecrets } from '../providers/storage.js';
import type { AzureConnection, AzureConnectionState } from './types.js';

const PAT_ENV = 'AZURE_DEVOPS_PAT';
const FILE = 'azure.json';

function path(): string {
  return join(aifleetDir(), FILE);
}

const EMPTY: AzureConnection = { org_url: '', project: '', validated_at: null };

export function loadConnection(): AzureConnection {
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(path(), 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveConnection(c: AzureConnection): void {
  mkdirSync(dirname(path()), { recursive: true });
  writeFileSync(path(), JSON.stringify(c, null, 2));
}

export function currentPat(): string | undefined {
  return process.env[PAT_ENV] ?? readSecrets()[PAT_ENV];
}

export function writePat(pat: string): void {
  writeSecrets({ [PAT_ENV]: pat });
  process.env[PAT_ENV] = pat;
}

export function clearPat(): void {
  const all = readSecrets();
  if (!(PAT_ENV in all)) return;
  delete all[PAT_ENV];
  writeSecrets(all);
  delete process.env[PAT_ENV];
}

export function currentState(): AzureConnectionState {
  const c = loadConnection();
  const hasPat = !!currentPat();
  return {
    ...c,
    connected: !!c.org_url && !!c.project && hasPat,
    error: !hasPat && c.org_url ? `${PAT_ENV} missing from env/secrets.env` : null,
  };
}

export function clearConnection(): void {
  if (existsSync(path())) {
    saveConnection({ ...EMPTY });
  }
  clearPat();
}
