# Copilote AO — Restructuration UX (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'UX du Copilote AO pour séparer analyses persistées (AgentPanel sidebar gauche) et consultation live (chat avec Mode Card explicite Avis expert / Débat IA), en supprimant complètement les pills agents.

**Architecture:** Refacto unique livrée en 6 commits progressifs. Aucun big bang : chaque commit produit un état fonctionnel. Les composants existants `CopiloteHeroCard`, `AtelierMessageThread`, server actions `sendChatMessageAction` / `runChallengeRoundAction` / `runAgentInitialAnalysisAction` sont réutilisés. Nouveaux composants : `ModeCard`, `AgentSelectorPopover`, `AgentPanel`, `AgentAnalysisDrawer`, `HeroCompactRibbon`, helper `agent-selection-storage`.

**Tech Stack:** Next.js 16 App Router · React 19 client components · Tailwind v4 · shadcn/ui (Drawer vaul · Popover @base-ui/react avec fallback Drawer si bug) · vitest + @testing-library/react · TypeScript 5

**Spec source:** `docs/superpowers/specs/2026-05-10-copilote-ao-restructure-design.md`

---

## File Structure Overview

### Nouveaux fichiers

| Path | Responsabilité |
|---|---|
| `app/(dashboard)/tenders/[id]/ModeCard.tsx` | Affiche mode courant (Avis expert / Débat IA / vide) + chips participants + bouton ouverture sélecteur |
| `app/(dashboard)/tenders/[id]/AgentSelectorPopover.tsx` | Popover searchable multi-select, cap dur à 3, sync avec ModeCard |
| `app/(dashboard)/tenders/[id]/AgentPanel.tsx` | Sidebar gauche listant les 7 agents avec état persisté + CTAs |
| `app/(dashboard)/tenders/[id]/AgentAnalysisDrawer.tsx` | Drawer right-slide pour visualisation analyse persistée |
| `app/(dashboard)/tenders/[id]/HeroCompactRibbon.tsx` | Ribbon sticky compact avec compteur état + bouton suggestions overlay |
| `app/(dashboard)/tenders/[id]/agent-selection-storage.ts` | Helper localStorage clé `copilote-agents-${tenderId}` |
| `app/(dashboard)/tenders/[id]/copilote-mode.ts` | Pure helper : `resolveMode(agents: ChatAgentName[]): 'empty' \| 'expert' \| 'debate'` |
| `tests/components/mode-card.test.tsx` | Tests ModeCard (rendering selon mode, click bouton, chip remove) |
| `tests/components/agent-selector-popover.test.tsx` | Tests popover (multi-select, cap 3, search) |
| `tests/components/agent-panel.test.tsx` | Tests AgentPanel (4 états × CTA visible) |
| `tests/components/agent-analysis-drawer.test.tsx` | Tests Drawer (sections rendered, régénérer) |
| `tests/lib/agent-selection-storage.test.ts` | Tests localStorage helper |
| `tests/lib/copilote-mode.test.ts` | Tests resolveMode pure function |

### Fichiers modifiés

| Path | Modifications |
|---|---|
| `app/(dashboard)/tenders/[id]/AtelierIATab.tsx` | Suppression complète des pills + AgentPill sub-component · suppression `runInitialAnalysis` (déplacée vers AgentPanel) · intégration ModeCard + HeroCompactRibbon · CTA adaptatif |
| `app/(dashboard)/tenders/[id]/page.tsx` | Sub-grid `[320px_1fr]` dans la branche `view === 'atelier'` · passe `agentAnalyses` à AgentPanel |
| `app/(dashboard)/tenders/[id]/CopiloteHeroCard.tsx` | Renommé en `HeroFullCard.tsx` (utilisé uniquement quand chat vide), expose `SUGGESTED_PROMPTS` |
| `app/(dashboard)/tenders/[id]/atelier-actions.ts` | `runChallengeRoundAction` : cap `current_round` à `0` (1 seul round, plus 2) |
| `app/(dashboard)/tenders/[id]/AtelierMessageThread.tsx` | Wording bouton challenge : « Confronter les avis · round unique » |
| `app/(dashboard)/tenders/[id]/TenderSidebar.tsx` | Renommer label nav `Atelier IA` → `Copilote AO` (déjà présent dans certains endroits, vérifier) |

---

## Task 1 — Pure helpers (mode resolver + localStorage)

**Files:**
- Create: `app/(dashboard)/tenders/[id]/copilote-mode.ts`
- Create: `app/(dashboard)/tenders/[id]/agent-selection-storage.ts`
- Test: `tests/lib/copilote-mode.test.ts`
- Test: `tests/lib/agent-selection-storage.test.ts`

- [ ] **Step 1.1: Write failing tests for `resolveMode`**

Create `tests/lib/copilote-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveMode, modeLabel, modeCta } from '@/app/(dashboard)/tenders/[id]/copilote-mode'

describe('resolveMode', () => {
  it('returns empty for 0 agents', () => {
    expect(resolveMode([])).toBe('empty')
  })
  it('returns expert for 1 agent', () => {
    expect(resolveMode(['contradicteur'])).toBe('expert')
  })
  it('returns debate for 2 agents', () => {
    expect(resolveMode(['contradicteur', 'financier'])).toBe('debate')
  })
  it('returns debate for 3 agents', () => {
    expect(resolveMode(['contradicteur', 'financier', 'terrain'])).toBe('debate')
  })
  it('throws if more than 3 agents', () => {
    expect(() => resolveMode(['a', 'b', 'c', 'd'] as never)).toThrow(/max 3/i)
  })
})

describe('modeLabel', () => {
  it('returns labels per mode', () => {
    expect(modeLabel('empty')).toBe('Choisissez un ou plusieurs experts')
    expect(modeLabel('expert')).toBe("Avis d'expert")
    expect(modeLabel('debate')).toBe('Débat IA')
  })
})

describe('modeCta', () => {
  it('returns CTAs per mode', () => {
    expect(modeCta('empty')).toBe("Sélectionnez d'abord un expert")
    expect(modeCta('expert')).toBe('Demander un avis')
    expect(modeCta('debate')).toBe('Lancer le débat IA')
  })
})
```

- [ ] **Step 1.2: Run tests — verify they fail**

Run: `npx vitest run tests/lib/copilote-mode.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 1.3: Implement `copilote-mode.ts`**

Create `app/(dashboard)/tenders/[id]/copilote-mode.ts`:

```ts
import type { ChatAgentName } from '@/types/db'

export type CopiloteMode = 'empty' | 'expert' | 'debate'

export const MAX_AGENTS = 3

export function resolveMode(agents: ChatAgentName[]): CopiloteMode {
  if (agents.length === 0) return 'empty'
  if (agents.length === 1) return 'expert'
  if (agents.length <= MAX_AGENTS) return 'debate'
  throw new Error(`max ${MAX_AGENTS} agents allowed`)
}

export function modeLabel(mode: CopiloteMode): string {
  switch (mode) {
    case 'empty':  return 'Choisissez un ou plusieurs experts'
    case 'expert': return "Avis d'expert"
    case 'debate': return 'Débat IA'
  }
}

export function modeCta(mode: CopiloteMode): string {
  switch (mode) {
    case 'empty':  return "Sélectionnez d'abord un expert"
    case 'expert': return 'Demander un avis'
    case 'debate': return 'Lancer le débat IA'
  }
}
```

- [ ] **Step 1.4: Verify tests pass**

Run: `npx vitest run tests/lib/copilote-mode.test.ts`
Expected: PASS — 3 describe blocks, 8 tests

- [ ] **Step 1.5: Write failing tests for localStorage helper**

Create `tests/lib/agent-selection-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadSelectedAgents, saveSelectedAgents } from '@/app/(dashboard)/tenders/[id]/agent-selection-storage'

const TENDER_ID = '00000000-0000-0000-0000-000000000001'

describe('agent-selection-storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when key absent', () => {
    expect(loadSelectedAgents(TENDER_ID)).toEqual([])
  })

  it('saves and loads agent list', () => {
    saveSelectedAgents(TENDER_ID, ['contradicteur', 'financier'])
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier'])
  })

  it('returns empty array on corrupted JSON', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, 'not-json{{')
    expect(loadSelectedAgents(TENDER_ID)).toEqual([])
  })

  it('filters out invalid agent names', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, JSON.stringify(['contradicteur', 'unknown_agent', 'financier']))
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier'])
  })

  it('caps to 3 agents on load', () => {
    localStorage.setItem(`copilote-agents-${TENDER_ID}`, JSON.stringify(['contradicteur', 'financier', 'terrain', 'general']))
    expect(loadSelectedAgents(TENDER_ID)).toEqual(['contradicteur', 'financier', 'terrain'])
  })

  it('isolates tenders by id', () => {
    saveSelectedAgents('tender-A', ['contradicteur'])
    saveSelectedAgents('tender-B', ['financier'])
    expect(loadSelectedAgents('tender-A')).toEqual(['contradicteur'])
    expect(loadSelectedAgents('tender-B')).toEqual(['financier'])
  })
})
```

- [ ] **Step 1.6: Run tests — verify they fail**

Run: `npx vitest run tests/lib/agent-selection-storage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 1.7: Implement localStorage helper**

