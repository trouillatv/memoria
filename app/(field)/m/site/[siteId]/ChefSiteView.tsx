import Link from 'next/link'
import {
  MapPin, Navigation, Play, RotateCcw, ChevronRight, AlertTriangle,
  ListTodo, FileText, FileImage, File as FileIcon, ExternalLink, Wrench,
} from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { listActiveTeamIdsForUser } from '@/lib/db/teams'
import { listOpenSiteActions } from '@/lib/db/site-actions'
import { getSiteAnomalies } from '@/lib/db/site-cockpit'
import { getSiteCoverPhoto } from '@/lib/db/site-cover'
import { getSiteRecentActivity } from '@/lib/db/visits'
import { listDocumentsForTarget } from '@/lib/db/documents'
import { ensureTodayInterventionsForSites } from '@/lib/recurrence/ensure-today'
import { todayLocalIso } from '@/lib/time/local-date'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { SiteAccessCard } from '../../intervention/[id]/SiteAccessCard'
import { SiteActivityCard } from './SiteActivityCard'
import type { DocumentType } from '@/types/db'

/**
 * Fiche chantier TERRAIN — l'expérience du chef d'équipe (exécutant).
 *
 * Doctrine (Vincent 2026-07-29) : « le conducteur organise, le chef exécute ».
 * Ce n'est PAS une fiche manager amputée mais une page conçue pour lui. Test de
 * réussite : un chef qui ne connaît pas MemorIA peut intervenir sans jamais
 * revenir sur une vue manager.
 *
 * Chaque bloc répond à « est-ce que ça aide le chef à réussir son intervention
 * aujourd'hui ? ». Hiérarchie centrée sur l'action :
 *   1. Où je vais (nom + adresse + itinéraire)
 *   2. Mon intervention ici (le héros)
 *   3. Accès & contacts (codes, tel)
 *   4. Alertes (anomalies ouvertes)
 *   5. À faire ici (actions)
 *   6. Documents terrain (plans, procédures, sécurité — jamais le contractuel)
 *   7. Récemment (ce qui impacte son travail)
 *
 * Exclu volontairement : santé chiffrée, IA exploratoire, mémoire complète,
 * budget, contractuel, AO, réseau d'intervenants, statistiques, rituels de
 * préparation (visite/réunion), outils de création, travail des autres équipes.
 */

// Types de documents « terrain » visibles par le chef. Le contractuel
// (contrat, avenant, ao, memoire_technique, litige, facture) et l'ambigu
// (autre) sont exclus par sécurité — jamais de fuite de pilotage.
const FIELD_DOC_TYPES: DocumentType[] = [
  'plan_acces', 'procedure', 'protocole', 'securite', 'reference', 'preuve',
]

const DOC_SIGNED_TTL = 300

const INTV_STATUS_META: Record<string, { label: string; cls: string }> = {
  planned: { label: 'Prévue', cls: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'En cours', cls: 'bg-sky-100 text-sky-700' },
  completed: { label: 'Terminée', cls: 'bg-emerald-100 text-emerald-700' },
  validated: { label: 'Validée', cls: 'bg-emerald-100 text-emerald-700' },
}

function docIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return FileImage
  if (ext === 'pdf') return FileText
  return FileIcon
}

