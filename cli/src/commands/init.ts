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
import { detectStack, sampleStructure, type StackDetection } from '../detect.js';

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

function renderReactProfile(template: string, s: StackDetection, structure: string): string {
  const vals: Record<string, string> = {
    FRAMEWORK: s.framework === 'unknown' ? 'unknown (treat as a generic React app)' : s.framework,
    FRAMEWORK_VERSION: s.framework_version,
    TYPESCRIPT: s.typescript.present
      ? `TypeScript (strict mode ${s.typescript.strict ? 'on' : 'off'})`
      : 'JavaScript',
    ROUTER: s.router ?? 'none detected',
    STATE_LIB: s.state_lib ?? 'local component state only',
    DATA_FETCHING: s.data_fetching ?? 'none detected — fetch in a data layer, not in components',
    FORMS: s.forms ?? 'none detected',
    VALIDATION: s.validation ?? 'none detected',
    STYLING: s.styling ?? 'none detected',
    TEST_FRAMEWORK: s.testing.unit ?? 'none detected',
    RTL: s.testing.rtl ? 'yes' : 'no',
    E2E: s.testing.e2e ?? 'none detected',
    FILE_STRUCTURE: structure,
  };
  let out = template;
  for (const [k, v] of Object.entries(vals)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

/**
 * Regenerate the stack sections but keep everything under the `# User-authored`
 * heading. The heading is matched as a *whole line* (the template's own prose
 * mentions `# User-authored` inline, which a substring search would wrongly
 * hit).
 */
const USER_HEADING = /^# User-authored[^\S\r\n]*$/m;

function mergeUserAuthored(generated: string, claudeMdPath: string): string {
  const gMatch = USER_HEADING.exec(generated);
  const head = gMatch ? generated.slice(0, gMatch.index) : `${generated}\n`;
  if (!existsSync(claudeMdPath)) return generated;
  const prev = readFileSync(claudeMdPath, 'utf8');
  const pMatch = USER_HEADING.exec(prev);
  const userBlock = pMatch
    ? prev.slice(pMatch.index).trimEnd()
    : `# User-authored\n\n${prev.trim()}`;
  return `${head}${userBlock}\n`;
}

const CODER_REACT_RULES = `

## React rules (project override — applied on top of the global coder)

This file shadows the global \`coder\` agent for this project (Claude Code
project scope wins). Everything above still applies; additionally, for React
work obey the project's \`CLAUDE.md\` and:

- Functional components only; named exports; no default exports for
  components; no \`React.FC\`; no class components.
- Props typed via \`interface ComponentNameProps\`.
- \`useEffect\` only for external synchronization with an exhaustive dependency
  array; never for derived state (compute inline or with \`useMemo\`).
- Use the detected state / data-fetching / styling libraries' idioms from
  \`CLAUDE.md\`; never introduce a parallel library.
- Validation schemas go in \`src/schemas/\`; infer types from the schema.
- Every component ships with tests; leave lint/format clean.
`;

const TESTER_REACT_RULES = `

## React testing defaults (project override — applied on top of the global tester)

This file shadows the global \`tester\` agent for this project. Everything
above still applies; additionally:

- Use the project's detected unit runner (Vitest by default) with React
  Testing Library.
- Query priority, strictly: \`getByRole\` > \`getByLabelText\` > \`getByText\` >
  \`getByTestId\`. \`getByTestId\` is a last resort.
- Test behavior through the DOM. No shallow rendering; never use enzyme.
- Every new component and every bug fix ships with a covering test.
- Assert on accessible output, not implementation details.
`;

function writeAgentOverride(cwd: string, name: string, rulesBlock: string): void {
  const globalPath = join(paths.agentsDir, `${name}.md`);
  if (!existsSync(globalPath)) return;
  const base = readFileSync(globalPath, 'utf8').trimEnd();
  writeFileSync(join(cwd, '.claude', 'agents', `${name}.md`), `${base}\n${rulesBlock}`);
  console.log(pc.green(`wrote .claude/agents/${name}.md (project override)`));
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

  if (profile === 'react') {
    // Render the template from live detection and (re)write CLAUDE.md,
    // preserving anything under `# User-authored`. Safe to re-run.
    const stack = detectStack(cwd);
    const tpl = existsSync(profileFile)
      ? readFileSync(profileFile, 'utf8')
      : '# Project guide (react)\n\nProfile template missing.\n\n# User-authored\n';
    const rendered = renderReactProfile(tpl, stack, sampleStructure(cwd));
    writeFileSync(claudeMd, mergeUserAuthored(rendered, claudeMd));
    console.log(
      pc.green(
        `wrote CLAUDE.md from react profile — framework=${stack.framework}, ` +
          `state=${stack.state_lib ?? 'none'}, styling=${stack.styling ?? 'none'}, ` +
          `tests=${stack.testing.unit ?? 'none'}`,
      ),
    );
    writeAgentOverride(cwd, 'coder', CODER_REACT_RULES);
    writeAgentOverride(cwd, 'tester', TESTER_REACT_RULES);
  } else if (existsSync(claudeMd) && !force) {
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
