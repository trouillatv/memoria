import Link from 'next/link'
import { Plus, Repeat, CalendarRange, Copy } from 'lucide-react'
import type { PlanningCycle } from '@/lib/db/planning-cycles'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { RemoveCycleButton } from '../../roulements/RemoveCycleButton'
import { SectionTitle, Empty } from './PlanningUI'

// UX-CONTINUITY-1 (constat recette E2E Vincent 2026-09-28) — même contenu que
// /sites/[id]/roulements (page autonome conservée, toujours atteignable depuis
// les CTA existants de la fiche Mission), mais intégré ici comme sous-onglet du
// Planning chantier pour ne pas sortir de son contexte. Une seule source de
// vérité (listCyclesBySite), deux points d'entrée.

const WEEK_LABEL = (n: number) => (n === 1 ? '1 semaine' : `${n} semaines`)

interface RoulementsSubViewProps {
  siteId: string
  cycles: PlanningCycle[]
}

export function RoulementsSubView({ siteId, cycles }: RoulementsSubViewProps) {
  return (
    <main className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle
          icon={Repeat}
          title="Rythmes & roulements"
          detail="Qui travaille, quels jours, en rotation — et jusqu'à quand."
        />
        <Link
          href={`/sites/${siteId}/roulements/nouveau`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" /> Créer un roulement
        </Link>
      </div>

      {cycles.length === 0 ? (
        <Empty>Aucun roulement. Les prestations sont saisies une par une.</Empty>
      ) : (
        <ul className="space-y-2">
          {cycles.map((c) => {
            const worked = c.slots.filter((s) => s.state === 'work').length
            return (
              <li key={c.id} className="group rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/sites/${siteId}/roulements/${c.id}`} className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{c.name}</span>
                      {c.status === 'draft' && (
                        <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                          Brouillon
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {WEEK_LABEL(c.cycleLengthWeeks)} ·{' '}
                      {worked === 0 ? 'aucun jour travaillé' : `${worked} jour${worked > 1 ? 's' : ''} travaillé${worked > 1 ? 's' : ''}`}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarRange className="h-3.5 w-3.5" />
                      Depuis le {frDayMonthLocal(c.startsOn)}
                      {c.endsOn ? `, jusqu'au ${frDayMonthLocal(c.endsOn)}` : ' — sans date de fin'}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Link
                      href={`/sites/${siteId}/roulements/nouveau?copier=${c.id}`}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" /> Dupliquer
                    </Link>
                    <RemoveCycleButton cycleId={c.id} name={c.name} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
