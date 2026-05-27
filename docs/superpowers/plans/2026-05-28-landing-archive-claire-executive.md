# Landing Archive Claire Executive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the public MemorIA landing page into the validated "Archive claire executive" narrative and visual direction.

**Architecture:** Keep the route and authentication boundary unchanged. Replace the JSX inside `app/LandingPage.tsx` with a single server-rendered React component that uses local arrays for repeated landing sections. Add a focused rendering test that verifies the new executive narrative, CTAs, and key operational examples.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4 utility classes, lucide-react icons, Vitest, Testing Library.

---

## File Structure

- Modify: `app/LandingPage.tsx`
  - Owns the public landing page content, local section data, visual composition, and CTAs.
  - Must keep the mailto CTA and `/login` link.
  - Must not touch auth, dashboard layout, global theme variables, or route behavior.

- Create: `tests/components/landing-page.test.tsx`
  - Renders `LandingPage` directly.
  - Verifies the new hero promise, the executive passation brief, the narrative sections, and both CTAs.

## Task 1: Lock the New Landing Contract With a Failing Test

**Files:**
- Create: `tests/components/landing-page.test.tsx`

- [ ] **Step 1: Create the rendering test**

Add this file:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import LandingPage from '@/app/LandingPage'

describe('LandingPage', () => {
  it('renders the archive claire executive landing narrative', () => {
    render(<LandingPage />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /La memoire des lieux ne doit plus partir avec les personnes/i,
      }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Medipole - Blocs operatoires/i)).toBeInTheDocument()
    expect(screen.getByText(/Releve prevue dans 18 jours/i)).toBeInTheDocument()
    expect(screen.getByText(/Memoire prete a transmettre/i)).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { level: 2, name: /Quand le savoir part/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que MemorIA garde/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que MemorIA fait remonter/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: /Ce que la direction gagne/i }),
    ).toBeInTheDocument()

    expect(screen.getByText(/Dumbea Mall - Hall principal/i)).toBeInTheDocument()
    expect(screen.getByText(/Appel d'offres - marche de services multi-sites/i)).toBeInTheDocument()

    expect(
      screen.getAllByRole('link', { name: /Demander une demo/i })[0],
    ).toHaveAttribute(
      'href',
      'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA',
    )
    expect(screen.getAllByRole('link', { name: /Acceder a l'app/i })[0]).toHaveAttribute(
      'href',
      '/login',
    )
  })
})
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
npm run test -- tests/components/landing-page.test.tsx
```

Expected: FAIL because the current landing still uses the old hero copy and section structure.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add tests/components/landing-page.test.tsx
git commit -m "test: cover landing executive narrative"
```

## Task 2: Replace the Landing With the Archive Claire Executive Design

**Files:**
- Modify: `app/LandingPage.tsx`

- [ ] **Step 1: Replace imports**

Use these imports at the top of `app/LandingPage.tsx`:

```tsx
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  BriefcaseBusiness,
  Building2,
  Camera,
  CheckCircle2,
  FileArchive,
  FileText,
  KeyRound,
  Layers3,
  MapPinned,
  ShieldCheck,
} from 'lucide-react'
```

- [ ] **Step 2: Add local section data above the component**

Add these constants above `export default function LandingPage()`:

