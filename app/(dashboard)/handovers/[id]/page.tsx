// /handovers/[id] — Vue détail authentifiée d'un brief.
//
// Vincent 2026-05-22 — Sprint Équipes C. Admin + manager.
//
// Affiche :
//   - Header avec statut, kind, dates, sujets liés
//   - Payload via HandoverPayloadView
//   - Notes manuelles éditables (textarea + bouton enregistrer)
//   - Actions : Partager (génère token), Marquer comme reconnu, Archiver
//   - Si partagé : URL publique + stats consultations
//
// Doctrine : le brief est lecture seule pour le payload (snapshot immuable).
// SEULS les notes manuelles + statut peuvent être modifiés.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Archive,
  Share2,
  Clock,
  Eye,
  Calendar,
  Users,
  Building2,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getHandoverBrief } from '@/lib/db/handover'
import { getTeam } from '@/lib/db/teams'
import { createAdminClient } from '@/lib/supabase/admin'
import { TeamBadge } from '@/components/ui/team-badge'
import { HandoverPayloadView } from '../HandoverPayloadView'
import { HandoverActions } from './HandoverActions'
import { HandoverNotesEditor } from './HandoverNotesEditor'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  member_change: 'Changement d’équipe',
  team_takes_site: 'Prise de site',
  manual: 'Brief ad-hoc',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'À transmettre',
  shared: 'Partagé',
  acknowledged: 'Reconnu',
  archived: 'Archivé',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-sky-50 text-sky-800 border-sky-200',
  shared: 'bg-violet-50 text-violet-800 border-violet-200',
  acknowledged: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  archived: 'bg-muted text-muted-foreground border-border',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function HandoverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const me = await getCurrentUserWithProfile()
  if (!me) redirect('/login')
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/m')

  const { id } = await params
  const brief = await getHandoverBrief(id)
  if (!brief) notFound()

  // Charger les sujets liés (subject_user, source_team, target_team)
  const admin = createAdminClient()
  const [subjectUser, sourceTeam, targetTeam] = await Promise.all([
    brief.subject_user_id
      ? admin
          .from('users')
          .select('id, full_name, email')
          .eq('id', brief.subject_user_id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    brief.source_team_id ? getTeam(brief.source_team_id) : Promise.resolve(null),
    brief.target_team_id ? getTeam(brief.target_team_id) : Promise.resolve(null),
  ])

  const subjectLabel = subjectUser
    ? (subjectUser.full_name ?? '').trim() || subjectUser.email
    : null

  // URL absolue pour le partage
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const shareUrl = brief.shared_token ? `${baseUrl}/h/${brief.shared_token}` : null

  const expired =
    brief.expires_at != null && new Date(brief.expires_at) < new Date()

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/handovers" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Passages de témoin
        </Link>
        <span>›</span>
        <span className="text-foreground font-medium truncate">{brief.title}</span>
      </div>

      {/* Header */}
      <header className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded border ${
                  STATUS_BADGE[brief.status] ?? STATUS_BADGE.draft
                }`}
              >
                {STATUS_LABEL[brief.status]}
              </span>
              <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                <ArrowRightLeft className="h-3 w-3 inline mr-0.5" />
                {KIND_LABEL[brief.kind] ?? brief.kind}
              </span>
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Créé le {fmtDateTime(brief.created_at)}
              </span>
            </div>
            <h1 className="text-xl font-semibold leading-tight">{brief.title}</h1>
          </div>
        </div>

        {/* Sujets liés */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-xs">
          {subjectLabel && (
            <Link
              href={`/intervenants/${brief.subject_user_id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 hover:bg-muted transition-colors"
            >
              <Users className="h-3 w-3" />
              <span>Sujet : {subjectLabel}</span>
            </Link>
          )}
          {sourceTeam && (
            <Link
              href={`/equipes/${sourceTeam.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">De</span>
              <TeamBadge
                name={sourceTeam.name}
                color={sourceTeam.color}
                icon={sourceTeam.icon}
                size="sm"
              />
            </Link>
          )}
          {targetTeam && (
            <Link
              href={`/equipes/${targetTeam.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">Vers</span>
              <TeamBadge
                name={targetTeam.name}
                color={targetTeam.color}
                icon={targetTeam.icon}
                size="sm"
              />
            </Link>
          )}
          {brief.site_id && (
            <Link
              href={`/sites/${brief.site_id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 hover:bg-muted transition-colors"
            >
              <Building2 className="h-3 w-3" />
              <span>Voir le site</span>
            </Link>
          )}
        </div>

        {/* Bloc partage si déjà partagé */}
        {brief.shared_token && (
          <div
            className={`rounded-md border px-3 py-2 text-xs space-y-1 ${
              expired
                ? 'border-rose-300 bg-rose-50/50 dark:bg-rose-950/20'
                : 'border-violet-300 bg-violet-50/50 dark:bg-violet-950/20'
            }`}
          >
            <p className="font-medium flex items-center gap-1.5">
              <Share2 className="h-3 w-3" />
              {expired ? 'Lien expiré' : 'Lien de partage actif'}
            </p>
            {!expired && shareUrl && (
              <p className="font-mono text-[11px] break-all text-violet-900 dark:text-violet-200">
                {shareUrl || `/h/${brief.shared_token}`}
              </p>
            )}
            <p className="text-muted-foreground">
              {brief.expires_at && (
                <>
                  <Clock className="h-3 w-3 inline mr-1" />
                  {expired ? 'Expiré le ' : 'Expire le '}
                  {fmtDateTime(brief.expires_at)}
                </>
              )}
              {brief.access_count > 0 && (
                <>
                  {' · '}
                  <Eye className="h-3 w-3 inline mr-1" />
                  {brief.access_count} consultation{brief.access_count > 1 ? 's' : ''}
                  {brief.last_accessed_at && (
                    <> (dern. {fmtDateTime(brief.last_accessed_at)})</>
                  )}
                </>
              )}
            </p>
          </div>
        )}

        {/* Accusé de réception */}
        {brief.status === 'acknowledged' && brief.acknowledged_at && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 text-xs">
            <CheckCircle2 className="h-3 w-3 inline mr-1.5 text-emerald-600" />
            Reconnu le {fmtDateTime(brief.acknowledged_at)}
          </div>
        )}
      </header>

      {/* Actions */}
      <HandoverActions
        briefId={brief.id}
        status={brief.status}
        sharedToken={brief.shared_token}
        expiresAt={brief.expires_at}
      />

      {/* Notes manuelles éditables */}
      <HandoverNotesEditor
        briefId={brief.id}
        initialNotes={brief.payload.manualNotes}
        disabled={brief.status === 'archived'}
      />

      {/* Payload — vue server */}
      <HandoverPayloadView payload={brief.payload} publicView={false} />

      {/* Footer doctrine */}
      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        Snapshot immuable. Le contenu ci-dessus reflète l’état au moment de la
        génération. Le brief documente le site et la mémoire utile à transmettre,
        jamais la personne qui s&apos;en va.
      </p>
    </div>
  )
}
