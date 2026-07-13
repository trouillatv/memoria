import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Camera,
  Check,
  ClipboardCheck,
  FileDown,
  Home,
  Images,
  ListTodo,
  Mic,
  Share2,
  StickyNote,
  Video,
  X,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { gatherVisitDebriefContext } from '@/lib/db/visits'
import { listVisitCaptures } from '@/lib/db/visit-captures'
import { listWatchlist } from '@/lib/db/visit-watchlist'
import { listCapturedKnowledgeBySource } from '@/lib/db/captured-knowledge'
import { listVisitTouchedDossiers } from '@/lib/db/living-dossier'
import {
  buildVisitPreparationCopy,
  buildVisitSourceItems,
  describePreparationConfidence,
  estimatePreparationQuality,
} from '@/lib/visits/debrief-preparation'
import { VisitShareButton } from '@/app/(field)/m/visite/[reportId]/VisitShareButton'
import { VisitDebriefPanel } from './VisitDebriefPanel'
import { CapturedKnowledgePanel } from './CapturedKnowledgePanel'

export const dynamic = 'force-dynamic'

const ORIGIN_LABEL: Record<string, string> = { planned: 'Planifiee', spontaneous: 'Spontanee', qr: 'QR', gps: 'GPS' }
const STATE_FR: Record<string, string> = { 'bloqué': 'Bloque', en_attente: 'En attente', dormant: 'En sommeil', ouvert: 'Ouvert', clos: 'Clos' }
const STATE_CLS: Record<string, string> = {
  'bloqué': 'bg-rose-100 text-rose-700',
  en_attente: 'bg-amber-100 text-amber-800',
  dormant: 'bg-slate-100 text-slate-600',
  ouvert: 'bg-sky-100 text-sky-700',
  clos: 'bg-emerald-100 text-emerald-700',
}
const WATCH_FR: Record<string, string> = {
  verified: 'Verifie',
  to_follow: 'A suivre',
  dismissed: 'Ecarte',
  pending: 'Non traite',
}
const WATCH_CLS: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-700',
  to_follow: 'bg-amber-100 text-amber-800',
  dismissed: 'bg-slate-100 text-slate-500',
  pending: 'bg-muted text-muted-foreground',
}

