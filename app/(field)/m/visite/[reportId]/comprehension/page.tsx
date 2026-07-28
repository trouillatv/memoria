import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, Mic, Pencil, Video, ChevronDown, ArrowLeft,
  ListChecks, AlertTriangle, Scale, Lightbulb, Users, CalendarClock,
  CheckCircle2, Clock3, XCircle, RefreshCw, UserCheck, UserX, Building2,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildVisitUnderstandingChain } from '@/lib/knowledge/understanding-chain'
import { readDebriefSemanticMemory } from '@/lib/visits/debrief-analysis'
import type { ProposalKind, ProposalStatus } from '@/lib/db/knowledge-proposals'
import type { VisitCaptureKind } from '@/lib/db/visit-captures'
import type { EntityResolution } from '@/lib/knowledge/semantic-resolution'
import { ignoreCandidat, addEntityFromCandidat } from './semantic-actions'

export const dynamic = 'force-dynamic'

/**
 * « Comment MemorIA a compris cette visite » — la chaîne rendue visible :
 * ce que tu as relevé → ce que MemorIA en a compris → ce que c'est devenu.
 * Répond à « pourquoi cette action existe ? » sans quitter le terrain.
 * Lot 1C : résolutions sémantiques visibles et actionnables.
 */

const KIND_META: Record<ProposalKind, { label: string; Icon: typeof ListChecks; cls: string }> = {
  action: { label: 'Action', Icon: ListChecks, cls: 'text-sky-600' },
  vigilance: { label: 'Point de vigilance', Icon: AlertTriangle, cls: 'text-amber-600' },
  decision: { label: 'Décision', Icon: Scale, cls: 'text-violet-600' },
  knowledge: { label: 'À savoir', Icon: Lightbulb, cls: 'text-emerald-600' },
  stakeholder: { label: 'Intervenant', Icon: Users, cls: 'text-indigo-600' },
  deadline: { label: 'Échéance', Icon: CalendarClock, cls: 'text-rose-600' },
}

const CAPTURE_ICON: Record<VisitCaptureKind, typeof Camera> = {
  photo: Camera, video: Video, vocal: Mic, note: Pencil, verification: Pencil, position: Pencil,
}

