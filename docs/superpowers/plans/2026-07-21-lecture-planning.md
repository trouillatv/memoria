# Planning Lecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, traceable `Lecture` to the Planning Mois and Semaine views while preserving the existing MemorIA visual and navigation grammar.

**Architecture:** Derive a small, pure planning-reading model from existing planning rows and signals. Render it with a `LecturePanel` orchestration component composed only of existing Tailwind primitives and links; keep the first slice server-derived and silent when evidence is insufficient. Reuse the same model contract at month and week resolution, with different granularities.

**Tech Stack:** Next.js 16 App Router, React Server Components, TypeScript, Tailwind CSS v4, Vitest, existing planning/database readers.

---

### Task 1: Define the deterministic reading model with tests

**Files:**
- Create: `lib/planning/lecture.ts`
- Test: `tests/planning/lecture.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for these exact behaviors:

```ts
import { describe, expect, it } from 'vitest'
import { derivePlanningLecture, type PlanningLectureInput } from '@/lib/planning/lecture'

const base: PlanningLectureInput = {
  scope: 'month',
  anchorDate: '2026-07-17',
  rotations: [{ id: 'rotation-e1', name: 'Roulement E1', endsOn: '2026-07-30' }],
  missions: [
    { id: 'mission-1', name: 'Entretien magasin', siteName: 'Magasin' },
    { id: 'mission-2', name: 'Résidence', siteName: 'Résidence' },
    { id: 'mission-3', name: 'Bureaux', siteName: 'Bureaux' },
  ],
  assignments: [
    { id: 'assignment-1', missionId: 'mission-1', date: '2026-07-17', rotationId: 'rotation-e1', assigned: true },
    { id: 'assignment-2', missionId: 'mission-2', date: '2026-07-17', rotationId: 'rotation-e1', assigned: true },
  ],
  gaps: [
    { date: '2026-07-20', missionId: 'mission-1', rotationId: 'rotation-e1' },
    { date: '2026-07-21', missionId: 'mission-2', rotationId: 'rotation-e1' },
    { date: '2026-07-22', missionId: 'mission-3', rotationId: 'rotation-e1' },
    { date: '2026-07-23', missionId: 'mission-1', rotationId: 'rotation-e1' },
    { date: '2026-07-24', missionId: 'mission-2', rotationId: 'rotation-e1' },
  ],
}