export default async function VisitDebriefPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, ctx] = await Promise.all([getSiteIdentity(id), gatherVisitDebriefContext(visitId)])
  if (!identity || !ctx || ctx.visit.site_id !== id) notFound()

  const { visit } = ctx
  const [knowledge, touchedDossiers, capturesAll, watchlist] = await Promise.all([
    listCapturedKnowledgeBySource(visit.id).catch(() => []),
    listVisitTouchedDossiers(visit.id).catch(() => []),
    listVisitCaptures(visit.id).catch(() => []),
    listWatchlist(visit.id).catch(() => []),
  ])

  const captures = capturesAll.filter((capture) => capture.status !== 'discarded')
  const photos = captures.filter((capture) => capture.kind === 'photo')
  const videos = captures.filter((capture) => capture.kind === 'video')
  const vocals = captures.filter((capture) => capture.kind === 'vocal')
  const capNotes = captures.filter((capture) => capture.kind === 'note' && capture.body)

  const preparationInput = {
    photos: photos.length,
    videos: videos.length,
    vocals: vocals.length,
    notes: capNotes.length,
  }
  const preparationCopy = buildVisitPreparationCopy(preparationInput)
  const sourceItems = buildVisitSourceItems(preparationInput)
  const qualityLevel = estimatePreparationQuality(preparationInput)
  const preparationConfidence = describePreparationConfidence(qualityLevel)

  const fr = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <Link href={`/sites/${id}/visites`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Visites
      </Link>

      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">{identity.name}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Debrief de chantier</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Visite terminee - {fr(visit.started_at ?? visit.created_at)} - {ORIGIN_LABEL[visit.origin ?? ''] ?? 'Visite'}
              {visit.ended_at ? '' : ' - en cours'}
            </p>
          </div>
          <Link
            href={`/sites/${id}`}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Home className="h-4 w-4" /> Retour au chantier
          </Link>
        </div>
      </header>

      <nav className="grid gap-2 sm:grid-cols-4">
        <StepPill number="1" label="Collecte" className="border-sky-200 bg-sky-50 text-sky-900" />
        <StepPill number="2" label="Preparation" className="border-violet-200 bg-violet-50 text-violet-900" />
        <StepPill number="3" label="Compte rendu" className="border-emerald-200 bg-emerald-50 text-emerald-900" />
        <StepPill number="4" label="Retour chantier" className="border-orange-200 bg-orange-50 text-orange-900" />
      </nav>

      <StepCard
        number="1"
        title="Collecte"
        kicker="Ce qui a ete enregistre"
        tone="border-sky-200 bg-sky-50/50"
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryPill icon={<Camera className="h-4 w-4" />} label={`${photos.length} photo${photos.length > 1 ? 's' : ''}`} />
          <SummaryPill icon={<Video className="h-4 w-4" />} label={`${videos.length} video${videos.length > 1 ? 's' : ''}`} />
          <SummaryPill icon={<Mic className="h-4 w-4" />} label={`${vocals.length} vocal${vocals.length > 1 ? 's' : ''}`} />
          <SummaryPill icon={<StickyNote className="h-4 w-4" />} label={`${capNotes.length} note${capNotes.length > 1 ? 's' : ''}`} />
        </div>

        <div className="rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Captures de la visite</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Les photos, vocaux, videos, notes et positions restent consultables dans l experience mobile.
              </p>
            </div>
            <Link
              href={`/m/visite/${visit.id}/recap`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Images className="h-4 w-4" /> Ouvrir la visite mobile
            </Link>
          </div>
        </div>

        {watchlist.length > 0 && (
          <div className="rounded-xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Points verifies</h3>
            <ul className="mt-2 space-y-1.5">
              {watchlist.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0 truncate text-sm">{item.label}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${WATCH_CLS[item.state] ?? 'bg-muted text-muted-foreground'}`}>
                    {WATCH_FR[item.state] ?? item.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </StepCard>

      <StepCard
        number="2"
        title="Preparation du compte rendu"
        kicker={preparationCopy.title}
        tone="border-violet-200 bg-violet-50/50"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border bg-background p-4">
            <p className="text-sm leading-relaxed">{preparationCopy.body}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <SourceList title="MemorIA utilisera" items={sourceItems.used} icon="check" />
              <SourceList title="Ne sera pas utilise" items={sourceItems.missing} icon="x" muted />
            </div>
          </div>

          <div className="rounded-xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Sources disponibles</h3>
            <p className="mt-3 inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
              {preparationConfidence.label}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {preparationConfidence.body}
            </p>
          </div>
        </div>
      </StepCard>

      <StepCard
        number="3"
        title="Premiere version"
        kicker="Relire puis valider"
        tone="border-emerald-200 bg-emerald-50/50"
      >
        <VisitDebriefPanel
          siteId={id}
          reportId={visit.id}
          openSubjects={ctx.openSubjects}
          initial={{
            objective: visit.objective ?? '',
            outcome: visit.outcome,
            resolution: visit.resolution,
            targetSubjectId: visit.target_subject_id,
          }}
        />
      </StepCard>

      <StepCard
        number="4"
        title="Retour chantier"
        kicker="Apres validation"
        tone="border-orange-200 bg-orange-50/50"
      >
        {touchedDossiers.length > 0 && (
          <div className="rounded-xl border bg-background p-4">
            <h3 className="text-sm font-semibold">Dossiers touches par cette visite</h3>
            <ul className="mt-2 space-y-1.5">
              {touchedDossiers.map((dossier) => (
                <li key={dossier.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/sites/${id}/subjects/${dossier.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {dossier.name}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CLS[dossier.state] ?? 'bg-muted text-muted-foreground'}`}>
                      {STATE_FR[dossier.state] ?? dossier.state}
                    </span>
                  </div>
                  {dossier.cause && <p className="mt-0.5 text-[11px] text-muted-foreground">{dossier.cause}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <CapturedKnowledgePanel
          siteId={id}
          reportId={visit.id}
          openSubjects={ctx.openSubjects}
          initial={knowledge}
        />

        <div className="rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Debrief termine</h3>
              <p className="mt-1 text-sm text-muted-foreground">Le chantier a ete mis a jour. Que souhaitez-vous faire maintenant ?</p>
            </div>
            <Link
              href={`/sites/${id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              <Home className="h-4 w-4" /> Retour au chantier
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Share2 className="h-4 w-4" /> Partager
              </div>
              <p className="mb-3 text-xs text-muted-foreground">Photos, vocal, video et compte rendu.</p>
              <VisitShareButton reportId={visit.id} siteName={identity.name} />
            </div>
            <ActionTile href={`/m/visite/${visit.id}/pdf`} icon={<FileDown className="h-4 w-4" />} title="Telecharger le CR" />
            <ActionTile href={`/sites/${id}/actions`} icon={<ListTodo className="h-4 w-4" />} title="Creer une action" />
            <ActionTile href={`/sites/${id}/reserves`} icon={<ClipboardCheck className="h-4 w-4" />} title="Creer une reserve" />
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Plus</summary>
            <div className="mt-2">
              <Link href={`/m/visite/${visit.id}/recap`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <Images className="h-4 w-4" /> Ouvrir la visite dans l experience mobile
              </Link>
            </div>
          </details>
        </div>
      </StepCard>
    </div>
  )
}

function StepPill({ number, label, className }: { number: string; label: string; className: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-xs font-bold">{number}</span>
      {label}
    </div>
  )
}

function StepCard({
  number,
  title,
  kicker,
  tone,
  children,
}: {
  number: string
  title: string
  kicker: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <section className={`space-y-4 rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-sm font-bold">{number}</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{kicker}</p>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

function SummaryPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-sm font-medium">
      {icon}
      {label}
    </div>
  )
}

function SourceList({ title, items, icon, muted = false }: { title: string; items: Array<{ label: string }>; icon: 'check' | 'x'; muted?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className={`flex items-center gap-2 text-sm ${muted ? 'text-muted-foreground' : ''}`}>
            {icon === 'check' ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionTile({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) {
  return (
    <Link href={href} className="flex min-h-28 flex-col justify-between rounded-xl border p-3 text-sm font-semibold hover:bg-muted/50">
      <span className="flex items-center gap-2">{icon}{title}</span>
      <span className="text-xs font-normal text-muted-foreground">Ouvrir</span>
    </Link>
  )
}
