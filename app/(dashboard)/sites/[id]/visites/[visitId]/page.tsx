import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, StickyNote, ListTodo, ClipboardCheck, Paperclip, Mic, Clock } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { gatherVisitDebriefContext } from '@/lib/db/visits'
import { VisitDebriefPanel } from './VisitDebriefPanel'
import { GenerateCrButton } from './GenerateCrButton'

export const dynamic = 'force-dynamic'

const ORIGIN_LABEL: Record<string, string> = { planned: 'Planifiée', spontaneous: 'Spontanée', qr: 'QR', gps: 'GPS' }

export default async function VisitDebriefPage({ params }: { params: Promise<{ id: string; visitId: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, ctx] = await Promise.all([getSiteIdentity(id), gatherVisitDebriefContext(visitId)])
  if (!identity || !ctx || ctx.visit.site_id !== id) notFound()
  const { visit } = ctx

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