// « Ce que c'est devenu » — l'état de la proposition, dit avec les mots du
// conducteur. Jamais « confirmed » brut.
function becameLabel(status: ProposalStatus, kindLabel: string): { text: string; Icon: typeof CheckCircle2; cls: string } {
  switch (status) {
    case 'confirmed':
    case 'fulfilled':
      return { text: `${kindLabel} créé${kindLabel === 'Action' || kindLabel === 'Décision' || kindLabel === 'Échéance' ? 'e' : ''}`, Icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' }
    case 'proposed':
      return { text: 'En attente de ta validation', Icon: Clock3, cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300' }
    case 'dismissed':
      return { text: 'Écartée', Icon: XCircle, cls: 'bg-muted text-muted-foreground' }
    case 'superseded':
      return { text: 'Remplacée', Icon: RefreshCw, cls: 'bg-muted text-muted-foreground' }
    case 'masked':
      return { text: 'Masquée par le filtre', Icon: XCircle, cls: 'bg-muted text-muted-foreground' }
  }
}

const SOURCE_LABEL: Record<EntityResolution['source'], string> = {
  semantic_memory: 'Mémoire du chantier',
  canonical_name: 'Nom canonique',
  llm_only: 'Non reconnu',
}

const SCOPE_LABEL: Record<string, string> = {
  org: 'Organisation',
  site: 'Chantier',
  user: 'Utilisateur',
}

export default async function VisitComprehensionPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('name').eq('id', visit.site_id).maybeSingle()
  const siteName = (site as { name: string } | null)?.name ?? 'Chantier'

  const [chain, semanticMemory] = await Promise.all([
    buildVisitUnderstandingChain(reportId),
    readDebriefSemanticMemory(reportId),
  ])
  const photos = chain.captures.filter((c) => c.kind === 'photo' || c.kind === 'video')
  const spoken = chain.captures.filter((c) => (c.kind === 'vocal' || c.kind === 'note') && c.text)

  // Résolutions à afficher : dédupliquées, sans les ignorées
  const ignored = new Set(semanticMemory?.ignored_candidates ?? [])
  const resolutionEntries = semanticMemory
    ? Object.entries(semanticMemory.resolutions).filter(([rawText]) => !ignored.has(rawText))
    : []
  const resolvedEntries = resolutionEntries.filter(([, r]) => r.status === 'resolved')
  const unknownEntries = resolutionEntries.filter(([, r]) => r.status !== 'resolved')

  return (
    <div className="space-y-5 max-w-md pb-24">
      <header className="space-y-1 pt-1">
        <Link
          href={`/m/visite/${reportId}/recap`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground active:opacity-70"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Récap de la visite
        </Link>
        <h1 className="text-xl font-bold leading-tight">Comment MemorIA a compris cette visite</h1>
        <p className="text-[13px] text-muted-foreground">{siteName}</p>
      </header>

      {chain.captures.length === 0 && chain.understood.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Rien n&apos;a été relevé lors de cette visite.
        </p>
      ) : (
        <>
          {/* ── 1. Ce que tu as relevé ──────────────────────────── */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ce que tu as relevé
            </h2>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((c) => (
                  <div key={c.id} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                    {c.previewUrl ? (
                      c.kind === 'video'
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        ? <video src={c.previewUrl} className="h-full w-full object-cover" muted />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={c.previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted-foreground">
                        <Camera className="h-5 w-5" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {spoken.map((c) => {
              const Icon = CAPTURE_ICON[c.kind]
              return (
                <div key={c.id} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700/80" />
                  <p className="min-w-0 flex-1 text-[13px] italic leading-snug text-foreground/90">« {c.text} »</p>
                </div>
              )
            })}
            {photos.length === 0 && spoken.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Aucune capture retenue.</p>
            )}
          </section>

          {chain.understood.length > 0 && (
            <div className="flex justify-center text-muted-foreground/50">
              <ChevronDown className="h-5 w-5" />
            </div>
          )}

          {/* ── 2. Ce que MemorIA en a compris → ce que c'est devenu ── */}
          {chain.understood.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ce que MemorIA en a compris
              </h2>
              <ul className="space-y-2.5">
                {chain.understood.map((u) => {
                  const meta = KIND_META[u.kind]
                  const Icon = meta.Icon
                  const became = becameLabel(u.status, meta.label)
                  const BecameIcon = became.Icon
                  const sourceCount = u.sourceCaptureIds.length
                  return (
                    <li key={u.id} className="rounded-2xl border border-foreground/[0.08] bg-card p-3.5">
                      <div className="flex items-start gap-2.5">
                        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.cls}`} strokeWidth={2} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                          <p className="mt-0.5 text-[14px] font-medium leading-snug">{u.title}</p>
                          {sourceCount > 0 && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              à partir de {sourceCount} élément{sourceCount > 1 ? 's' : ''} relevé{sourceCount > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5 border-t border-foreground/[0.06] pt-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${became.cls}`}>
                          <BecameIcon className="h-3 w-3" /> {became.text}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : (
            <p className="rounded-xl border bg-muted/30 px-4 py-5 text-center text-[13px] text-muted-foreground">
              MemorIA n&apos;a pas encore tiré de conclusion de cette visite.
            </p>
          )}

          {/* ── 3. Intervenants et entreprises (Lot 1C) ────────────── */}
          {resolutionEntries.length > 0 && (
            <>
              <div className="flex justify-center text-muted-foreground/50">
                <ChevronDown className="h-5 w-5" />
              </div>
              <section className="space-y-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Intervenants et entreprises
                </h2>

                {/* Entités reconnues */}
                {resolvedEntries.length > 0 && (
                  <ul className="space-y-2">
                    {resolvedEntries.map(([rawText, r]) => (
                      <li key={rawText} className="rounded-2xl border border-foreground/[0.06] bg-card p-3.5">
                        <div className="flex items-start gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                            <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] text-muted-foreground">{rawText}</p>
                            <p className="text-[14px] font-semibold leading-snug">{r.canonical}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {SOURCE_LABEL[r.source]}
                              {r.entityId && semanticMemory?.resolutions[rawText] && (
                                <> · {SCOPE_LABEL['org'] /* TODO: expose scope from resolution */}</>
                              )}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Entités non reconnues */}
                {unknownEntries.length > 0 && (
                  <ul className="space-y-2">
                    {unknownEntries.map(([rawText]) => {
                      const orgId = visit.organization_id ?? ''
                      async function doIgnore() {
                        'use server'
                        await ignoreCandidat(reportId, rawText)
                      }
                      async function doAddPerson() {
                        'use server'
                        await addEntityFromCandidat(reportId, orgId, rawText, 'person')
                      }
                      async function doAddCompany() {
                        'use server'
                        await addEntityFromCandidat(reportId, orgId, rawText, 'company')
                      }
                      return (
                        <li key={rawText} className="rounded-2xl border border-amber-200/60 bg-amber-50/40 p-3.5 dark:border-amber-900/30 dark:bg-amber-950/10">
                          <div className="flex items-start gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
                              <UserX className="h-3.5 w-3.5 text-amber-600" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-semibold leading-snug">{rawText}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Personne non reconnue</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-amber-200/50 pt-3 dark:border-amber-900/30">
                            <Link
                              href={`/m/visite/${reportId}/comprehension/associer?rawText=${encodeURIComponent(rawText)}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground active:opacity-70"
                            >
                              <Users className="h-3 w-3" /> Associer
                            </Link>
                            <form action={doAddPerson}>
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground active:opacity-70"
                              >
                                <Users className="h-3 w-3" /> Ajouter comme personne
                              </button>
                            </form>
                            <form action={doAddCompany}>
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground active:opacity-70"
                              >
                                <Building2 className="h-3 w-3" /> Ajouter comme entreprise
                              </button>
                            </form>
                            <form action={doIgnore}>
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground active:opacity-70"
                              >
                                <XCircle className="h-3 w-3" /> Ignorer
                              </button>
                            </form>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
