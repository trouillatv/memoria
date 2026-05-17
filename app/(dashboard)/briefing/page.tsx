// Slice M2 — Briefing du soir (Doctrine V5 Pilier 3)
//
// Page Maeva consulte le soir vers 18h pour "se coucher en paix". Affiche
// les chiffres clés du LENDEMAIN. Pas d'auto-send email (out of scope sans
// infra mail). Maeva bookmark la page, ouvre le lien à 18h. Cron Vercel
// possible plus tard.
//
// Doctrine V5 :
//   - Agrégats uniquement. JAMAIS de nom d'agent.
//   - "Sans couverture" = signal logistique, pas une alarme.
//   - Wording calme, pro, rassurant. Pas d'urgence injonctive.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarCheck,
  Users,
  MapPin,
  AlertTriangle,
  ShieldCheck,
  FileCheck,
  Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { buildEveningBriefing, tomorrowUtcIso } from '@/lib/db/evening-briefing'
import { getTenantDayReading, generateSiteReadings } from '@/lib/ai/site-readings'
import { ReadingCard } from '@/components/ui/reading-card'
import { generateChefEquipePreparations } from '@/lib/db/chef-equipe-preparation'
import { TeamCompositionPopover } from './TeamCompositionPopover'
import { SiteNotesPopover } from './SiteNotesPopover'
import { BriefingShareModal } from './BriefingShareModal'
import { EnvoisSection } from './EnvoisSection'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS_FR = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
]
const SLOT_FR: Record<string, string> = {
  morning: 'matin',
  afternoon: 'après-midi',
  evening: 'soir',
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d))
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const month = MONTHS_FR_FULL[(m ?? 1) - 1] ?? ''
  return `${weekday} ${d} ${month} ${y}`
}

