import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Footprints, Users, Wrench,
  ClipboardList, CheckCircle2, CheckSquare, Compass, Trophy, Star,
  MapPin, CalendarClock, AlertTriangle, Info, Check,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSiteTimeline, type TimelineKind } from '@/lib/db/site-timeline'
import { getSiteHistory } from '@/lib/knowledge/site-events'
import { NOUMEA_TZ, frDayMonthLocal } from '@/lib/time/local-date'
import { SiteTabs } from '../SiteTabs'
import { VisitLauncher } from '../VisitLauncher'

export const dynamic = 'force-dynamic'

/**
 * Frise du chantier — « Raconte-moi l'histoire de ce chantier ». Chronologie
 * plate, du plus récent au plus ancien, fusionnant tous les événements réels
 * (visites, réunions, interventions faites, réserves, actions terminées,
 * décisions). Déterministe, zéro IA. Chaque carte ouvre son objet quand une vue
 * mobile existe. Sous-écran de la fiche (barre basse masquée) → retour en tête.
 */
/** L'heure du conducteur, jamais celle du serveur (Vercel tourne en UTC). */
const friseHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })

const META: Record<TimelineKind, { Icon: typeof Users; cls: string; ring: string }> = {
  visit: { Icon: Footprints, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  meeting: { Icon: Users, cls: 'text-sky-600', ring: 'bg-sky-100 dark:bg-sky-950/40' },
  intervention: { Icon: Wrench, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  reserve_open: { Icon: ClipboardList, cls: 'text-rose-600', ring: 'bg-rose-100 dark:bg-rose-950/40' },
  reserve_lifted: { Icon: CheckCircle2, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  action_done: { Icon: CheckSquare, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  decision: { Icon: Compass, cls: 'text-violet-600', ring: 'bg-violet-100 dark:bg-violet-950/40' },
  phase: { Icon: Trophy, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
}

export default async function SiteFriseMobilePage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  // La frise lisait des tables d'avant la connaissance : elle disait « visite
  // terrain » et s'arrêtait là, alors que la visite avait produit dix objets. On
  // lit désormais AUSSI le flux d'événements — le même que l'accueil, tourné vers
  // le passé. Une visite ne raconte plus « je suis venu » mais « voilà ce que j'ai
  // rapporté ».
  const [events, knowledge] = await Promise.all([
    buildSiteTimeline(siteId).catch(() => []),
    getSiteHistory(siteId).catch(() => []),
  ])

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Frise du chantier</h1>
        <p className="text-sm text-muted-foreground">L&apos;histoire du chantier, du plus récent au plus ancien.</p>
        <SiteTabs siteId={siteId} active="frise" userRole={user.role} />
      </header>

      {/* ── CE QUE MEMORIA A APPRIS ────────────────────────────────────────
          Le récit du chantier vu par la connaissance : « Synthèse créée »,
          « 3 actions proposées », « 3 échéances détectées », « 1 action
          confirmée ». Les mêmes faits que l'accueil — un seul flux, deux
          points de vue. Silence total s'il n'y a rien à raconter. */}
      {knowledge.length > 0 && (
        <ol className="space-y-3">
          {knowledge.map((entry) =>
            entry.kind === 'visit' ? (
              // La carte ENTIÈRE ouvre la synthèse : la visite EST sa synthèse, et
              // un bouton « Voir la synthèse » ferait croire à une seconde chose à
              // aller chercher. On touche la visite, on lit ce qu'elle a rapporté.
              <li key={entry.id}>
                <Link
                  href={`/m/visite/${entry.reportId}/cr`}
                  className="block rounded-xl border bg-card p-3 shadow-sm active:brightness-95"
                >
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{site.name}</span>
                  </p>
                  <p className="mt-1 font-medium">
                    {frDayMonthLocal(entry.at)} — {entry.isFirst ? 'Première visite' : 'Visite terrain'}
                  </p>
                  {/* Le geste terrain : la preuve que quelqu'un y est allé. */}
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {[
                      entry.durationMin ? `${entry.durationMin} min` : null,
                      entry.photos > 0 ? `${entry.photos} photo${entry.photos > 1 ? 's' : ''}` : null,
                      entry.vocals > 0 ? `${entry.vocals} mémo${entry.vocals > 1 ? 's' : ''}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || friseHeure.format(new Date(entry.at))}
                  </p>
                  {producedLines(entry.produced).length > 0 ? (
                    <>
                      <p className="mt-2 text-[13px] text-muted-foreground">MemorIA en a retenu :</p>
                      <ul className="mt-1 space-y-1">
                        {producedLines(entry.produced).map(({ key, Icon, cls, text }) => (
                          <li key={key} className="flex items-start gap-2 text-[13px] text-foreground/90">
                            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cls}`} />
                            <span className="min-w-0">{text}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-1 text-[13px] text-muted-foreground">Rien à retenir de cette visite.</p>
                  )}
                  <span className="mt-2 flex items-center gap-1 text-[13px] font-medium text-primary">
                    Consulter la synthèse <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </li>
            ) : (
              // La décision humaine reste un événement À PART : la visite dit ce que
              // MemorIA a compris, la décision dit ce que le conducteur en a fait.
              <li key={entry.id} className="rounded-xl border bg-muted/30 p-3">
                <p className="text-[12px] text-muted-foreground">
                  {frDayMonthLocal(entry.at)} · {friseHeure.format(new Date(entry.at))}
                </p>
                {/* « Guillaume confirme : » — une validation est un acte, et un acte
                    a un auteur. Sans nom, la frise dit qu'une main anonyme a décidé.
                    Faute de nom connu, on dit ce qui a été retenu, sans inventer. */}
                <p className="mt-0.5 text-[13px] font-medium">
                  {entry.by ? `${entry.by} confirme :` : entry.label}
                </p>
                {entry.title && (
                  <p className="mt-0.5 flex items-start gap-2 text-[13px] text-foreground/90">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="min-w-0">{entry.title}</span>
                  </p>
                )}
                {entry.by && <p className="mt-0.5 text-[12px] text-muted-foreground">{entry.label}</p>}
              </li>
            ),
          )}
        </ol>
      )}

      {events.length === 0 && knowledge.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Aucune activité pour l&apos;instant. Commencez à documenter ce chantier — visites, réunions et jalons apparaîtront ici.
          </p>
          <div className="flex justify-center"><VisitLauncher siteId={siteId} activeVisit={null} /></div>
        </div>
      ) : (
        <ol className="relative space-y-3 pl-2">
          {/* fil vertical de la frise */}
          <span aria-hidden className="absolute left-[22px] top-2 bottom-2 w-px bg-border" />
          {events.map((e, idx) => {
            // Garde-fou : un type inattendu ne doit jamais casser le rendu.
            const { Icon, cls, ring } = META[e.kind] ?? META.decision
            const body = (
              <>
                <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${e.star ? 'ring-2 ring-amber-400' : ''} ${ring}`}>
                  <Icon className={`h-[18px] w-[18px] ${cls}`} />
                  {e.star && (
                    <Star className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm leading-snug ${e.star ? 'font-semibold' : 'font-medium'}`}>{e.title}</span>
                  {e.detail && <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{e.detail}</span>}
                  <span className="mt-0.5 block text-[12px] text-muted-foreground first-letter:uppercase">{e.dateLabel}</span>
                </span>
                {e.href && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" />}
              </>
            )
            return (
              <li key={idx} className="relative">
                {e.href ? (
                  <Link href={e.href} className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 shadow-sm active:brightness-95">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border bg-card p-3">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/**
 * Ce que la visite a APPORTÉ, une ligne par type. Un zéro se tait : on ne liste
 * pas ce qui n'existe pas pour faire du volume.
 *
 * Le vocabulaire est celui du chantier, pas celui de la base : « 3 actions à
 * réaliser », jamais « 3 actions proposées » — `proposed` est un statut de table,
 * et le conducteur n'a pas à connaître nos statuts. (Cf.
 * [[vocabulaire-conducteur-jamais-developpeur]].)
 */
function producedLines(p: {
  actions: number
  deadlines: number
  stakeholders: number
  knowledge: number
  decisions: number
  watchpoints: number
}): Array<{ key: string; Icon: typeof Users; cls: string; text: string }> {
  const s = (n: number) => (n > 1 ? 's' : '')
  const out: Array<{ key: string; Icon: typeof Users; cls: string; text: string }> = []
  if (p.actions > 0)
    out.push({ key: 'a', Icon: CheckSquare, cls: 'text-emerald-600', text: `${p.actions} action${s(p.actions)} à réaliser` })
  if (p.deadlines > 0)
    out.push({ key: 'd', Icon: CalendarClock, cls: 'text-sky-600', text: `${p.deadlines} échéance${s(p.deadlines)} à tenir` })
  if (p.watchpoints > 0)
    out.push({ key: 'w', Icon: AlertTriangle, cls: 'text-amber-600', text: `${p.watchpoints} point${s(p.watchpoints)} de vigilance` })
  if (p.stakeholders > 0)
    out.push({ key: 's', Icon: Users, cls: 'text-violet-600', text: `${p.stakeholders} intervenant${s(p.stakeholders)} identifié${s(p.stakeholders)}` })
  if (p.knowledge > 0)
    out.push({ key: 'k', Icon: Info, cls: 'text-slate-600', text: `${p.knowledge} information${s(p.knowledge)} importante${s(p.knowledge)}` })
  if (p.decisions > 0)
    out.push({ key: 'c', Icon: Compass, cls: 'text-violet-600', text: `${p.decisions} décision${s(p.decisions)} relevée${s(p.decisions)}` })
  return out
}
