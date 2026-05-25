// Page Intervenants (liste) — refonte visuelle inspirée des cards /sites/.
// Vincent 2026-05-21 : KPIs visibles, hiérarchie claire, sans ranking.
//
// Garde-fous techniques inchangés (cf. mémoire page-personne-pivot-transgression) :
//   #1 N/A pour la liste (audit log uniquement sur consultation détail)
//   #2 Compteurs descriptifs uniquement
//   #3 Pas de comparaison côte à côte (les cards sont juxtaposées mais SANS
//      indicateur visuel comparatif — pas de gradient « le plus actif »)
//   #4 Wording descriptif
//   #5 Kill switch ENV
//   #6 Allowlist user_id confinée

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, ArrowRight, MapPin, BriefcaseBusiness } from 'lucide-react'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { listIntervenantsForList } from '@/lib/db/intervenants'
import { Card } from '@/components/ui/card'
import { TeamBadge } from '@/components/ui/team-badge'
import { CreateIntervenantDialog } from './CreateIntervenantDialog'

export const dynamic = 'force-dynamic'

const MONTHS_FR_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_FR_SHORT[m - 1] ?? ''} ${y}`
}

/** Présence terrain récente (≤ 14 j) — fait temporel, jamais un jugement. */
function isRecentPresence(iso: string | null): boolean {
  if (!iso) return false
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return false
  const days = Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86_400_000)
  return days >= 0 && days <= 14
}

function roleLabelFr(role: string): string {
  switch (role) {
    case 'admin': return 'Admin'
    case 'manager': return 'Manager'
    case 'chef_equipe': return "Chef d'équipe"
    default: return role
  }
}

function initialsOf(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export default async function IntervenantsListPage() {
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  if (!access.access.isPrivileged) notFound()

  const intervenants = await listIntervenantsForList()

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Users className="h-6 w-6 text-brand-600" />
            Intervenants ({intervenants.length})
          </h1>
          <p className="text-sm text-muted-foreground">
            Les personnes qui portent la mémoire du terrain.
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Vue descriptive, sans classement — tri alphabétique. Chaque consultation d&apos;une fiche est tracée.
          </p>
        </div>
        <CreateIntervenantDialog />
      </header>

      {intervenants.length === 0 ? (
        <Card className="py-12 text-center text-sm text-muted-foreground italic">
          Aucun intervenant actif.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {intervenants.map((i) => {
            const displayName = i.full_name ?? i.email
            const initials = initialsOf(i.full_name ?? i.email.split('@')[0] ?? '?')
            return (
              <Link
                key={i.id}
                href={`/intervenants/${i.id}`}
                className="group block rounded-2xl border border-border/60 bg-stone-50/50 dark:bg-card p-5 transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-brand-200/70 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {/* Identité — d'abord la personne, pas ses chiffres. */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-600/10 border border-brand-200 dark:border-brand-700/40 flex items-center justify-center text-xs font-semibold text-brand-700 dark:text-brand-300">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{displayName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{roleLabelFr(i.role)}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 mt-1 text-muted-foreground/40 group-hover:text-foreground transition-colors duration-200 shrink-0" />
                </div>

                {/* Continuité — territoires connus (mémoire portée, pas KPI). */}
                <div className="mt-3.5 space-y-1.5">
                  {i.sitesKnown > 0 ? (
                    <p className="text-sm flex items-start gap-1.5">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        Suit régulièrement {i.sitesKnown} lieu{i.sitesKnown > 1 ? 'x' : ''}
                        {i.topSites.length > 0 && (
                          <span className="block text-xs text-muted-foreground truncate">
                            surtout {i.topSites.join(' · ')}
                          </span>
                        )}
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Pas encore de territoire suivi</p>
                  )}
                  {isRecentPresence(i.lastParticipationDate) && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Présence récente sur le terrain
                    </p>
                  )}
                </div>

                {/* Équipes — discrètes. */}
                {i.teams.length > 0 && (
                  <div className="mt-3 flex items-center gap-1 flex-wrap">
                    <BriefcaseBusiness className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                    {i.teams.slice(0, 2).map((t) => (
                      <TeamBadge key={t.team_id} name={t.team_name} color={t.team_color} size="sm" />
                    ))}
                    {i.teams.length > 2 && (
                      <span className="text-[10px] text-muted-foreground/70">+{i.teams.length - 2}</span>
                    )}
                  </div>
                )}

                {/* Activité — démotée (footer muted, plus le centre émotionnel). */}
                <div className="mt-3.5 pt-2.5 border-t border-border/40 flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {i.lastParticipationDate
                      ? `Dernier relais : ${formatDateShort(i.lastParticipationDate)}`
                      : 'Aucun relais récent'}
                  </span>
                  <span>
                    {i.interventionsParticipated.toLocaleString('fr-FR')} intervention{i.interventionsParticipated > 1 ? 's' : ''}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