export default async function BriefingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const params = await searchParams
  const target = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : tomorrowUtcIso()

  const [briefing, preparations] = await Promise.all([
    buildEveningBriefing(target),
    generateChefEquipePreparations(target),
  ])

  const tomorrowSiteContext = briefing.coverageBySite.map((s) => ({
    siteId: s.site_id,
    plannedMissions: s.missions,
  }))

  // Signal principal : absence de mission (déterministe, rapide).
  // Fallback : première lecture terrain d'un site du lendemain (résonance /
  // persistance depuis site_reading_candidates — nécessite données embeddings).
  const briefingReading = await getTenantDayReading(tomorrowSiteContext, 'demain')

  const fallbackReadings = !briefingReading && tomorrowSiteContext.length > 0
    ? await (async () => {
        for (const { siteId } of tomorrowSiteContext.slice(0, 3)) {
          const readings = await generateSiteReadings(siteId)
          if (readings.length > 0) return readings[0]
        }
        return null
      })()
    : null

  const effectiveBriefingReading = briefingReading ?? fallbackReadings

  const briefingShareText = formatBriefingShareText(briefing)
  const briefingUrl = await buildAbsoluteUrl(`/briefing?date=${briefing.date}`)

  const supabase = await createServerClient()
  const { data: usersWithPhone } = await supabase
    .from('users')
    .select('id, full_name, email, role, phone')
    .is('deleted_at', null)
    .not('phone', 'is', null)
    .order('full_name')

  const isManager = user.role === 'manager' || user.role === 'admin'

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <CalendarCheck className="h-6 w-6 text-brand-600" />
            Briefing du soir
          </h1>
          <p className="text-sm text-muted-foreground">
            Préparation de la couverture pour {formatDateLong(briefing.date)}.
          </p>
        </div>
        {briefing.interventionsCount > 0 && (
          <BriefingShareModal
            text={briefingShareText}
            url={briefingUrl}
            date={briefing.date}
            isManager={isManager}
            usersWithPhone={(usersWithPhone ?? []) as import('./BriefingShareModal').UserWithPhone[]}
          />
        )}
      </header>

      {/* 4 chiffres clés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BriefStat
          icon={CalendarCheck}
          value={briefing.interventionsCount}
          label="interventions prévues"
        />
        <BriefStat
          icon={Users}
          value={briefing.teamsCount}
          label={`équipe${briefing.teamsCount > 1 ? 's' : ''} mobilisée${briefing.teamsCount > 1 ? 's' : ''}`}
        />
        <BriefStat
          icon={MapPin}
          value={briefing.sitesWithoutCoverage.length}
          label="site(s) sans couverture"
          tone={briefing.sitesWithoutCoverage.length > 0 ? 'amber' : 'neutral'}
        />
        <BriefStat
          icon={AlertTriangle}
          value={briefing.unassignedInterventions.length}
          label="non-affecté(s)"
          tone={briefing.unassignedInterventions.length > 0 ? 'amber' : 'neutral'}
        />
      </div>

      {/* Ce que les lieux disent — 1 signal IA sur les sites du lendemain.
          Source 1 : absence mission (déterministe).
          Source 2 : résonance/persistance depuis site_reading_candidates (fallback). */}
      {effectiveBriefingReading && (
        <div className="space-y-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65">
            Ce que les lieux disent
          </div>
          <ReadingCard
            fragment={effectiveBriefingReading.fragment}
            context={'context' in effectiveBriefingReading ? effectiveBriefingReading.context : undefined}
          />
        </div>
      )}

      {/* Couverture par site (positif) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Couverture prévue ({briefing.coverageBySite.length} site
            {briefing.coverageBySite.length > 1 ? 's' : ''})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {briefing.coverageBySite.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              Aucune intervention planifiée demain.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {briefing.coverageBySite.map((s) => (
                <li
                  key={s.site_name}
                  className="flex items-start justify-between gap-3 flex-wrap"
                >
                  <SiteNotesPopover
                    siteName={s.site_name}
                    notes={s.recentNotes}
                    fields={s.fields}
                  />
                  <span className="inline-flex items-center gap-2 flex-wrap shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.count} interv.
                    </span>
                    {s.teams.map((t) => (
                      <TeamCompositionPopover
                        key={t.id}
                        teamName={t.name}
                        teamColor={t.color}
                        memberNames={t.memberNames}
                        referentName={t.referentName}
                      />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Sites sans couverture (point de vigilance — pas une alarme) */}
      {briefing.sitesWithoutCoverage.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-600" />
              Sites sans couverture demain ({briefing.sitesWithoutCoverage.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2 italic">
              Information logistique. À vérifier si une couverture est attendue.
            </p>
            <ul className="space-y-1 text-sm">
              {briefing.sitesWithoutCoverage.map((s) => (
                <li key={s.id}>
                  {s.name}
                  {s.contract_name && (
                    <span className="text-xs text-muted-foreground"> · {s.contract_name}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Interventions non-affectées */}
      {briefing.unassignedInterventions.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              À affecter ({briefing.unassignedInterventions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {briefing.unassignedInterventions.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3">
                  <Link
                    href={`/interventions/${i.id}`}
                    className="hover:underline"
                  >
                    {i.mission_name}{' '}
                    <span className="text-xs text-muted-foreground">· {i.site_name}</span>
                  </Link>
                  {i.slot && (
                    <Badge className="shrink-0 bg-amber-100 text-amber-800 text-[10px] uppercase">
                      {SLOT_FR[i.slot] ?? i.slot}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Contrats à renouveler (signal proactif renouvellement). */}
      {briefing.contractsExpiringSoon.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-amber-600" />
              Contrats à renouveler ({briefing.contractsExpiringSoon.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2 italic">
              Fin de contrat dans les 60 prochains jours. Anticipez les
              négociations.
            </p>
            <ul className="space-y-1.5 text-sm">
              {briefing.contractsExpiringSoon.map((c) => {
                const tone =
                  c.daysUntilEnd <= 14
                    ? 'bg-red-100 text-red-800'
                    : c.daysUntilEnd <= 30
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-muted text-muted-foreground'
                return (
                  <li key={c.id} className="flex items-start justify-between gap-3">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="min-w-0 flex-1 hover:underline truncate"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {' '}· {c.client_name}
                      </span>
                    </Link>
                    <Badge
                      className={`shrink-0 text-[10px] inline-flex items-center gap-1 ${tone}`}
                    >
                      <Clock className="h-2.5 w-2.5" aria-hidden />
                      {c.daysUntilEnd === 0
                        ? "aujourd'hui"
                        : c.daysUntilEnd === 1
                          ? 'demain'
                          : `dans ${c.daysUntilEnd} j`}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Anomalies ouvertes depuis +3 jours — signal logistique calme. */}
      {briefing.oldOpenAnomalies.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="text-base inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Anomalies non résolues ({briefing.oldOpenAnomalies.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2 italic">
              Signalements ouverts depuis plus de 3 jours. À vérifier si toujours d&apos;actualité.
            </p>
            <ul className="space-y-1.5 text-sm">
              {briefing.oldOpenAnomalies.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <Link
                    href={`/interventions/${a.intervention_id}`}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    <span className="font-medium">
                      {a.category_other ?? a.category}
                    </span>
                    <span className="text-xs text-muted-foreground"> · {a.site_name}</span>
                    {a.description && (
                      <span className="block text-xs text-muted-foreground truncate">{a.description}</span>
                    )}
                  </Link>
                  <Badge className="shrink-0 bg-amber-100 text-amber-800 text-[10px]">
                    {a.age_days} j
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Préparation des envois WhatsApp — fusion ex /preparation 2026-05-14.
          Section action : liste compacte des chefs d'équipe ayant un passage
          demain + drawer latéral pour relire/éditer le message et l'envoyer. */}
      <EnvoisSection preparations={preparations} />

      {/* Lien semaine */}
      <div className="pt-4">
        <Link
          href={`/semaine?week=${briefing.date.slice(0, 7)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Voir la vue Semaine →
        </Link>
      </div>
    </div>
  )
}

// Helpers --------------------------------------------------------------------

async function buildAbsoluteUrl(path: string): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}${path}`
}

/**
 * Texte WhatsApp pour le briefing. Doctrine V5 :
 *  - noms de sites et d'équipes inclus (jamais de noms d'agent individuel)
 *  - phrase calme, pas d'urgence injonctive
 *  - lien vers la page briefing à la fin
 */
function formatBriefingShareText(
  b: Awaited<ReturnType<typeof buildEveningBriefing>>,
): string {
  const dateText = formatDateLong(b.date)
  const lines: string[] = [`Briefing — ${dateText}`]
  lines.push(`• ${b.interventionsCount} intervention${b.interventionsCount > 1 ? 's' : ''} prévue${b.interventionsCount > 1 ? 's' : ''}`)

  const SLOT_ABBR: Record<string, string> = { morning: 'matin', afternoon: 'après-midi', evening: 'soir' }
  if (b.coverageBySite.length > 0) {
    lines.push('')
    lines.push('Couverture :')
    for (const s of b.coverageBySite) {
      const teamsList = s.teams.map((t) => t.name).join(', ')
      const slotStr = s.slots.map((sl) => SLOT_ABBR[sl] ?? sl).join('/')
      const suffix = slotStr ? ` (${slotStr})` : ''
      lines.push(teamsList ? `• ${s.site_name} — ${teamsList}${suffix}` : `• ${s.site_name}${suffix}`)
    }
  }

  if (b.sitesWithoutCoverage.length > 0) {
    lines.push('')
    const names = b.sitesWithoutCoverage.slice(0, 3).map((s) => s.name).join(', ')
    const more = b.sitesWithoutCoverage.length > 3 ? ` (+${b.sitesWithoutCoverage.length - 3})` : ''
    lines.push(`Sans couverture : ${names}${more}`)
  }
  if (b.unassignedInterventions.length > 0) {
    lines.push(`• ${b.unassignedInterventions.length} intervention${b.unassignedInterventions.length > 1 ? 's' : ''} à affecter`)
  }
  if (b.contractsExpiringSoon.length > 0) {
    lines.push(`• ${b.contractsExpiringSoon.length} contrat${b.contractsExpiringSoon.length > 1 ? 's' : ''} à renouveler dans les 60j`)
  }
  return lines.join('\n')
}

function BriefStat({
  icon: Icon,
  value,
  label,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  value: number
  label: string
  tone?: 'neutral' | 'amber'
}) {
  return (
    <div
      className={
        'rounded-lg border bg-card p-3 ' +
        (tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : '')
      }
    >
      <Icon
        className={
          'h-4 w-4 ' + (tone === 'amber' ? 'text-amber-700' : 'text-muted-foreground')
        }
      />
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
