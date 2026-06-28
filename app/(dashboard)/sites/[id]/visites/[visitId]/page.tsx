import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, StickyNote, ListTodo, ClipboardCheck, Paperclip, Mic, Clock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { gatherVisitDebriefContext } from '@/lib/db/visits'
import { VisitDebriefPanel } from './VisitDebriefPanel'
import { CapturedKnowledgePanel } from './CapturedKnowledgePanel'
import { GenerateCrButton } from './GenerateCrButton'
import { listCapturedKnowledgeBySource } from '@/lib/db/captured-knowledge'
import { listVisitTouchedDossiers } from '@/lib/db/living-dossier'

export const dynamic = 'force-dynamic'

const ORIGIN_LABEL: Record<string, string> = { planned: 'Planifiée', spontaneous: 'Spontanée', qr: 'QR', gps: 'GPS' }
const STATE_FR: Record<string, string> = { bloqué: 'Bloqué', en_attente: 'En attente', dormant: 'En sommeil', ouvert: 'Ouvert', clos: 'Clos' }
const STATE_CLS: Record<string, string> = {
  bloqué: 'bg-rose-100 text-rose-700', en_attente: 'bg-amber-100 text-amber-800',
  dormant: 'bg-slate-100 text-slate-600', ouvert: 'bg-sky-100 text-sky-700', clos: 'bg-emerald-100 text-emerald-700',
}

export default async function VisitDebriefPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, ctx] = await Promise.all([getSiteIdentity(id), gatherVisitDebriefContext(visitId)])
  if (!identity || !ctx || ctx.visit.site_id !== id) notFound()
  const { visit } = ctx
  const knowledge = await listCapturedKnowledgeBySource(visit.id).catch(() => [])
  // Les dossiers (points suivis) touchés par cette visite, avec leur état actuel
  // — lu du même moteur que la page point suivi et le brief (une seule vérité).
  const touchedDossiers = await listVisitTouchedDossiers(visit.id).catch(() => [])

  const fr = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  const durMins = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null
  const durLabel = durMins == null ? null : durMins < 60 ? `${durMins} min` : `${Math.floor(durMins / 60)} h ${durMins % 60} min`

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}/visites`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Visites
      </Link>

      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{identity.name}</p>
        <h1 className="text-2xl font-bold">Débrief de chantier</h1>
        <p className="text-sm text-muted-foreground">
          Déclenché par une visite · {fr(visit.started_at ?? visit.created_at)} · {ORIGIN_LABEL[visit.origin ?? ''] ?? 'Visite'}
          {visit.ended_at ? '' : ' · en cours'}
        </p>
      </header>

      {/* Ce que MemorIA a VU — la matière brute, avant toute interprétation. */}
      <section className="rounded-2xl border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ce que MemorIA a vu</h2>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {durLabel && <Stat icon={<Clock className="h-3.5 w-3.5" />} n={null} label={durLabel} />}
          <Stat icon={<Mic className="h-3.5 w-3.5" />} n={ctx.transcript ? 1 : 0} label="vocal" />
          <Stat icon={<Paperclip className="h-3.5 w-3.5" />} n={ctx.attachmentNames.length} label="pièce" />
          <Stat icon={<StickyNote className="h-3.5 w-3.5" />} n={ctx.capturedNotes.length} label="note" />
          <Stat icon={<ClipboardCheck className="h-3.5 w-3.5" />} n={ctx.capturedReserves.length} label="réserve" />
          <Stat icon={<ListTodo className="h-3.5 w-3.5" />} n={ctx.capturedActions.length} label="action" />
        </div>
        {ctx.attachmentNames.length > 0 && (
          <p className="text-xs text-muted-foreground">Documents : {ctx.attachmentNames.join(' · ')}</p>
        )}
        {ctx.capturedNotes.length > 0 && (
          <ul className="space-y-1 text-sm">
            {ctx.capturedNotes.map((n, i) => (
              <li key={i} className="rounded-lg bg-muted/50 px-3 py-2">{n}</li>
            ))}
          </ul>
        )}
        {ctx.transcript && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground line-clamp-4">{ctx.transcript}</p>
        )}
        {ctx.capturedNotes.length === 0 && !ctx.transcript && ctx.attachmentNames.length === 0 && (
          <p className="text-sm text-muted-foreground">Rien n’a encore été capturé pour cette visite.</p>
        )}
      </section>

      {/* Dossiers touchés — « tu as vérifié ces points : voici où en sont leurs
          dossiers » (état lu du moteur unique). La visite parle aux dossiers. */}
      {touchedDossiers.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Dossiers touchés par cette visite
          </h2>
          <ul className="space-y-1.5">
            {touchedDossiers.map((d) => (
              <li key={d.id} className="rounded-lg border bg-background px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/sites/${id}/subjects/${d.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_CLS[d.state] ?? 'bg-muted text-muted-foreground'}`}>
                    {STATE_FR[d.state] ?? d.state}
                  </span>
                </div>
                {d.cause && <p className="mt-0.5 text-[11px] text-muted-foreground">{d.cause}</p>}
                {(d.openActions > 0 || d.openReserves > 0) && (
                  <p className="text-[11px] text-muted-foreground">
                    {[
                      d.openActions ? `${d.openActions} action${d.openActions > 1 ? 's' : ''}` : null,
                      d.openReserves ? `${d.openReserves} réserve${d.openReserves > 1 ? 's' : ''}` : null,
                    ].filter(Boolean).join(' · ')} ouvert{d.openActions + d.openReserves > 1 ? 'es' : 'e'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* À retenir — capter la connaissance utile (promesses, risques, pièges…),
          reliée à un point pour ressortir plus tard. Saisie manuelle (l'IA viendra). */}
      <CapturedKnowledgePanel
        siteId={id}
        reportId={visit.id}
        openSubjects={ctx.openSubjects}
        initial={knowledge}
      />

      {/* Débrief IA : propose, l'humain valide. Rien n'est écrit sans validation. */}
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

      {/* Le CR : projection du Débrief validé (une sortie, pas le cœur). */}
      <GenerateCrButton reportId={visit.id} />
    </div>
  )
}

function Stat({ icon, n, label }: { icon: React.ReactNode; n: number | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
      {icon}
      {n == null ? label : `${n} ${label}${n > 1 ? 's' : ''}`}
    </span>
  )
}
