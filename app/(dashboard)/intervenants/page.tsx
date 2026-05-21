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
import { Users, AlertTriangle, ArrowRight, MapPin, Calendar, BriefcaseBusiness } from 'lucide-react'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { listIntervenantsForList } from '@/lib/db/intervenants'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
      {/* Bandeau pivot doctrinal — discret */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/40 px-3 py-1.5 text-[11px] text-amber-900/80 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200/70"
      >
        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
        <p>
          Vue descriptive opérationnelle — tri alphabétique uniquement, aucun classement.
          Chaque consultation d&apos;une fiche est tracée.
        </p>
      </div>

      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <Users className="h-6 w-6 text-brand-600" />
            Intervenants ({intervenants.length})
          </h1>
          <p className="text-sm text-muted-foreground">
            Personnes actives ayant accès à MemorIA.
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
                className="group block rounded-lg border bg-card p-4 space-y-3 hover:border-brand-300 hover:shadow-sm transition-all"
              >
                {/* Header : avatar + nom + rôle */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-600/10 border border-brand-200 dark:border-brand-700/40 flex items-center justify-center text-xs font-semibold text-brand-700 dark:text-brand-300">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{displayName}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {roleLabelFr(i.role)}
                      </Badge>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 mt-2 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </div>

                {/* Compteurs visuels */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider inline-flex items-center gap-1">
                      <Calendar className="h-2.5 w-2.5" />
                      Interventions
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {i.interventionsParticipated.toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider inline-flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5" />
                      Sites
                    </div>
                    <div className="text-xl font-semibold tabular-nums">
                      {i.sitesKnown.toLocaleString('fr-FR')}
                    </div>
                  </div>
                </div>

                {/* Équipes (max 3 badges) */}
                {i.teams.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    <BriefcaseBusiness className="h-3 w-3 text-muted-foreground shrink-0" />
                    {i.teams.slice(0, 3).map((t) => (
                      <TeamBadge
                        key={t.team_id}
                        name={t.team_name}
                        color={t.team_color}
                        size="sm"
                      />
                    ))}
                    {i.teams.length > 3 && (
                      <span className="text-[10px] text-muted-foreground/70">
                        +{i.teams.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* Dernier passage (footer discret) */}
                {i.lastParticipationDate && (
                  <div className="text-[10px] text-muted-foreground tabular-nums pt-1 border-t border-border/30">
                    Dernier passage : {formatDateShort(i.lastParticipationDate)}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