describe('derivePlanningLecture', () => {
  it('returns one traceable primary lecture from graph evidence', () => {
    expect(derivePlanningLecture(base)).toMatchObject({
      contextLabel: 'Planning · 17 juillet 2026',
      headline: 'Le 17 juillet mérite votre attention.',
      primary: {
        kind: 'rotation-gap-impact',
        sourceId: 'rotation-e1',
        sourceLabel: 'Roulement E1',
        gapCount: 5,
        missionCount: 3,
      },
      evidence: { rotations: 1, missions: 3, assignments: 2 },
    })
  })

  it('is deterministic and does not expose a lecture without evidence', () => {
    expect(derivePlanningLecture(base)).toEqual(derivePlanningLecture(base))
    expect(derivePlanningLecture({ ...base, rotations: [], gaps: [] })).toBeNull()
  })

  it('uses week resolution wording while keeping the same causal contract', () => {
    const result = derivePlanningLecture({ ...base, scope: 'week', anchorDate: '2026-07-20' })
    expect(result?.contextLabel).toBe('Planning · 20 juillet 2026')
    expect(result?.headline).toBe('Le lundi 20 mérite votre attention.')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module**

Run: `npx vitest run --project unit tests/planning/lecture.test.ts --reporter=verbose --maxWorkers=1`

Expected: FAIL because `lib/planning/lecture.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure model**

Define exported input/output types, normalize dates with existing local-date helpers, select exactly one primary rotation/gap/mission chain by deterministic ordering (`gapCount` descending, `missionCount` descending, then source id ascending), and return `null` when fewer than one rotation and one gap are available. Do not access Supabase or construct URLs in this pure module.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run --project unit tests/planning/lecture.test.ts --reporter=verbose --maxWorkers=1`

Expected: 3 tests pass.

### Task 2: Build the reusable LecturePanel from existing UI primitives

**Files:**
- Create: `app/(dashboard)/(planning)/LecturePanel.tsx`
- Test: `tests/components/lecture-panel.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Test that the component renders `Lecture`, the context, headline, `Parce que…`, numbered causal nodes, `Construit à partir de`, and the evidence link. Test that a null model renders nothing. Test that node and final links expose accessible names and real `href` values.

- [ ] **Step 2: Run the focused component test and verify it fails**

Run: `npx vitest run --project unit tests/components/lecture-panel.test.tsx --reporter=verbose --maxWorkers=1`

Expected: FAIL because `LecturePanel.tsx` does not exist.

- [ ] **Step 3: Implement the component using existing classes and primitives**

Use Inter inherited from the dashboard layout, `rounded-lg border bg-card`, existing `text-muted-foreground`, `text-brand-600`, `text-rose-700`, `bg-rose-50`, `text-emerald-700`, `bg-emerald-50`, and `text-sky-700`/`bg-sky-50` classes already used by Planning. Use a simple `border-l` reading token only if it already exists in the global theme. Render no shadow, gradient, chatbot, creation button, or custom card primitive. Use Next `Link` for each evidence destination and preserve keyboard focus styles.

- [ ] **Step 4: Run the focused component test and verify it passes**

Run: `npx vitest run --project unit tests/components/lecture-panel.test.tsx --reporter=verbose --maxWorkers=1`

Expected: all component tests pass.

### Task 3: Add server-side month and week adapters

**Files:**
- Create: `lib/planning/lecture-adapter.ts`
- Modify: `app/(dashboard)/(planning)/mois/page.tsx`
- Modify: `app/(dashboard)/(planning)/semaine/page.tsx`
- Test: `tests/planning/lecture-adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Cover that month and week rows are converted into the pure input contract, that organization-scoped mission/rotation data is retained, that evidence counts are stable, and that missing relation data returns `null` instead of inventing a sentence.

- [ ] **Step 2: Run the adapter tests and verify the expected failure**

Run: `npx vitest run --project unit tests/planning/lecture-adapter.test.ts --reporter=verbose --maxWorkers=1`

Expected: FAIL because the adapter module and exported adapter functions do not exist.

- [ ] **Step 3: Implement adapters using existing page loaders**

Reuse the existing `missionOptions`, `rotationOptions`, teams, site rows, and week/month date ranges already loaded by the two pages. Keep all database access in existing server-side readers; pass only normalized serializable data into `derivePlanningLecture`. Use deterministic link targets for mission, rotation, site, and intervention sources following existing route conventions.

- [ ] **Step 4: Integrate `LecturePanel` into both pages**

Place the panel beside the existing grid in the same visual hierarchy. Keep the current Week controls and planning actions in the existing secondary header. For Month use month scope and the selected month anchor; for Week use week scope and the selected week’s primary attention date. Do not remove or rename existing KPI/grid components in this task.

- [ ] **Step 5: Run adapter and focused planning tests**

Run: `npx vitest run --project unit tests/planning/lecture-adapter.test.ts tests/planning/lecture.test.ts tests/planning/month-view.test.ts --reporter=verbose --maxWorkers=1`

Expected: all focused tests pass.

### Task 4: Verify visual continuity and regressions

**Files:**
- Modify: existing files only if verification identifies a concrete mismatch with the approved design.
- Test: existing focused planning/component suites.

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: exit code 0; Next.js compiles and prerenders without a Lecture-related error.

- [ ] **Step 3: Run focused regression tests**

Run: `npx vitest run --project unit tests/planning tests/components/lecture-panel.test.tsx --reporter=dot --maxWorkers=1`

Expected: zero failures.

- [ ] **Step 4: Inspect the rendered Planning views**

Use the existing local web app and verify at desktop and narrow widths: the panel uses Inter and existing card/grid classes; there is one primary lecture; every causal node is keyboard-focusable and linked; a null lecture leaves no empty shell; Mois and Semaine retain the same panel language.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; unrelated pre-existing changes remain untouched.
