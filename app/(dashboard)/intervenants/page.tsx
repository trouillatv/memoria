// Page Intervenants (liste) — vue index manager/admin uniquement.
//
// Vincent 2026-05-21 — TRANSGRESSION DOCTRINALE ASSUMÉE. Doctrine source :
// mémoire projet `page-personne-pivot-transgression`. Cette page liste les
// intervenants actifs avec leurs équipes + un aperçu descriptif (sites
// connus, nb interventions, dernier passage). PAS DE CLASSEMENT — tri
// alphabétique uniquement.
//
// Garde-fous techniques appliqués (les 6 du pivot) :
//   #1 Audit log : N/A (vue liste = pas de cible individuelle ouverte)
//   #2 Pas de score numérique calculé — uniquement compteurs descriptifs
//   #3 Pas de comparaison côte à côte — chaque ligne est isolée visuellement
//   #4 Wording descriptif uniquement
//   #5 Kill switch ENV `INTERVENANTS_PAGE_ENABLED` — 404 si désactivé
//   #6 Allowlist user_id : agrégats dans lib/db/intervenants.ts uniquement

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, AlertTriangle, ArrowRight } from 'lucide-react'
import { checkIntervenantsPageAccess } from '@/lib/intervenants/access'
import { listIntervenantsForList } from '@/lib/db/intervenants'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TeamBadge } from '@/components/ui/team-badge'

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

export default async function IntervenantsListPage() {
  // ── Garde-fou #5 : kill switch + accès (manager+admin uniquement pour la liste)
  const access = await checkIntervenantsPageAccess(null)
  if (!access.allowed) {
    if (access.reason === 'unauthenticated') redirect('/login')
    notFound()
  }
  // Seuls manager/admin accèdent à la LISTE — pas la self-consultation.
  if (!access.access.isPrivileged) notFound()

  const intervenants = await listIntervenantsForList()

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Bandeau pivot doctrinal */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-900/90 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200/90"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
        <p>
          Vue opérationnelle descriptive — <strong>jamais évaluative</strong>. Tri alphabétique
          uniquement, aucun classement. Les compteurs sont des faits cumulés, pas des scores.
          Consulter une fiche personnelle ouvre un journal d&apos;audit.
        </p>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Users className="h-6 w-6 text-brand-600" />
          Intervenants ({intervenants.length})
        </h1>
        <p className="text-sm text-muted-foreground">
          Personnes actives ayant accès à MemorIA. Cliquez sur un nom pour voir son
          historique opérationnel.
        </p>
      </header>

      {intervenants.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground italic">
            Aucun intervenant actif.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {intervenants.map((i) => {
                const displayName = i.full_name ?? i.email
                return (
                  <li key={i.id}>
                    <Link
                      href={`/intervenants/${i.id}`}
                      className="flex items-start justify-between gap-4 px-6 py-3 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{displayName}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {roleLabelFr(i.role)}
                          </Badge>
                        </div>
                        {i.teams.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {i.teams.map((t) => (
                              <TeamBadge
                                key={t.team_id}
                                name={t.team_name}
                                color={t.team_color}
                                size="sm"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                        <span className="text-right">
                          <span className="block tabular-nums font-medium text-foreground">
                            {i.interventionsParticipated}
                          </span>
                          <span>intervention{i.interventionsParticipated > 1 ? 's' : ''}</span>
                        </span>
                        <span className="text-right">
                          <span className="block tabular-nums font-medium text-foreground">
                            {i.sitesKnown}
                          </span>
                          <span>site{i.sitesKnown > 1 ? 's' : ''}</span>
                        </span>
                        <span className="text-right hidden sm:block">
                          <span className="block tabular-nums font-medium text-foreground">
                            {formatDateShort(i.lastParticipationDate)}
                          </span>
                          <span>dernier passage</span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 mt-1 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
