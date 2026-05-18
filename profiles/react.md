# Project guide (react profile)

This file is read by every ai-fleet subagent before it works on this
repository. The stack section below was filled in by `ai-fleet init` from
automated detection — treat it as ground truth for this project's
conventions. Anything you add by hand survives re-init if you keep it under
the `# User-authored` heading at the bottom.

## Project stack

- Framework: {{FRAMEWORK}} {{FRAMEWORK_VERSION}}
- Language: {{TYPESCRIPT}}
- Router: {{ROUTER}}
- State management: {{STATE_LIB}}
- Data fetching: {{DATA_FETCHING}}
- Forms: {{FORMS}}
- Schema validation: {{VALIDATION}}
- Styling: {{STYLING}}
- Unit tests: {{TEST_FRAMEWORK}} (React Testing Library: {{RTL}})
- End-to-end tests: {{E2E}}

## File structure conventions

Sampled from the existing layout — place new files alongside their peers,
do not invent a parallel structure:

{{FILE_STRUCTURE}}

Read at least three sibling files in the relevant directory before adding a
new one, and mirror their naming, exports, and import ordering.

## Component rules

- Functional components only — no class components.
- Named exports only; **no default exports for components**.
- Props typed via an explicit `interface ComponentNameProps` (one per
  component, named for the component).
- Do not annotate components with `React.FC` / `React.FunctionComponent`;
  type props via the parameter.
- One component per file; co-locate component-only subcomponents.
- Keep components presentational where practical; push side effects to
  hooks.

## Hooks rules

- `useEffect` must have a complete, exhaustive dependency array. Never
  silence the lint rule.
- Do not use `useEffect` to compute derived state — compute it inline or
  with `useMemo`. `useEffect` is for synchronizing with external systems
  only.
- Add `useCallback`/`useMemo` only for a measured cause (a profiled render
  cost or a referential-stability requirement), not by default.
- Custom hooks start with `use`, return stable references, and own their
  effects.

## State management

Detected: {{STATE_LIB}}. Use its idioms; do not introduce a second state
library.

- Keep state as local as possible; lift only to the lowest common ancestor
  that needs it, and reach for the detected library only for genuinely
  shared/cross-route state.
- Derive, don't duplicate: never store what can be computed from existing
  state or props.
- Keep server cache state in the data-fetching layer, not in the client
  state library.

## Data fetching

Detected: {{DATA_FETCHING}}. Use its idioms.

- All remote reads/writes go through the data-fetching layer — no ad-hoc
  `fetch` in components.
- Cache keys are stable, serializable arrays namespaced by domain, e.g.
  `['settings', userId]`; colocate key builders with the query hooks.
- Mutations invalidate or update the affected keys; prefer optimistic
  updates only where the rollback path is defined.

## Forms

Detected: {{FORMS}} with {{VALIDATION}}.

- Validation schemas live in `src/schemas/` and are the single source of
  truth; infer types from the schema rather than redeclaring them.
- Wire the schema into the form via the detected library's resolver;
  surface field errors accessibly (label + `aria-describedby`).

## Styling

Detected: {{STYLING}}. Use its idioms.

- Reference design tokens / theme variables; never hard-code colors,
  spacing, or font sizes that a token exists for.
- Keep style co-located with the component per the detected approach; no
  global overrides for component-local concerns.

## Testing

Detected unit framework: {{TEST_FRAMEWORK}}; React Testing Library:
{{RTL}}; end-to-end: {{E2E}}.

- Test behavior through the DOM as a user would. **No shallow rendering;
  never use enzyme.**
- Query priority, strictly in this order:
  `getByRole` > `getByLabelText` > `getByText` > `getByTestId`.
  `getByTestId` is the last resort.
- Every new component ships with tests; every bug fix ships with a
  regression test.
- Assert on accessible output, not implementation details.

## Accessibility

- Target WCAG 2.2 AA.
- Semantic HTML first; ARIA only to fill gaps native elements cannot.
- Every interactive element is keyboard operable and labeled.
- `axe-core` checks are expected to pass with zero violations on changed
  components and routes; the a11y-auditor subagent enforces this.

## Performance budgets

> Placeholder — the project should fill these in. Suggested starting
> points: route-level JS ≤ 170 KB gzip, Largest Contentful Paint ≤ 2.5 s on
> a mid-tier device, no unnecessary client components. Until filled, treat
> "no obvious regressions vs. the current route" as the bar.

# User-authored

<!-- Anything below this heading is preserved across `ai-fleet init` re-runs.
     Add project-specific rules, exceptions, and context here. -->