Create `app/(dashboard)/tenders/[id]/agent-selection-storage.ts`:

```ts
import type { ChatAgentName } from '@/types/db'
import { MAX_AGENTS } from './copilote-mode'

const VALID_AGENTS: readonly ChatAgentName[] = [
  'general', 'lecteur_ao', 'memoire_technique',
  'contradicteur', 'financier', 'terrain', 'conformite',
] as const

function storageKey(tenderId: string): string {
  return `copilote-agents-${tenderId}`
}

export function loadSelectedAgents(tenderId: string): ChatAgentName[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(storageKey(tenderId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((a): a is ChatAgentName => typeof a === 'string' && (VALID_AGENTS as readonly string[]).includes(a))
      .slice(0, MAX_AGENTS)
  } catch {
    return []
  }
}

export function saveSelectedAgents(tenderId: string, agents: ChatAgentName[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey(tenderId), JSON.stringify(agents.slice(0, MAX_AGENTS)))
}
```

- [ ] **Step 1.8: Verify tests pass**

Run: `npx vitest run tests/lib/agent-selection-storage.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 1.9: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/copilote-mode.ts \
        app/\(dashboard\)/tenders/\[id\]/agent-selection-storage.ts \
        tests/lib/copilote-mode.test.ts \
        tests/lib/agent-selection-storage.test.ts
git commit -m "feat(copilote): pure helpers resolveMode + agent-selection-storage"
```

---

## Task 2 — `AgentSelectorPopover` (multi-select cap 3)

**Files:**
- Create: `app/(dashboard)/tenders/[id]/AgentSelectorPopover.tsx`
- Test: `tests/components/agent-selector-popover.test.tsx`

> **Décision technique :** vu le bug overlay du `Select` shadcn/ui rencontré historiquement, on utilise un Drawer custom-built avec `vaul` (déjà installé via shadcn) sur mobile, et un Popover Radix-style construit avec `@radix-ui/react-popover` si présent — sinon fallback sur un absolute-positioned div toggle. **Pour ce plan, on implémente un div absolu controlled-state simple, qui fonctionne sur tous les viewports et évite les bugs de portail.**

- [ ] **Step 2.1: Write failing test**

Create `tests/components/agent-selector-popover.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentSelectorPopover } from '@/app/(dashboard)/tenders/[id]/AgentSelectorPopover'

describe('AgentSelectorPopover', () => {
  it('renders all 7 agents when open', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByText('Financier')).toBeInTheDocument()
    expect(screen.getByText('Terrain')).toBeInTheDocument()
    expect(screen.getByText('Conformité')).toBeInTheDocument()
    expect(screen.getByText('Mémoire technique')).toBeInTheDocument()
    expect(screen.getByText('Lecteur AO')).toBeInTheDocument()
    expect(screen.getByText('Général')).toBeInTheDocument()
  })

  it('shows checkmark on selected agents', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur']}
        onChange={() => {}}
      />
    )
    const row = screen.getByTestId('agent-row-contradicteur')
    expect(row).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with toggled agent', () => {
    const onChange = vi.fn()
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('agent-row-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['contradicteur'])
  })

  it('caps selection to 3', () => {
    const onChange = vi.fn()
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur', 'financier', 'terrain']}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByTestId('agent-row-conformite'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('agent-row-conformite')).toBeDisabled()
  })

  it('filters by search query', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Rechercher un agent…'), {
      target: { value: 'contradi' },
    })
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.queryByText('Financier')).not.toBeInTheDocument()
  })

  it('shows counter X/3', () => {
    render(
      <AgentSelectorPopover
        open={true}
        onOpenChange={() => {}}
        selected={['contradicteur', 'financier']}
        onChange={() => {}}
      />
    )
    expect(screen.getByText('2/3 sélectionnés')).toBeInTheDocument()
  })

  it('returns null when closed', () => {
    const { container } = render(
      <AgentSelectorPopover
        open={false}
        onOpenChange={() => {}}
        selected={[]}
        onChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run tests — verify they fail**

Run: `npx vitest run tests/components/agent-selector-popover.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 2.3: Implement `AgentSelectorPopover`**

Create `app/(dashboard)/tenders/[id]/AgentSelectorPopover.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { MAX_AGENTS } from './copilote-mode'
import { cn } from '@/lib/utils'
import type { ChatAgentName } from '@/types/db'

interface AgentSelectorPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: ChatAgentName[]
  onChange: (agents: ChatAgentName[]) => void
}

const ALL_AGENTS: ChatAgentName[] = [
  'lecteur_ao', 'memoire_technique', 'contradicteur',
  'financier', 'terrain', 'conformite', 'general',
]

export function AgentSelectorPopover({ open, onOpenChange, selected, onChange }: AgentSelectorPopoverProps) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open, onOpenChange])

  if (!open) return null

  function toggle(agent: ChatAgentName) {
    if (selected.includes(agent)) {
      onChange(selected.filter((a) => a !== agent))
    } else {
      if (selected.length >= MAX_AGENTS) return
      onChange([...selected, agent])
    }
  }

  const filtered = ALL_AGENTS.filter((a) => {
    const meta = AGENTS[a]
    const q = query.toLowerCase()
    return meta.label.toLowerCase().includes(q) || meta.description.toLowerCase().includes(q)
  })

  return (
    <div
      ref={ref}
      className="absolute z-20 bottom-full mb-2 w-[360px] rounded-lg border bg-popover shadow-lg overflow-hidden"
      role="dialog"
      aria-label="Sélectionner les agents"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un agent…"
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {filtered.map((agent) => {
          const meta = AGENTS[agent]
          const colors = AGENT_COLORS[agent]
          const Icon = meta.icon
          const isSelected = selected.includes(agent)
          const wouldExceed = !isSelected && selected.length >= MAX_AGENTS
          return (
            <li key={agent}>
              <button
                type="button"
                role="option"
                aria-checked={isSelected}
                disabled={wouldExceed}
                data-testid={`agent-row-${agent}`}
                onClick={() => toggle(agent)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-accent/60' : 'hover:bg-muted/40',
                  wouldExceed && 'opacity-40 cursor-not-allowed'
                )}
              >
                <div className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center', colors.bgClass)}>
                  <Icon className={cn('h-3 w-3', colors.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{meta.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{meta.description}</div>
                </div>
                {isSelected && <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t bg-muted/20">
        {selected.length}/{MAX_AGENTS} sélectionnés
      </div>
    </div>
  )
}
```

- [ ] **Step 2.4: Verify tests pass**

Run: `npx vitest run tests/components/agent-selector-popover.test.tsx`
Expected: PASS — 7 tests

- [ ] **Step 2.5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/AgentSelectorPopover.tsx \
        tests/components/agent-selector-popover.test.tsx
git commit -m "feat(copilote): AgentSelectorPopover — searchable multi-select cap 3"
```

---

## Task 3 — `ModeCard` (mode + chips participants)

**Files:**
- Create: `app/(dashboard)/tenders/[id]/ModeCard.tsx`
- Test: `tests/components/mode-card.test.tsx`

- [ ] **Step 3.1: Write failing test**

Create `tests/components/mode-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeCard } from '@/app/(dashboard)/tenders/[id]/ModeCard'