```tsx
const demoHref = 'mailto:trouillatv@gmail.com?subject=Demande%20de%20d%C3%A9mo%20MemorIA'

const memoryItems = [
  {
    label: 'Acces',
    text: 'Badges, codes, points de contact et contraintes d entree.',
    icon: KeyRound,
  },
  {
    label: 'A savoir',
    text: 'Consignes terrain, horaires sensibles, zones a traiter avec attention.',
    icon: FileText,
  },
  {
    label: 'Anomalies',
    text: 'Signalements, recurrence, contexte et etat de traitement.',
    icon: AlertTriangle,
  },
  {
    label: 'Preuves',
    text: 'Photos, passages documentes, dossiers exportables et traces utiles.',
    icon: Camera,
  },
  {
    label: 'Passations',
    text: 'Ce qu une equipe doit savoir avant de reprendre un site.',
    icon: ArrowRightLeft,
  },
  {
    label: 'References AO',
    text: 'Experiences comparables, interventions datees et preuves mobilisables.',
    icon: FileArchive,
  },
]

const surfacedSignals = [
  {
    icon: AlertTriangle,
    tone: 'amber',
    title: 'Dumbea Mall - Hall principal',
    text: 'Robinet signale en octobre, fuite notee en janvier, moisissure photographiee en mars. Trois signalements distincts deviennent un seul probleme relie.',
    signal: 'Anomalie recurrente detectee',
  },
  {
    icon: ArrowRightLeft,
    tone: 'slate',
    title: 'Equipe Noumea Centre - releve a preparer',
    text: 'Un contrat se termine dans 18 jours. La memoire de 4 sites, dont le Medipole, repose encore sur cette equipe.',
    signal: 'Brief de passation pret',
  },
  {
    icon: Layers3,
    tone: 'blue',
    title: "Appel d'offres - marche de services multi-sites",
    text: 'Le critere tracabilite des passages est exige. MemorIA retrouve des interventions documentees sur des sites comparables.',
    signal: 'References terrain disponibles',
  },
]
```

- [ ] **Step 3: Replace the component JSX**

Replace the current `return (...)` body with a full-page layout that:

- Uses root classes:

```tsx
<div className="force-light-theme min-h-screen bg-[#eef1f3] text-[#26313b]">
```

- Keeps the sticky header with the logo, but updates its classes to:

```tsx
<header className="sticky top-0 z-50 border-b border-slate-200/80 bg-[#f8fafb]/90 backdrop-blur-xl">
```

- Hero must include:
  - label: `Memoire operationnelle - Nouvelle-Caledonie`
  - H1: `La memoire des lieux ne doit plus partir avec les personnes.`
  - body copy from the spec
  - primary link text `Demander une demo`
  - secondary link text `Acceder a l'app`
  - right-side executive brief containing `Medipole - Blocs operatoires`, `Releve prevue dans 18 jours`, and `Memoire prete a transmettre`

- Then render four sections in this order:
  - `Quand le savoir part`
  - `Ce que MemorIA garde`
  - `Ce que MemorIA fait remonter`
  - `Ce que la direction gagne`

- Use responsive grids:

```tsx
className="grid gap-5 md:grid-cols-3"
className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
```

- Use mostly square or small-radius surfaces:

```tsx
rounded-lg
rounded-xl
border border-slate-200
bg-white/80
```

- Do not reintroduce the old full-width `bg-brand-600` final CTA.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run test -- tests/components/landing-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the landing refactor**

Run:

```bash
git add app/LandingPage.tsx
git commit -m "feat: redesign landing archive claire executive"
```

## Task 3: Verify Quality Gates

**Files:**
- No code changes expected unless a gate fails.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the landing test again**

Run:

```bash
npm run test -- tests/components/landing-page.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Fix only direct failures**

If lint or typecheck fails, only edit `app/LandingPage.tsx` or `tests/components/landing-page.test.tsx` for issues caused by this change. Do not refactor unrelated files.

- [ ] **Step 5: Commit verification fixes if needed**

If Step 4 changed files, run:

```bash
git add app/LandingPage.tsx tests/components/landing-page.test.tsx
git commit -m "fix: satisfy landing quality gates"
```

## Self-Review

- Spec coverage: The plan covers the Archive claire executive palette, executive passation hero, four-part narrative, operational examples, existing CTAs, and final CTA simplification.
- Placeholder scan: The plan contains concrete file paths, code, commands, and expected outcomes.
- Type consistency: Icon components are imported from `lucide-react` and referenced consistently as component values in the local arrays.
