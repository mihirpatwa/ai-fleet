import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import pc from 'picocolors';
import { execa } from 'execa';
import { fleetRoot, paths, projectConfigPath } from '../lib/paths.js';

function detectProfile(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['react'] || deps['next']) return 'react';
  } catch {
    /* no package.json — generic */
  }
  return 'generic';
}

export async function init(opts: { profile?: string; force?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const force = opts.force ?? false;
  const profile = opts.profile ?? detectProfile(cwd);

  const agents = readdirSync(paths.agentsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();

  const cfgPath = projectConfigPath(cwd);
  if (existsSync(cfgPath) && !force) {
    console.log(pc.yellow('.aifleet.yaml exists — skipping (use --force to overwrite)'));
  } else {
    writeFileSync(
      cfgPath,
      yaml.dump({
        require_security_pass: true,
        profile,
        enabled_agents: agents,
        model_overrides: {},
      }),
    );
    console.log(pc.green('created .aifleet.yaml'));
  }

  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
  console.log(pc.green('created .claude/agents/ (project-level agent overrides)'));

  const profileFile = join(paths.profilesDir, `${profile}.md`);
  const claudeMd = join(cwd, 'CLAUDE.md');
  if (existsSync(claudeMd) && !force) {
    console.log(pc.yellow('CLAUDE.md exists — skipping (use --force to overwrite)'));
  } else if (existsSync(profileFile)) {
    copyFileSync(profileFile, claudeMd);
    console.log(pc.green(`copied "${profile}" profile -> CLAUDE.md`));
  } else {
    writeFileSync(claudeMd, `# Project guide (${profile})\n\nStub — profile not found.\n`);
    console.log(pc.yellow(`profile "${profile}.md" not found; wrote a minimal CLAUDE.md`));
  }

  const gi = join(cwd, '.gitignore');
  const entry = '.aifleet/';
  const content = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (content.split(/\r?\n/).some((l) => l.trim() === entry)) {
    console.log(pc.dim('.gitignore already ignores .aifleet/'));
  } else {
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    appendFileSync(gi, `${prefix}${entry}\n`);
    console.log(pc.green('added .aifleet/ to .gitignore'));
  }

  // Install the global Claude event hooks so `ai-fleet doctor` passes and the
  // daemon's spawned agents stream tool events. Idempotent (phase-4 script).
  try {
    await execa(process.execPath, ['--import', 'tsx', paths.installHooks], {
      cwd: fleetRoot,
      stdio: 'inherit',
    });
  } catch {
    console.log(pc.yellow('warning: could not install Claude hooks; run scripts/install-hooks.ts'));
  }

  console.log(
    `\n${pc.bold('next steps:')}\n` +
      `  ${pc.cyan('ai-fleet doctor')}   verify the environment\n` +
      `  ${pc.cyan('ai-fleet up')}       start the daemon + dashboard\n` +
      `  ${pc.cyan('ai-fleet submit "<goal>"')}`,
  );
}
