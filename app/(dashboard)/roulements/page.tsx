// « Quels roulements tournent en ce moment, et sur quels chantiers ? »
//
// L'objet Roulement existait, mais il était CACHÉ derrière chaque fiche
// chantier : acceptable pour modifier un roulement précis, impossible pour
// piloter l'ensemble. Personne ne pouvait répondre à cette question sans ouvrir
// vingt fiches.
//
// ⚠️ Cette vue N'EST PAS un troisième planning. Elle ne rejoue pas la semaine,
//    elle ne projette rien, elle n'affiche aucune grille. Elle répond à UNE
//    question — « quels roulements existent, et dans quel état ? » — et laisse :
//      • /semaine        = l'outil OPÉRATIONNEL ;
//      • la grille       = l'outil de CONFIGURATION.
//
// Trois portes mènent au même objet et au même éditeur : le menu (voir tous),
// la fiche chantier (gérer celui-ci), la semaine (en créer un).

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Repeat, MapPin, AlertTriangle, Plus, ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listCyclesForOrg, type CycleOverview } from '@/lib/db/planning-cycles'
import { frDayMonthLocal, todayLocalIso } from '@/lib/time/local-date'

export const dynamic = 'force-dynamic'

type Phase = 'draft' | 'active' | 'future' | 'ended'

/** Où en est ce roulement, aujourd'hui ? Déterministe, jamais un jugement. */
function phaseOf(c: CycleOverview, today: string): Phase {
  if (c.status === 'draft') return 'draft'
  if (c.endsOn && c.endsOn < today) return 'ended'
  if (c.startsOn > today) return 'future'
  return 'active'
}

const PHASE_FR: Record<Phase, { label: string; cls: string }> = {
  active: { label: 'En cours', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  future: { label: 'À venir', cls: 'border-sky-200 bg-sky-50 text-sky-800' },
  draft: { label: 'Brouillon', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  ended: { label: 'Terminé', cls: 'border-border bg-muted text-muted-foreground' },
}

const PHASE_ORDER: Phase[] = ['active', 'future', 'draft', 'ended']

function periodFr(c: CycleOverview): string {
  const from = frDayMonthLocal(c.startsOn)
  return c.endsOn ? `${from} → ${frDayMonthLocal(c.endsOn)}` : `depuis le ${from}`
}

export default async function RoulementsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const cycles = await listCyclesForOrg().catch(() => [] as CycleOverview[])
  const today = todayLocalIso()

  // En cours d'abord. C'est ce qui tourne AUJOURD'HUI qui l'intéresse — un
  // roulement terminé n'a plus rien à lui dire.
  const sorted = [...cycles].sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(phaseOf(a, today))
    const pb = PHASE_ORDER.indexOf(phaseOf(b, today))
    if (pa !== pb) return pa - pb
    return b.startsOn.localeCompare(a.startsOn)
  })

  // La synthèse — ce que la liste dit d'un coup d'œil (Vincent, 2026-07-15 :
  // « étoffe un peu la page »). Rien de neuf n'est requêté : on compte ce
  // qu'on affiche déjà.
  const byPhase = new Map<Phase, CycleOverview[]>()
  for (const c of sorted) {
    const p = phaseOf(c, today)
    byPhase.set(p, [...(byPhase.get(p) ?? []), c])
  }
  const activeCycles = byPhase.get('active') ?? []
  const siteCount = new Set(activeCycles.map((c) => c.siteId)).size
  const teamTotal = activeCycles.reduce((n, c) => n + c.teamCount, 0)
  const uncoveredTotal = activeCycles.reduce((n, c) => n + c.uncoveredDays, 0)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        {/* Depuis R4, on arrive ici par « Sources du planning » : le chemin
            du retour doit être aussi court que celui de l'aller. */}
        <Link
          href="/mois"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Retour au planning
        </Link>
        <header className="mt-2 space-y-1">
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
            <Repeat className="h-5 w-5 text-muted-foreground" />
            Roulements
          </h1>
          <p className="text-sm text-muted-foreground">
            Qui travaille, quels jours, en rotation — sur tous les chantiers.
          </p>
        </header>
        {activeCycles.length > 0 && (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">
              {activeCycles.length} roulement{activeCycles.length > 1 ? 's' : ''} en cours
            </span>
            <span className="text-xs text-muted-foreground">
              {siteCount} chantier{siteCount > 1 ? 's' : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {teamTotal} équipe{teamTotal > 1 ? 's' : ''} en rotation
            </span>
            {uncoveredTotal > 0 && (
              <span className="text-xs font-medium text-rose-700">
                ⚠ {uncoveredTotal} jour{uncoveredTotal > 1 ? 's' : ''} sans personne
              </span>
            )}
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun roulement. Un roulement se crée depuis la fiche d&apos;un chantier, ou depuis
          «&nbsp;Planifier&nbsp;» dans la semaine.
        </p>
      ) : (
        PHASE_ORDER.filter((p) => (byPhase.get(p) ?? []).length > 0).map((sectionPhase) => (
        <section key={sectionPhase} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PHASE_FR[sectionPhase].label}
            <span className="ml-1.5 font-normal opacity-70">{byPhase.get(sectionPhase)!.length}</span>
          </h2>
        <ul className="space-y-2">
          {byPhase.get(sectionPhase)!.map((c) => {
            const phase = phaseOf(c, today)
            const meta = PHASE_FR[phase]
            return (
              <li key={c.id}>
                <Link
                  href={`/sites/${c.siteId}/roulements/${c.id}`}
                  className="block rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {c.siteName}
                        <span className="opacity-50">·</span>
                        {c.missionName}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {c.cycleLengthWeeks} semaine{c.cycleLengthWeeks > 1 ? 's' : ''}
                    </span>
                    <span className="opacity-50">·</span>
                    <span>{periodFr(c)}</span>
                    <span className="opacity-50">·</span>
                    <span>
                      {c.teamCount} équipe{c.teamCount > 1 ? 's' : ''}
                    </span>
                    <span className="opacity-50">·</span>
                    <span>
                      {c.workedSlots} jour{c.workedSlots > 1 ? 's' : ''} travaillé
                      {c.workedSlots > 1 ? 's' : ''}
                    </span>

                    {/* Le seul signal calculé ici : un jour du cycle où PERSONNE
                        n'est prévu. C'est celui qu'il cherche du regard sur sa
                        feuille — et il est gratuit (déterministe, sans requête). */}
                    {c.uncoveredDays > 0 && (
                      <>
                        <span className="opacity-50">·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {c.uncoveredDays} jour{c.uncoveredDays > 1 ? 's' : ''} sans personne
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
        </section>
        ))
      )}

      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Plus className="h-3.5 w-3.5" />
        Un roulement se crée depuis la fiche d&apos;un chantier — il appartient au lieu.
      </p>
    </div>
  )
}