export async function ChefSiteView({
  siteId,
  userId,
}: {
  siteId: string
  userId: string
}) {
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, address, access_code, alarm_code, contact_name, contact_phone, access_hours, access_instructions')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) return null

  const teamIds = await listActiveTeamIdsForUser(userId)
  const todayIso = todayLocalIso()
  await ensureTodayInterventionsForSites([siteId], 4).catch(() => {})

  // Missions du chantier (id + nom) pour résoudre les interventions du chef.
  const { data: missionRows } = await supabase
    .from('missions')
    .select('id, name')
    .eq('site_id', siteId)
    .is('deleted_at', null)
  const missionName = new Map((missionRows ?? []).map((m) => [m.id as string, m.name as string]))
  const missionIds = [...missionName.keys()]

  // Interventions de MON équipe sur ce chantier — aujourd'hui + à venir (héros).
  // Jamais le travail des autres équipes : filtre assigned_team_id.
  type IntvRow = { id: string; status: string; scheduled_for: string | null; slot: 'morning' | 'afternoon' | 'evening' | null; planned_start: string | null; planned_end: string | null; mission_id: string; label: string | null }
  let interventions: IntvRow[] = []
  if (missionIds.length > 0 && teamIds.length > 0) {
    const { data } = await supabase
      .from('interventions')
      .select('id, status, scheduled_for, slot, planned_start, planned_end, mission_id, label')
      .in('mission_id', missionIds)
      .in('assigned_team_id', teamIds)
      .in('status', ['planned', 'in_progress'])
      .gte('scheduled_for', todayIso)
      .order('scheduled_for', { ascending: true })
      .order('planned_start', { ascending: true, nullsFirst: true })
      .limit(4)
    interventions = (data ?? []) as IntvRow[]
  }

  const [openActions, siteAnomalies, cover, recentActivity, docsRaw] = await Promise.all([
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    getSiteAnomalies(siteId).catch(() => []),
    getSiteCoverPhoto(siteId).catch(() => null),
    getSiteRecentActivity(siteId).catch(() => []),
    listDocumentsForTarget('site', siteId).catch(() => []),
  ])
  const openAnomalies = siteAnomalies.filter((a) => a.status === 'open')

  // Documents TERRAIN uniquement, avec URL signée courte.
  const fieldDocs = docsRaw.filter((d) => FIELD_DOC_TYPES.includes(d.document_type))
  const signedDocs = await Promise.all(
    fieldDocs.map(async (d) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, DOC_SIGNED_TTL)
      return { id: d.id, filename: d.filename || 'Document', url: data?.signedUrl ?? null }
    }),
  )

  const mapsHref = site.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(site.address)}`
    : null

  return (
    <div className="max-w-md space-y-5 pb-28">
      {/* 1 — OÙ JE VAIS : la destination, en clair. */}
      <header className="space-y-2">
        {cover && (
          <div className="overflow-hidden rounded-2xl border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover.url} alt={`Photo du chantier ${site.name}`} className="h-36 w-full object-cover" />
          </div>
        )}
        <h1 className="text-2xl font-bold leading-tight">{site.name}</h1>
        {site.address && (
          <div className="flex items-start justify-between gap-3">
            <p className="inline-flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{site.address}</span>
            </p>
            {mapsHref && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium active:scale-[0.97]"
              >
                <Navigation className="h-3.5 w-3.5" /> Itinéraire
              </a>
            )}
          </div>
        )}
      </header>

      {/* 2 — MON INTERVENTION ICI : le héros. Ce que je viens faire. */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mon intervention ici
        </h2>
        {interventions.length > 0 ? (
          <ul className="space-y-2">
            {interventions.map((i, idx) => {
              const inProgress = i.status === 'in_progress'
              const time = formatInterventionTimeLabel({ planned_start: i.planned_start, planned_end: i.planned_end, slot: i.slot })
              const isToday = i.scheduled_for === todayIso
              const name = i.label ?? missionName.get(i.mission_id) ?? 'Intervention'
              // Le premier (le plus proche) est mis en avant comme CTA.
              if (idx === 0) {
                const dayLabel = isToday
                  ? "Aujourd'hui"
                  : i.scheduled_for
                    ? new Date(i.scheduled_for + 'T00:00:00.000Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
                    : ''
                return (
                  <li key={i.id}>
                    <Link
                      href={`/m/intervention/${i.id}`}
                      className="flex items-center gap-3 rounded-2xl bg-emerald-600 px-4 py-3.5 text-white active:bg-emerald-700"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
                        {inProgress ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-snug">
                          {inProgress ? 'Reprendre mon intervention' : 'Commencer mon intervention'}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-white/85">
                          {name}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-white/70 first-letter:uppercase">
                          {dayLabel}{time ? ` · ${time}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-white/80" />
                    </Link>
                  </li>
                )
              }
              const meta = INTV_STATUS_META[i.status] ?? INTV_STATUS_META.planned
              const dayShort = isToday
                ? "Auj."
                : i.scheduled_for
                  ? new Date(i.scheduled_for + 'T00:00:00.000Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
                  : ''
              return (
                <li key={i.id}>
                  <Link
                    href={`/m/intervention/${i.id}`}
                    className="flex items-center gap-2.5 rounded-xl border bg-muted/30 px-3.5 py-2.5 active:brightness-95"
                  >
                    <Wrench className="h-4 w-4 shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground first-letter:uppercase">{dayShort}{time ? ` ${time}` : ''}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
            Aucune intervention prévue pour votre équipe ici pour l&apos;instant.
          </p>
        )}
      </section>

      {/* 3 — ACCÈS & CONTACTS : où j'entre, qui j'appelle (carte dédiée chef). */}
      <SiteAccessCard site={site} />

      {/* 4 — ALERTES : les anomalies ouvertes déclarées ici. */}
      {openAnomalies.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Alertes
          </h2>
          <ul className="space-y-1.5">
            {openAnomalies.slice(0, 4).map((a) => (
              <li key={a.id} className="flex gap-1.5 text-sm text-amber-900">
                <span aria-hidden>⚠</span>
                <span className="min-w-0">{a.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 5 — À FAIRE ICI : les actions ouvertes sur ce chantier. */}
      {openActions.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <ListTodo className="h-4 w-4" /> À faire ici
          </h2>
          <ul className="overflow-hidden rounded-2xl border bg-card divide-y">
            {openActions.slice(0, 6).map((a) => {
              const late = a.due_date ? a.due_date.slice(0, 10) < todayIso : false
              return (
                <li key={a.id}>
                  <Link href={`/m/actions?site=${siteId}`} className="flex items-center gap-2.5 px-3.5 py-3 active:bg-accent">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${late ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span className="min-w-0 flex-1 text-sm">{a.title}</span>
                    {a.due_date && (
                      <span className={`shrink-0 text-[11px] ${late ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                        {late ? 'en retard' : new Date(a.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Pacific/Noumea' })}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 6 — DOCUMENTS TERRAIN : plans, procédures, sécurité (jamais le contractuel). */}
      {signedDocs.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-4 w-4" /> Documents terrain
          </h2>
          <ul className="overflow-hidden rounded-2xl border bg-card divide-y">
            {signedDocs.map((d) => {
              const Icon = docIcon(d.filename)
              return (
                <li key={d.id}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3.5 py-3 active:bg-accent">
                      <Icon className="h-5 w-5 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.filename}</span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <div className="flex items-center gap-3 px-3.5 py-3 opacity-60">
                      <Icon className="h-5 w-5 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.filename}</span>
                      <span className="text-[11px] text-muted-foreground">indisponible</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 7 — RÉCEMMENT : ce qui s'est passé ici et qui impacte mon travail. */}
      <SiteActivityCard items={recentActivity} />
    </div>
  )
}