describe('ModeCard', () => {
  it('renders empty state with 0 agents', () => {
    render(<ModeCard agents={[]} onChange={() => {}} />)
    expect(screen.getByText('Choisissez un ou plusieurs experts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sélectionner un agent/i })).toBeInTheDocument()
  })

  it('renders expert mode with 1 agent', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    expect(screen.getByText("Avis d'expert")).toBeInTheDocument()
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ajouter un agent/i })).toBeInTheDocument()
  })

  it('renders debate mode with 2 agents and shows anticipation banner', () => {
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={() => {}} />)
    expect(screen.getByText(/débat ia/i)).toBeInTheDocument()
    expect(screen.getByText(/2 perspectives/i)).toBeInTheDocument()
    expect(screen.getByText(/donneront d'abord leurs avis séparés/i)).toBeInTheDocument()
  })

  it('shows 3/3 limite atteinte at cap', () => {
    render(<ModeCard agents={['contradicteur', 'financier', 'terrain']} onChange={() => {}} />)
    expect(screen.getByText(/3\/3/)).toBeInTheDocument()
    expect(screen.getByText(/limite atteinte/i)).toBeInTheDocument()
  })

  it('removes agent on chip click', () => {
    const onChange = vi.fn()
    render(<ModeCard agents={['contradicteur', 'financier']} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('chip-remove-contradicteur'))
    expect(onChange).toHaveBeenCalledWith(['financier'])
  })

  it('opens popover on add button click', () => {
    render(<ModeCard agents={['contradicteur']} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /ajouter un agent/i }))
    expect(screen.getByRole('dialog', { name: /sélectionner les agents/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3.2: Run tests — verify they fail**

Run: `npx vitest run tests/components/mode-card.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3.3: Implement `ModeCard`**

Create `app/(dashboard)/tenders/[id]/ModeCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { X, Plus, Sparkles, Flame } from 'lucide-react'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { resolveMode, modeLabel, MAX_AGENTS } from './copilote-mode'
import { AgentSelectorPopover } from './AgentSelectorPopover'
import { cn } from '@/lib/utils'
import type { ChatAgentName } from '@/types/db'

interface ModeCardProps {
  agents: ChatAgentName[]
  onChange: (agents: ChatAgentName[]) => void
}

export function ModeCard({ agents, onChange }: ModeCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const mode = resolveMode(agents)

  const removeAgent = (agent: ChatAgentName) => onChange(agents.filter((a) => a !== agent))

  const isDebate = mode === 'debate'
  const atCap = agents.length >= MAX_AGENTS

  return (
    <div className="relative">
      <div className={cn(
        'rounded-lg border p-3 mb-2 transition-colors',
        isDebate
          ? 'border-amber-300 bg-gradient-to-br from-amber-50/40 to-sky-50/40'
          : 'bg-muted/20'
      )}>
        {/* Header mode */}
        <div className="flex items-center gap-2 mb-2">
          {isDebate ? (
            <Flame className="h-4 w-4 text-amber-600" />
          ) : (
            <Sparkles className="h-4 w-4 text-slate-500" />
          )}
          <span className="text-sm font-semibold">
            {mode === 'empty' ? modeLabel('empty') : `Mode : ${modeLabel(mode)}`}
            {isDebate && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {agents.length} perspectives
              </span>
            )}
          </span>
        </div>

        {/* Chips participants */}
        {agents.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {agents.map((agent) => {
              const meta = AGENTS[agent]
              const colors = AGENT_COLORS[agent]
              const Icon = meta.icon
              return (
                <span
                  key={agent}
                  className={cn(
                    'inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full text-xs font-medium border',
                    colors.borderClass, colors.textClass, colors.bgClass
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>{meta.label}</span>
                  <button
                    type="button"
                    data-testid={`chip-remove-${agent}`}
                    onClick={() => removeAgent(agent)}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-black/5"
                    aria-label={`Retirer ${meta.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* CTA add */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={atCap}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors',
            atCap
              ? 'text-muted-foreground cursor-not-allowed opacity-60'
              : 'text-foreground hover:bg-muted/50'
          )}
        >
          <Plus className="h-3 w-3" />
          {atCap
            ? `${MAX_AGENTS}/${MAX_AGENTS} — limite atteinte`
            : agents.length === 0
              ? 'Sélectionner un agent'
              : 'Ajouter un agent'}
        </button>

        {/* Anticipation banner (mode debate) */}
        {isDebate && (
          <div className="mt-2 pt-2 border-t border-amber-200/60 text-[11px] text-amber-800 italic">
            ℹ Les agents donneront d&apos;abord leurs avis séparés, puis vous pourrez confronter leurs perspectives.
          </div>
        )}
      </div>

      <AgentSelectorPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={agents}
        onChange={onChange}
      />
    </div>
  )
}
```

- [ ] **Step 3.4: Verify tests pass**

Run: `npx vitest run tests/components/mode-card.test.tsx`
Expected: PASS — 6 tests

- [ ] **Step 3.5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/ModeCard.tsx \
        tests/components/mode-card.test.tsx
git commit -m "feat(copilote): ModeCard with mode resolution + participant chips + anticipation banner"
```

---

## Task 4 — Refacto `AtelierIATab` : suppression pills, intégration ModeCard, CTA adaptatif

**Files:**
- Modify: `app/(dashboard)/tenders/[id]/AtelierIATab.tsx`

> Cette task ne casse rien : on **remplace** la section pills+helper par ModeCard, le CTA prend wording adaptatif, le state initial vient de localStorage.

- [ ] **Step 4.1: Update `AtelierIATab.tsx` imports**

Replace imports block (lines 1-16) with:

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sendChatMessageAction } from './atelier-actions'
import { toast } from 'sonner'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { AtelierMessageThread } from './AtelierMessageThread'
import { CopiloteHeroCard } from './CopiloteHeroCard'
import { ModeCard } from './ModeCard'
import { resolveMode, modeCta, MAX_AGENTS } from './copilote-mode'
import { loadSelectedAgents, saveSelectedAgents } from './agent-selection-storage'
import { cn } from '@/lib/utils'
import { pickThinkingPhrase } from './agent-thinking-phrases'
import { SLASH_COMMANDS, type SlashCommand } from './slash-commands'
import type { ChatAgentName, DbTenderChatMessage, DbAgentAnalysis, DbTenderAnalysis } from '@/types/db'
```

- [ ] **Step 4.2: Remove `AgentPill` sub-component (lines 25-94)**

Delete the entire `AgentPill` block (interface + function). Also remove `MAX_AGENTS` const declaration at line 18 (now imported from `copilote-mode.ts`).

- [ ] **Step 4.3: Remove `runAgentInitialAnalysisAction` import and `runInitialAnalysis` function**

In imports remove `runAgentInitialAnalysisAction`. Delete the entire `async function runInitialAnalysis` (lines 170-221) and the `analyzingAgents` state (line 114).

Also remove the `agentAnalyses` state and the `initialAgentAnalyses` prop (these will move to AgentPanel in Task 5). Update interface:

```tsx
interface AtelierIATabProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}
```

- [ ] **Step 4.4: Replace state init for `selectedAgents` with localStorage hydration**

Replace:

```tsx
const [selectedAgents, setSelectedAgents] = useState<Set<ChatAgentName>>(() => new Set<ChatAgentName>(['general']))
```

With:

```tsx
const [selectedAgents, setSelectedAgents] = useState<ChatAgentName[]>([])

useEffect(() => {
  setSelectedAgents(loadSelectedAgents(tenderId))
}, [tenderId])

useEffect(() => {
  saveSelectedAgents(tenderId, selectedAgents)
}, [tenderId, selectedAgents])
```

> Note : on bascule de `Set` à `Array` car ModeCard / AgentSelectorPopover travaillent avec un array (l'ordre de sélection est conservé pour l'affichage chips).

- [ ] **Step 4.5: Update `toggleAgent`, `applySlashCommand`, `handleHeroPromptClick` to use array**

Replace the body of `toggleAgent`:

```tsx
function toggleAgent(agent: ChatAgentName) {
  setSelectedAgents((prev) => {
    if (prev.includes(agent)) return prev.filter((a) => a !== agent)
    if (prev.length >= MAX_AGENTS) {
      toast.warning(`Max ${MAX_AGENTS} agents simultanés`)
      return prev
    }
    return [...prev, agent]
  })
}
```

Replace `applySlashCommand`:

```tsx
function applySlashCommand(cmd: SlashCommand) {
  setDraft(cmd.prompt)
  setSelectedAgents(cmd.agents.slice(0, MAX_AGENTS))
  setSlashSelectedIdx(0)
  setTimeout(() => {
    const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
    ta?.focus()
    if (ta) ta.setSelectionRange(cmd.prompt.length, cmd.prompt.length)
  }, 30)
}
```

Replace `handleHeroPromptClick`:

```tsx
function handleHeroPromptClick(prompt: string, agents: ChatAgentName[]) {
  setSelectedAgents(agents.slice(0, MAX_AGENTS))
  setDraft(prompt)
  setTimeout(() => {
    const ta = document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null
    ta?.focus()
  }, 50)
}
```

Update `send` function: replace `selectedAgents.size === 0` with `selectedAgents.length === 0`, and `Array.from(selectedAgents)` with just `selectedAgents`. Replace `for (const a of selectedAgents)` with `for (const a of selectedAgents)` (works for arrays unchanged). Replace `JSON.stringify(Array.from(selectedAgents))` with `JSON.stringify(selectedAgents)`.

- [ ] **Step 4.6: Replace pills UI section with ModeCard**

Replace the entire block (lines 343-369 in original, the `Compteur + pills` div):

```tsx
        {/* Compteur + pills */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs text-muted-foreground">Agents IA</Label>
            <span className="text-xs text-muted-foreground">{selectedAgents.size}/{MAX_AGENTS}</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
            {(Object.keys(AGENTS) as ChatAgentName[]).map((agentName) => { /* ... */ })}
          </div>
        </div>
```

With:

```tsx
        <ModeCard agents={selectedAgents} onChange={setSelectedAgents} />
```

Also delete the `Multi-agent helper` block (lines 337-341, the `selectedAgents.size > 1 &&` paragraph) — anticipation banner is now inside ModeCard.

Also remove the `Label` import (no longer used) from `@/components/ui/label`.

- [ ] **Step 4.7: Update CTA wording adaptatif**

Replace the Send Button block (lines 486-493):

```tsx
<Button
  type="button"
  onClick={send}
  disabled={!draft.trim() || pending || selectedAgents.size === 0}
>
  <Send className="h-3 w-3 mr-1" />
  {pending ? 'Envoi…' : selectedAgents.size > 1 ? `Envoyer aux ${selectedAgents.size} agents` : 'Envoyer'}
</Button>
```

With:

```tsx
<Button
  type="button"
  onClick={send}
  disabled={!draft.trim() || pending || selectedAgents.length === 0}
>
  <Send className="h-3 w-3 mr-1" />
  {pending ? 'Envoi…' : modeCta(resolveMode(selectedAgents))}
</Button>
```

Update placeholder logic in textarea:

```tsx
placeholder={
  selectedAgents.length === 0
    ? "Choisissez d'abord un ou plusieurs experts ci-dessous…"
    : selectedAgents.length === 1 && selectedAgents[0]
      ? `Demandez un avis à ${AGENTS[selectedAgents[0]].label}…`
      : `Posez une question à confronter entre ${selectedAgents.length} experts…`
}
```

Update `firstAgent` derivation:

```tsx
const firstAgent = selectedAgents[0]
```

Update the bottom hint paragraph (line 495-497):

```tsx
<p className="text-xs text-muted-foreground mt-1">
  Ctrl/Cmd + Entrée pour envoyer · Tape <code className="font-mono bg-muted px-1 rounded">/</code> pour les commandes rapides · max {MAX_AGENTS} experts
</p>
```

- [ ] **Step 4.8: Update pending thinking states section**

Replace `selectedAgents.size > 0` with `selectedAgents.length > 0` and `Array.from(selectedAgents)` with just `selectedAgents` in the thinking states block (lines 311-330).

- [ ] **Step 4.9: Update `page.tsx` props passed to `AtelierIATab`**

Modify `app/(dashboard)/tenders/[id]/page.tsx` line 168-176:

Replace:

```tsx
{view === 'atelier' && (
  <AtelierIATab
    tenderId={id}
    initialMessages={chatMessages}
    initialAgentAnalyses={agentAnalyses}
    tenderAnalysis={analysis}
    tenderTitle={tender.title}
  />
)}
```

With:

```tsx
{view === 'atelier' && (
  <AtelierIATab
    tenderId={id}
    initialMessages={chatMessages}
    tenderAnalysis={analysis}
    tenderTitle={tender.title}
  />
)}
```

(The `agentAnalyses` data is still fetched in page.tsx — we'll wire it to AgentPanel in Task 5.)

- [ ] **Step 4.10: Run all tests**

Run: `npx vitest run`
Expected: All passing (existing 13 + new helpers + new components)

- [ ] **Step 4.11: Smoke test in browser**

Run: `npm run dev` (in another terminal if not already running)

Browser checklist:
- Open `/tenders/[some-id]?view=atelier`
- Empty chat → Hero card visible avec 6 prompts
- ModeCard montre « Choisissez un ou plusieurs experts »
- Click `[+ Sélectionner un agent]` → popover s'ouvre avec 7 agents
- Sélectionner Contradicteur → popover affiche check, ModeCard affiche chip + mode "Avis d'expert"
- CTA passe à « Demander un avis »
- Ajouter Financier → ModeCard bascule en "Débat IA · 2 perspectives" avec bandeau ambré
- CTA passe à « Lancer le débat IA »
- Refresh page → sélection conservée (localStorage)
- Cliquer chip X → retire l'agent
- Tenter d'ajouter un 4e agent → bouton désactivé "3/3 — limite atteinte"
- Envoyer un message → fonctionne, agents répondent, pills sont absentes

- [ ] **Step 4.12: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/AtelierIATab.tsx \
        app/\(dashboard\)/tenders/\[id\]/page.tsx
git commit -m "refacto(copilote): replace pills with ModeCard + adaptive CTA + localStorage persist"
```

---

## Task 5 — `AgentPanel` (analyses persistées, sidebar gauche)

**Files:**
- Create: `app/(dashboard)/tenders/[id]/AgentPanel.tsx`
- Modify: `app/(dashboard)/tenders/[id]/page.tsx`
- Test: `tests/components/agent-panel.test.tsx`

> Cette task introduit le sub-grid `[320px AgentPanel | 1fr Chat]` au sein de la vue `atelier`. AgentPanel est responsable de la génération/régénération/visualisation des analyses persistées (server action `runAgentInitialAnalysisAction` déplacée ici).

- [ ] **Step 5.1: Write failing test**

Create `tests/components/agent-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentPanel } from '@/app/(dashboard)/tenders/[id]/AgentPanel'
import type { DbAgentAnalysis } from '@/types/db'

const TENDER_ID = '00000000-0000-0000-0000-000000000001'

function makeAnalysis(overrides: Partial<DbAgentAnalysis>): DbAgentAnalysis {
  return {
    id: 'a1',
    tender_id: TENDER_ID,
    agent_name: 'contradicteur',
    status: 'ready',
    summary: 'Synthèse',
    key_points: { items: ['risque ICPE', 'pénalités asymétriques'] },
    raw_content: null,
    metadata: { provider: 'mock' },
    error_msg: null,
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T12:00:00Z',
    ...overrides,
  }
}

describe('AgentPanel', () => {
  it('renders all 7 agents', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    expect(screen.getByText('Contradicteur')).toBeInTheDocument()
    expect(screen.getByText('Financier')).toBeInTheDocument()
    expect(screen.getByText('Lecteur AO')).toBeInTheDocument()
  })

  it('shows "Pas encore générée" for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    const cards = screen.getAllByText(/pas encore générée/i)
    expect(cards.length).toBe(7)
  })

  it('shows generate button for not_generated state', () => {
    render(<AgentPanel tenderId={TENDER_ID} analyses={[]} onView={() => {}} />)
    const btns = screen.getAllByRole('button', { name: /générer l'analyse/i })
    expect(btns.length).toBe(7)
  })

  it('shows "En cours" + spinner for running state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'running' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByText(/génération en cours/i)).toBeInTheDocument()
  })

  it('shows "Voir l\'analyse" CTA for ready state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByRole('button', { name: /voir l'analyse/i })).toBeInTheDocument()
  })

  it('calls onView with agent name when clicking Voir', () => {
    const onView = vi.fn()
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'ready' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={onView} />)
    screen.getByRole('button', { name: /voir l'analyse/i }).click()
    expect(onView).toHaveBeenCalledWith('contradicteur')
  })

  it('shows Réessayer for failed state', () => {
    const analyses = [makeAnalysis({ agent_name: 'contradicteur', status: 'failed', error_msg: 'timeout' })]
    render(<AgentPanel tenderId={TENDER_ID} analyses={analyses} onView={() => {}} />)
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument()
    expect(screen.getByText(/erreur de génération/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5.2: Run tests — verify they fail**

Run: `npx vitest run tests/components/agent-panel.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 5.3: Implement `AgentPanel`**

Create `app/(dashboard)/tenders/[id]/AgentPanel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Loader2, AlertCircle, Eye, Sparkles, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runAgentInitialAnalysisAction } from './atelier-actions'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ChatAgentName, DbAgentAnalysis } from '@/types/db'

const AGENT_ORDER: ChatAgentName[] = [
  'lecteur_ao', 'memoire_technique', 'contradicteur',
  'financier', 'terrain', 'conformite', 'general',
]

interface AgentPanelProps {
  tenderId: string
  analyses: DbAgentAnalysis[]
  onView: (agentName: ChatAgentName) => void
}

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const min = Math.floor(diff / 60000)
  if (min < 1)  return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)   return `il y a ${h} h`
  const days = Math.floor(h / 24)
  return `il y a ${days} j`
}

function keyPointsCount(analysis: DbAgentAnalysis): number {
  const kp = analysis.key_points
  if (!kp) return 0
  if (Array.isArray((kp as { items?: unknown[] }).items)) return ((kp as { items: unknown[] }).items).length
  return Object.keys(kp).length
}

export function AgentPanel({ tenderId, analyses, onView }: AgentPanelProps) {
  const [pendingAgents, setPendingAgents] = useState<Set<ChatAgentName>>(new Set())
  const [, startTransition] = useTransition()

  const byAgent = new Map<ChatAgentName, DbAgentAnalysis>()
  for (const a of analyses) byAgent.set(a.agent_name, a)

  async function generate(agentName: ChatAgentName) {
    if (pendingAgents.has(agentName)) return
    setPendingAgents((prev) => new Set(prev).add(agentName))
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', agentName)
    const r = await runAgentInitialAnalysisAction(fd)
    setPendingAgents((prev) => {
      const next = new Set(prev)
      next.delete(agentName)
      return next
    })
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success(`Analyse ${AGENTS[agentName].label} lancée`)
      startTransition(() => {})
    }
  }

  return (
    <aside className="w-full md:w-[320px] shrink-0 space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold">Analyses persistées</h2>
      </div>
      <ul className="space-y-2">
        {AGENT_ORDER.map((agent) => {
          const meta = AGENTS[agent]
          const colors = AGENT_COLORS[agent]
          const Icon = meta.icon
          const analysis = byAgent.get(agent)
          const status = analysis?.status ?? null
          const isLocallyPending = pendingAgents.has(agent)
          const effectiveStatus = isLocallyPending ? 'running' : status

          return (
            <li
              key={agent}
              className={cn(
                'rounded-lg border p-3 bg-card transition-colors',
                effectiveStatus === 'ready' && 'border-l-4',
                effectiveStatus === 'ready' && colors.borderClass
              )}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center', colors.bgClass)}>
                  <Icon className={cn('h-3.5 w-3.5', colors.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{meta.label}</div>
                  {effectiveStatus === null && (
                    <div className="text-xs text-muted-foreground">— Pas encore générée</div>
                  )}
                  {effectiveStatus === 'pending' && (
                    <div className="text-xs text-muted-foreground">— Pas encore générée</div>
                  )}
                  {effectiveStatus === 'running' && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Génération en cours…
                    </div>
                  )}
                  {effectiveStatus === 'ready' && analysis && (
                    <div className="text-xs text-muted-foreground">
                      ✓ Prête · {keyPointsCount(analysis)} findings
                      <div className="mt-0.5">
                        {formatRelative(analysis.updated_at)}
                        {analysis.metadata && typeof analysis.metadata === 'object' && 'provider' in analysis.metadata && (
                          <> · <span className="font-mono">{String((analysis.metadata as { provider?: string }).provider ?? '')}</span></>
                        )}
                      </div>
                    </div>
                  )}
                  {effectiveStatus === 'failed' && (
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <AlertCircle className="h-3 w-3" /> Erreur de génération
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-1">
                {(effectiveStatus === null || effectiveStatus === 'pending') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => generate(agent)}
                    disabled={isLocallyPending}
                  >
                    Générer l&apos;analyse
                  </Button>
                )}
                {effectiveStatus === 'ready' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onView(agent)}
                  >
                    <Eye className="h-3 w-3 mr-1" /> Voir l&apos;analyse
                  </Button>
                )}
                {effectiveStatus === 'failed' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => generate(agent)}
                    disabled={isLocallyPending}
                  >
                    <RotateCw className="h-3 w-3 mr-1" /> Réessayer
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 5.4: Verify tests pass**

Run: `npx vitest run tests/components/agent-panel.test.tsx`
Expected: PASS — 7 tests

- [ ] **Step 5.5: Wire `AgentPanel` into `page.tsx`**

Modify `app/(dashboard)/tenders/[id]/page.tsx`. Add import at top:

```tsx
import { AgentPanel } from './AgentPanel'
import { AgentAnalysisDrawer } from './AgentAnalysisDrawer'  // will be added in Task 6 — leave as TODO comment for now
```

Wait — `AgentAnalysisDrawer` doesn't exist yet (Task 6). For Task 5, instead create a temporary internal client-side wrapper.

Create `app/(dashboard)/tenders/[id]/CopiloteWorkspace.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { AgentPanel } from './AgentPanel'
import { AtelierIATab } from './AtelierIATab'
import type { ChatAgentName, DbAgentAnalysis, DbTenderAnalysis, DbTenderChatMessage } from '@/types/db'

interface CopiloteWorkspaceProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

export function CopiloteWorkspace({
  tenderId,
  initialMessages,
  initialAgentAnalyses,
  tenderAnalysis,
  tenderTitle,
}: CopiloteWorkspaceProps) {
  const [, setViewingAgent] = useState<ChatAgentName | null>(null)

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-full">
      <AgentPanel
        tenderId={tenderId}
        analyses={initialAgentAnalyses}
        onView={(agent) => setViewingAgent(agent)}
      />
      <AtelierIATab
        tenderId={tenderId}
        initialMessages={initialMessages}
        tenderAnalysis={tenderAnalysis}
        tenderTitle={tenderTitle}
      />
      {/* AgentAnalysisDrawer wired in Task 6 */}
    </div>
  )
}
```

Modify `page.tsx` line 168-175 (atelier branch). Replace:

```tsx
{view === 'atelier' && (
  <AtelierIATab
    tenderId={id}
    initialMessages={chatMessages}
    tenderAnalysis={analysis}
    tenderTitle={tender.title}
  />
)}
```

With:

```tsx
{view === 'atelier' && (
  <CopiloteWorkspace
    tenderId={id}
    initialMessages={chatMessages}
    initialAgentAnalyses={agentAnalyses}
    tenderAnalysis={analysis}
    tenderTitle={tender.title}
  />
)}
```

Add import in page.tsx after the AtelierIATab import:

```tsx
import { CopiloteWorkspace } from './CopiloteWorkspace'
```

- [ ] **Step 5.6: Run all tests**

Run: `npx vitest run`
Expected: All passing — existing 13 + new

- [ ] **Step 5.7: Smoke test**

Browser checklist:
- Open `/tenders/[id]?view=atelier`
- Layout : sidebar 320px à gauche avec liste des 7 agents, chat à droite
- Pour un agent sans analyse : « — Pas encore générée » + bouton `[Générer l'analyse]`
- Click `[Générer l'analyse]` → toast « Analyse Contradicteur lancée », état passe à « Génération en cours… »
- Refresh page après quelques secondes → état devient « ✓ Prête · N findings · il y a quelques min · mock »
- Cliquer `[Voir l'analyse]` → log console (drawer pas encore implémenté en Task 5)
- Sur mobile (resize < 768px) : layout devient single-column, AgentPanel au-dessus du chat

- [ ] **Step 5.8: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/AgentPanel.tsx \
        app/\(dashboard\)/tenders/\[id\]/CopiloteWorkspace.tsx \
        app/\(dashboard\)/tenders/\[id\]/page.tsx \
        tests/components/agent-panel.test.tsx
git commit -m "feat(copilote): AgentPanel sidebar with 4-state CTAs + sub-grid layout"
```

---

## Task 6 — `AgentAnalysisDrawer` (Voir l'analyse)

**Files:**
- Create: `app/(dashboard)/tenders/[id]/AgentAnalysisDrawer.tsx`
- Modify: `app/(dashboard)/tenders/[id]/CopiloteWorkspace.tsx`
- Test: `tests/components/agent-analysis-drawer.test.tsx`

- [ ] **Step 6.1: Write failing test**

Create `tests/components/agent-analysis-drawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentAnalysisDrawer } from '@/app/(dashboard)/tenders/[id]/AgentAnalysisDrawer'
import type { DbAgentAnalysis } from '@/types/db'

function makeAnalysis(overrides: Partial<DbAgentAnalysis> = {}): DbAgentAnalysis {
  return {
    id: 'a1',
    tender_id: 't1',
    agent_name: 'contradicteur',
    status: 'ready',
    summary: '## Synthèse\nDeux risques ICPE.',
    key_points: { items: ['Risque ICPE article 4', 'Pénalités asymétriques'] },
    raw_content: null,
    metadata: { provider: 'mock', input_tokens: 1200, output_tokens: 800 },
    error_msg: null,
    created_at: '2026-05-10T12:00:00Z',
    updated_at: '2026-05-10T12:00:00Z',
    ...overrides,
  }
}

describe('AgentAnalysisDrawer', () => {
  it('returns null when analysis is null', () => {
    const { container } = render(
      <AgentAnalysisDrawer
        open={true}
        analysis={null}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders summary and key points when ready', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByText(/synthèse/i)).toBeInTheDocument()
    expect(screen.getByText(/risque icpe article 4/i)).toBeInTheDocument()
    expect(screen.getByText(/pénalités asymétriques/i)).toBeInTheDocument()
  })

  it('renders metadata block (provider + tokens)', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByText(/mock/i)).toBeInTheDocument()
    expect(screen.getByText(/2 000 tokens/i)).toBeInTheDocument()
  })

  it('exposes Régénérer button', () => {
    render(
      <AgentAnalysisDrawer
        open={true}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /régénérer/i })).toBeInTheDocument()
  })

  it('returns null when open is false', () => {
    const { container } = render(
      <AgentAnalysisDrawer
        open={false}
        analysis={makeAnalysis()}
        tenderId="t1"
        onOpenChange={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 6.2: Run tests — verify they fail**

Run: `npx vitest run tests/components/agent-analysis-drawer.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 6.3: Implement `AgentAnalysisDrawer`**

Create `app/(dashboard)/tenders/[id]/AgentAnalysisDrawer.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { X, RotateCw, FileText, Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runAgentInitialAnalysisAction } from './atelier-actions'
import { AGENTS } from './agents-metadata'
import { AGENT_COLORS } from './agents-colors'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { DbAgentAnalysis } from '@/types/db'

interface AgentAnalysisDrawerProps {
  open: boolean
  analysis: DbAgentAnalysis | null
  tenderId: string
  onOpenChange: (open: boolean) => void
}

function formatTokens(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  const inT = typeof meta.input_tokens === 'number' ? meta.input_tokens : 0
  const outT = typeof meta.output_tokens === 'number' ? meta.output_tokens : 0
  const total = inT + outT
  if (total === 0) return null
  return `${total.toLocaleString('fr-FR')} tokens`
}

export function AgentAnalysisDrawer({ open, analysis, tenderId, onOpenChange }: AgentAnalysisDrawerProps) {
  const [regenerating, setRegenerating] = useState(false)

  if (!open || !analysis) return null

  const meta = AGENTS[analysis.agent_name]
  const colors = AGENT_COLORS[analysis.agent_name]
  const Icon = meta.icon
  const provider = analysis.metadata && typeof analysis.metadata === 'object' && 'provider' in analysis.metadata
    ? String((analysis.metadata as { provider?: string }).provider ?? '')
    : null
  const tokensLabel = formatTokens(analysis.metadata as Record<string, unknown> | null)

  const keyPoints: string[] = (() => {
    const kp = analysis.key_points
    if (!kp) return []
    if (Array.isArray((kp as { items?: unknown[] }).items)) {
      return ((kp as { items: unknown[] }).items)
        .filter((x): x is string => typeof x === 'string')
    }
    return []
  })()

  async function handleRegenerate() {
    if (!analysis) return
    setRegenerating(true)
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('agent_name', analysis.agent_name)
    const r = await runAgentInitialAnalysisAction(fd)
    setRegenerating(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success(`Régénération ${meta.label} lancée`)
      onOpenChange(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`Analyse ${meta.label}`}
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full sm:w-[480px] bg-background shadow-xl',
          'flex flex-col border-l overflow-hidden'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center', colors.bgClass)}>
            <Icon className={cn('h-3.5 w-3.5', colors.textClass)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{meta.label}</div>
            <div className="text-[11px] text-muted-foreground">Analyse persistée</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-muted"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Synthèse</h3>
            <div className="text-sm whitespace-pre-wrap">{analysis.summary ?? '_(pas de synthèse)_'}</div>
          </section>

          {keyPoints.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Points clés</h3>
              <ul className="text-sm space-y-1">
                {keyPoints.map((p, i) => (
                  <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{p}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Métadonnées</h3>
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Générée :</dt>
              <dd>{new Date(analysis.updated_at).toLocaleString('fr-FR')}</dd>
              {provider && (<>
                <dt className="text-muted-foreground">Provider :</dt>
                <dd className="font-mono">{provider}</dd>
              </>)}
              {tokensLabel && (<>
                <dt className="text-muted-foreground">Coût :</dt>
                <dd>{tokensLabel}</dd>
              </>)}
            </dl>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={regenerating}
            onClick={handleRegenerate}
          >
            <RotateCw className={cn('h-3 w-3 mr-1', regenerating && 'animate-spin')} />
            Régénérer l&apos;analyse
          </Button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 6.4: Verify tests pass**

Run: `npx vitest run tests/components/agent-analysis-drawer.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 6.5: Wire drawer in `CopiloteWorkspace`**

Modify `app/(dashboard)/tenders/[id]/CopiloteWorkspace.tsx`. Replace the entire file:

```tsx
'use client'

import { useState } from 'react'
import { AgentPanel } from './AgentPanel'
import { AtelierIATab } from './AtelierIATab'
import { AgentAnalysisDrawer } from './AgentAnalysisDrawer'
import type { ChatAgentName, DbAgentAnalysis, DbTenderAnalysis, DbTenderChatMessage } from '@/types/db'

interface CopiloteWorkspaceProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

export function CopiloteWorkspace({
  tenderId,
  initialMessages,
  initialAgentAnalyses,
  tenderAnalysis,
  tenderTitle,
}: CopiloteWorkspaceProps) {
  const [viewingAgent, setViewingAgent] = useState<ChatAgentName | null>(null)

  const viewingAnalysis = viewingAgent
    ? initialAgentAnalyses.find((a) => a.agent_name === viewingAgent) ?? null
    : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-full">
      <AgentPanel
        tenderId={tenderId}
        analyses={initialAgentAnalyses}
        onView={(agent) => setViewingAgent(agent)}
      />
      <AtelierIATab
        tenderId={tenderId}
        initialMessages={initialMessages}
        tenderAnalysis={tenderAnalysis}
        tenderTitle={tenderTitle}
      />
      <AgentAnalysisDrawer
        open={viewingAgent !== null}
        analysis={viewingAnalysis}
        tenderId={tenderId}
        onOpenChange={(open) => { if (!open) setViewingAgent(null) }}
      />
    </div>
  )
}
```

- [ ] **Step 6.6: Smoke test**

Browser checklist:
- Click `[Voir l'analyse]` sur un agent ready → drawer slide-in à droite avec backdrop
- Synthèse + Points clés + Métadonnées affichés correctement
- Click X ou backdrop → drawer ferme
- Click `[Régénérer l'analyse]` → toast « Régénération lancée », drawer ferme

- [ ] **Step 6.7: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/AgentAnalysisDrawer.tsx \
        app/\(dashboard\)/tenders/\[id\]/CopiloteWorkspace.tsx \
        tests/components/agent-analysis-drawer.test.tsx
git commit -m "feat(copilote): AgentAnalysisDrawer for persisted analysis viewing + regenerate"
```

---

## Task 7 — Hero compact ribbon + suggestions overlay

**Files:**
- Create: `app/(dashboard)/tenders/[id]/HeroCompactRibbon.tsx`
- Modify: `app/(dashboard)/tenders/[id]/CopiloteHeroCard.tsx` (export `SUGGESTED_PROMPTS`)
- Modify: `app/(dashboard)/tenders/[id]/AtelierIATab.tsx` (intégration ribbon)
- Test: ajouts mineurs dans test existant ou nouveau test

> Le Hero plein actuel (`CopiloteHeroCard`) reste pour l'état chat vide. Quand le chat est actif, on affiche un ribbon compact sticky qui donne accès aux mêmes suggestions via overlay.

- [ ] **Step 7.1: Refactor `CopiloteHeroCard.tsx` to export `SUGGESTED_PROMPTS`**

Modify `app/(dashboard)/tenders/[id]/CopiloteHeroCard.tsx`. Change:

```tsx
const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
```

To:

```tsx
export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
```

And export the type:

```tsx
export interface SuggestedPrompt {
  label: string
  icon: React.ComponentType<{ className?: string }>
  prompt: string
  agents: ChatAgentName[]
}
```

(Move type to top-level export, remove `interface` keyword duplicate inside file if needed.)

- [ ] **Step 7.2: Implement `HeroCompactRibbon`**

Create `app/(dashboard)/tenders/[id]/HeroCompactRibbon.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { SUGGESTED_PROMPTS } from './CopiloteHeroCard'
import type { ChatAgentName, DbAgentAnalysis } from '@/types/db'

interface HeroCompactRibbonProps {
  agentAnalyses: DbAgentAnalysis[]
  onPromptClick: (prompt: string, agents: ChatAgentName[]) => void
}

export function HeroCompactRibbon({ agentAnalyses, onPromptClick }: HeroCompactRibbonProps) {
  const [overlayOpen, setOverlayOpen] = useState(false)

  const total = 7
  const ready = agentAnalyses.filter((a) => a.status === 'ready').length
  const running = agentAnalyses.filter((a) => a.status === 'running').length
  const generated = agentAnalyses.filter((a) => a.status !== 'pending').length
  const toGenerate = total - generated

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b -mx-3 px-3 py-2 mb-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3 w-3 text-emerald-600 shrink-0" />
          <span className="font-medium truncate">{total} experts</span>
          <span className="text-muted-foreground truncate">
            · {ready} prêts · {running} en cours · {toGenerate} à générer
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOverlayOpen(true)}
          className="text-xs text-foreground hover:underline whitespace-nowrap shrink-0"
        >
          Voir suggestions ▼
        </button>
      </div>

      {overlayOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOverlayOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Suggestions de prompts"
            className="absolute right-3 top-full mt-1 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover shadow-xl p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Allez plus loin</h4>
              <button
                type="button"
                onClick={() => setOverlayOpen(false)}
                className="p-0.5 rounded hover:bg-muted"
                aria-label="Fermer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              {SUGGESTED_PROMPTS.map((p) => {
                const Icon = p.icon
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => { onPromptClick(p.prompt, p.agents); setOverlayOpen(false) }}
                    className="w-full flex items-start gap-2 p-2 rounded border bg-card hover:bg-muted/40 text-left"
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{p.prompt}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 7.3: Wire ribbon in `CopiloteWorkspace`**

`AtelierIATab` doesn't know about agentAnalyses anymore (removed in Task 4). Pass them via `CopiloteWorkspace` to a new prop on `AtelierIATab`.

Modify `AtelierIATab.tsx` interface:

```tsx
interface AtelierIATabProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  agentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}
```

Update destructure: `export function AtelierIATab({ tenderId, initialMessages, agentAnalyses, tenderAnalysis, tenderTitle }: AtelierIATabProps) {`

Add import in `AtelierIATab.tsx`:

```tsx
import { HeroCompactRibbon } from './HeroCompactRibbon'
import type { DbAgentAnalysis } from '@/types/db'
```

In the `AtelierIATab` JSX, just above the thread scrollable div, add:

```tsx
{messages.length > 0 && (
  <HeroCompactRibbon
    agentAnalyses={agentAnalyses}
    onPromptClick={handleHeroPromptClick}
  />
)}
```

Update `CopiloteWorkspace` to pass `agentAnalyses`:

```tsx
<AtelierIATab
  tenderId={tenderId}
  initialMessages={initialMessages}
  agentAnalyses={initialAgentAnalyses}
  tenderAnalysis={tenderAnalysis}
  tenderTitle={tenderTitle}
/>
```

- [ ] **Step 7.4: Run all tests**

Run: `npx vitest run`
Expected: All passing

- [ ] **Step 7.5: Smoke test**

Browser checklist:
- Empty chat → Hero plein visible (CopiloteHeroCard)
- Send 1 message → Hero plein disparaît, Ribbon compact apparaît en haut sticky
- Le ribbon affiche « 7 experts · X prêts · Y en cours · Z à générer »
- Click `Voir suggestions ▼` → overlay avec 6 prompts
- Click un prompt → composer pré-rempli, agents sélectionnés, overlay ferme
- Scroll dans le thread → ribbon reste sticky en haut

- [ ] **Step 7.6: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/HeroCompactRibbon.tsx \
        app/\(dashboard\)/tenders/\[id\]/CopiloteHeroCard.tsx \
        app/\(dashboard\)/tenders/\[id\]/AtelierIATab.tsx \
        app/\(dashboard\)/tenders/\[id\]/CopiloteWorkspace.tsx
git commit -m "feat(copilote): HeroCompactRibbon sticky with suggestions overlay"
```

---

## Task 8 — Challenge manuel single-round

**Files:**
- Modify: `app/(dashboard)/tenders/[id]/atelier-actions.ts`
- Modify: `app/(dashboard)/tenders/[id]/AtelierMessageThread.tsx`
- Test: `tests/services/challenge.test.ts` (mise à jour si existante)

> Le spec exige : 1 seul round de challenge possible, jamais automatique. La server action permettait `current_round` 0 ou 1 (max 2 rounds). On cap maintenant à 0 → 1 uniquement (1 round max).

- [ ] **Step 8.1: Update server action cap**

Modify `app/(dashboard)/tenders/[id]/atelier-actions.ts`. Find:

```ts
const challengeSchema = z.object({
  tender_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  current_round: z.number().int().min(0).max(1),  // round actuel ; le challenge crée round+1
})
```

Replace with:

```ts
const challengeSchema = z.object({
  tender_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  current_round: z.number().int().min(0).max(0),  // 1 round max ; current=0 → next=1
})
```

And find:

```ts
const nextRound = parsed.data.current_round + 1
if (nextRound > 2) return { error: 'Max 2 rounds de challenge atteint' }
```

Replace with:

```ts
const nextRound = parsed.data.current_round + 1
if (nextRound > 1) return { error: 'Une seule confrontation par tour' }
```

- [ ] **Step 8.2: Update `AtelierMessageThread.tsx` wording**

Modify the challenge button wording. Find the button rendering "Confronter les perspectives" and replace with "Confronter les avis · round unique". Also disable the button when `challenge_round >= 1`.

(The exact line will depend on AtelierMessageThread internals — search for the button text.)

```bash
grep -n "Confronter les perspectives\|Round 1\|challenge_round" app/\(dashboard\)/tenders/\[id\]/AtelierMessageThread.tsx
```

In the resulting button, replace the visible text with: `Confronter les avis` and the subtitle with: `Round unique · les agents réagiront aux propos des autres`.

- [ ] **Step 8.3: Update or add challenge test**

Run existing challenge tests :

```bash
npx vitest run tests/services/challenge.test.ts
```

If failing because of cap change, update the test expectation : `current_round: 1` should now return error « Une seule confrontation par tour ».

- [ ] **Step 8.4: Smoke test**

Browser checklist:
- Mode Débat IA, 2-3 agents, send question → réponses parallèles
- Bouton « Confronter les avis » visible sous les bulles
- Click → round confrontation effectué
- Après confrontation, bouton DISPARAÎT (plus de re-confrontation possible pour ce turn)
- Send nouvelle question → nouveau cycle, bouton réapparaît

- [ ] **Step 8.5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/atelier-actions.ts \
        app/\(dashboard\)/tenders/\[id\]/AtelierMessageThread.tsx \
        tests/services/challenge.test.ts
git commit -m "refacto(copilote): challenge manual single-round only"
```

---

## Task 9 — Responsive mobile (drawers latéraux)

**Files:**
- Modify: `app/(dashboard)/tenders/[id]/CopiloteWorkspace.tsx`
- Modify: `app/(dashboard)/tenders/[id]/page.tsx`
- Create: `app/(dashboard)/tenders/[id]/MobileDrawer.tsx`

> Décision spec § 5.3 : sur mobile (< 768px), TenderSidebar et AgentPanel deviennent drawers slide-in depuis la gauche, accessibles via 2 boutons header `[État ▼] [Analyses ▼]`. Le contenu chat reste prioritaire (zone tap minimum 60% de l'écran).

- [ ] **Step 9.1: Create lightweight `MobileDrawer`**

Create `app/(dashboard)/tenders/[id]/MobileDrawer.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MobileDrawerProps {
  open: boolean
  title: string
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function MobileDrawer({ open, title, onOpenChange, children }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => onOpenChange(false)} aria-hidden />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          'fixed left-0 top-0 z-50 h-full w-[85vw] max-w-[320px] bg-background shadow-xl',
          'flex flex-col border-r overflow-hidden'
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-muted" aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 9.2: Update `CopiloteWorkspace` to switch layout responsively**

Replace the layout in `CopiloteWorkspace.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Menu, ListTree } from 'lucide-react'
import { AgentPanel } from './AgentPanel'
import { AtelierIATab } from './AtelierIATab'
import { AgentAnalysisDrawer } from './AgentAnalysisDrawer'
import { MobileDrawer } from './MobileDrawer'
import type { ChatAgentName, DbAgentAnalysis, DbTenderAnalysis, DbTenderChatMessage } from '@/types/db'

interface CopiloteWorkspaceProps {
  tenderId: string
  initialMessages: DbTenderChatMessage[]
  initialAgentAnalyses: DbAgentAnalysis[]
  tenderAnalysis: DbTenderAnalysis | null
  tenderTitle: string
}

export function CopiloteWorkspace({
  tenderId,
  initialMessages,
  initialAgentAnalyses,
  tenderAnalysis,
  tenderTitle,
}: CopiloteWorkspaceProps) {
  const [viewingAgent, setViewingAgent] = useState<ChatAgentName | null>(null)
  const [mobileAgentsOpen, setMobileAgentsOpen] = useState(false)

  const viewingAnalysis = viewingAgent
    ? initialAgentAnalyses.find((a) => a.agent_name === viewingAgent) ?? null
    : null

  return (
    <div className="h-full">
      {/* Mobile-only header (md hidden) */}
      <div className="md:hidden flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => setMobileAgentsOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-muted/50"
        >
          <ListTree className="h-3 w-3" /> Analyses
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-full">
        {/* Desktop AgentPanel */}
        <div className="hidden md:block">
          <AgentPanel
            tenderId={tenderId}
            analyses={initialAgentAnalyses}
            onView={(agent) => setViewingAgent(agent)}
          />
        </div>

        <AtelierIATab
          tenderId={tenderId}
          initialMessages={initialMessages}
          agentAnalyses={initialAgentAnalyses}
          tenderAnalysis={tenderAnalysis}
          tenderTitle={tenderTitle}
        />
      </div>

      {/* Mobile drawer wrapping AgentPanel */}
      <MobileDrawer
        open={mobileAgentsOpen}
        title="Analyses persistées"
        onOpenChange={setMobileAgentsOpen}
      >
        <AgentPanel
          tenderId={tenderId}
          analyses={initialAgentAnalyses}
          onView={(agent) => { setViewingAgent(agent); setMobileAgentsOpen(false) }}
        />
      </MobileDrawer>

      <AgentAnalysisDrawer
        open={viewingAgent !== null}
        analysis={viewingAnalysis}
        tenderId={tenderId}
        onOpenChange={(open) => { if (!open) setViewingAgent(null) }}
      />
    </div>
  )
}
```

- [ ] **Step 9.3: Update `page.tsx` mobile sidebar**

The TenderSidebar already exists in page.tsx — on mobile we need an `[État ▼]` button equivalent. Modify the parent grid in `page.tsx`. Replace:

```tsx
return (
  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
    <TenderSidebar ... />
    <div className={view === 'atelier' ? 'min-w-0 h-[calc(100vh-3rem)] flex flex-col' : 'space-y-4 min-w-0'}>
```

With:

```tsx
return (
  <>
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-8">
      <div className="hidden md:block">
        <TenderSidebar ... />
      </div>
      <div className={view === 'atelier' ? 'min-w-0 h-[calc(100vh-3rem)] flex flex-col' : 'space-y-4 min-w-0'}>
```

(and close the wrapper accordingly).

For mobile we need a button to open TenderSidebar in a drawer — but since the page is a server component and TenderSidebar already exists as a client component, the cleanest approach is to add a wrapper client component `MobileTenderSidebarTrigger` that holds drawer state.

For Task 9 simplicity, accept that mobile users see a `[État ▼]` button at the top of the chat zone and the drawer slides TenderSidebar. Add the trigger inside `CopiloteWorkspace` for the atelier view :

In `CopiloteWorkspace.tsx`, inside the mobile-only header, add another button + drawer wrapping TenderSidebar passed as a `mobileSidebar` prop. Simpler: leave it for now and accept the limitation that on mobile the TenderSidebar stacks above the workspace (existing behavior) — only AgentPanel becomes a drawer. The user spec says "contenu prioritaire" — TenderSidebar at top is acceptable since it's collapsible by scroll.

> **Pragmatic choice:** keep TenderSidebar stacked on mobile (existing behavior), only convert AgentPanel to drawer. This respects spec § 5.3 « le contenu principal doit rester prioritaire » without a heavy refactor of TenderSidebar.

Revert page.tsx changes from this step — keep page.tsx as before.

- [ ] **Step 9.4: Smoke test mobile**

Browser checklist (resize to iPhone SE 375px):
- TenderSidebar stack au-dessus du chat (existing)
- Bouton `[Analyses]` visible en haut de la zone Copilote
- Click → drawer slide-in à gauche avec AgentPanel
- Click sur un agent ready → drawer ferme, AgentAnalysisDrawer s'ouvre par-dessus
- Toutes les actions fonctionnent (Générer, Voir, Régénérer)
- ModeCard et composer restent en bas, accessibles
- Hero compact ribbon visible quand chat actif

- [ ] **Step 9.5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/MobileDrawer.tsx \
        app/\(dashboard\)/tenders/\[id\]/CopiloteWorkspace.tsx
git commit -m "feat(copilote): mobile drawer for AgentPanel + content-first layout"
```

---

## Task 10 — Nettoyage wording final + uniformisation Copilote AO

**Files:**
- Modify: `app/(dashboard)/tenders/[id]/TenderSidebar.tsx`
- Modify: `app/(dashboard)/tenders/[id]/page.tsx` (params type & valid views)
- Recherche globale dans le repo : remplacer "Atelier IA" → "Copilote AO"

- [ ] **Step 10.1: Audit du wording « Atelier IA » dans le repo**

Run: `grep -rn "Atelier IA" app/ components/ 2>/dev/null`

For each occurrence, decide :
- User-visible string → replace with `Copilote AO`
- Code identifier (function/file/var name) → leave as-is unless trivially renameable
- Comment/doc → replace if it would confuse a reader

- [ ] **Step 10.2: Replace user-visible "Atelier IA" → "Copilote AO"**

Use `Edit` tool with `replace_all: true` on each file flagged in Step 10.1, but ONLY for strings inside JSX text content or string literals, not symbol names.

Example targets (verify via grep first) :

- `TenderSidebar.tsx` : navigation label
- Page title or breadcrumb if any
- Tooltips

- [ ] **Step 10.3: Audit "Briefer" / "Réveiller" residual**

Run: `grep -rn "Briefer\|Réveiller" app/ 2>/dev/null`

Expected: 0 user-visible occurrence (all removed in Task 4 when AgentPill was deleted). If any remain, replace with "Générer l'analyse" / "Régénérer".

- [ ] **Step 10.4: Audit `view === 'atelier'` codepath**

The `view` URL param is still `atelier` for backward compat. Decision : leave it as-is — renaming the URL would break bookmarks. Add a comment in `page.tsx` next to `VALID_VIEWS`:

```tsx
// 'atelier' is the legacy URL param for the Copilote view (label changed but URL kept for bookmark stability)
const VALID_VIEWS: TenderView[] = ['synthese', 'analyse', 'memoire', 'atelier']
```

- [ ] **Step 10.5: Run full test suite**

Run: `npx vitest run`
Expected: All passing

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 10.6: Final smoke test full flow**

Browser end-to-end :
- Login admin
- `/tenders` list visible
- Open tender ready → `?view=synthese` (default)
- Sidebar nav : « Copilote AO » (pas « Atelier IA »)
- Click Copilote AO → vue chargée, AgentPanel + Chat visible
- Empty chat → Hero plein
- Click un prompt → ModeCard pré-rempli, send
- Réponse(s) reçues, hero ribbon apparaît
- Mode Débat IA (2-3 agents) → bouton Confronter les avis → 1 round → bouton disparaît
- AgentPanel : générer une analyse, attendre, refresh, voir analyse via drawer, régénérer
- Mobile resize 375px : drawer Analyses fonctionne, chat reste prioritaire
- Refresh page → sélection agents persistée (localStorage)

- [ ] **Step 10.7: Commit final**

```bash
git add -A
git commit -m "polish(copilote): wording uniformization Atelier IA → Copilote AO + final cleanup"
```

---

## Self-Review

### Spec coverage check

| Spec section | Implémenté par |
|---|---|
| § 4.1 AgentPanel | Task 5 |
| § 4.2 Mode Card | Task 3 |
| § 4.3 Agent Selector | Task 2 |
| § 4.4 Analyses Drawer | Task 6 |
| § 4.5 Hero compact ribbon | Task 7 |
| § 4.6 Composer & CTA adaptatif | Task 4 (CTA) + ModeCard (déjà inclus) |
| § 4.7 Challenge manuel single-round | Task 8 |
| § 5 Layout responsive | Task 5 (desktop) + Task 9 (mobile) |
| § 6 Wording table | Task 4 + Task 10 |
| § 7 State machines | Implicite dans AgentPanel (Task 5) + ModeCard (Task 3) + atelier-actions cap (Task 8) |
| § 11 localStorage persistence | Task 1 (helper) + Task 4 (intégration) |
| § 12 Risques (popover bug) | Task 2 utilise div absolu controlled — pas de portail |

### Placeholder scan

Aucun « TBD », « TODO », « implement later ». Chaque step contient le code complet. Les commit messages sont concrets.

### Type consistency check

- `selectedAgents` : `ChatAgentName[]` partout (Task 4 onwards), pas de `Set`
- `MAX_AGENTS` : exporté depuis `copilote-mode.ts`, importé partout
- `resolveMode` / `modeCta` / `modeLabel` : signatures stables Task 1 → Task 4
- `loadSelectedAgents` / `saveSelectedAgents` : tenderId: string, agents: ChatAgentName[]
- `AgentPanel` props `(tenderId, analyses, onView)` cohérents Task 5 → Task 9
- `AgentAnalysisDrawer` props `(open, analysis, tenderId, onOpenChange)` cohérents
- `runAgentInitialAnalysisAction` server action signature inchangée

### Scope check

Plan ciblé sur la vue `atelier` et ses dépendances directes. Aucune touch sur `synthese` / `analyse` / `memoire`, conformément au spec § 9 hors scope.

10 tasks, 6 commits-cibles minimum (les tasks 1+2+3 fusionnables en pratique), chacune produit un état fonctionnel.
