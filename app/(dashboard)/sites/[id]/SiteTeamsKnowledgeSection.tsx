// CT-2 — Bloc « Équipes qui connaissent ce site » sur /sites/[id].
//
// Vincent 2026-05-21 : vue all-time (différente de TeamPresencesList qui
// se limite à 30j récents). Sujet = site, jamais classement entre équipes.
//
// Wording :
//   - « Équipes qui connaissent ce site » (sujet site) ✅
//   - JAMAIS « équipe la plus performante », « la plus fréquente », etc.
//
// Garde-fou doctrinal : pas d'ordre par compteur (pas un classement). Tri
// par date du dernier passage descendante (= repère temporel, pas score).

import { Users, MapPin, Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TeamBadge } from '@/components/ui/team-badge'
import { Badge } from '@/components/ui/badge'
import type { SiteTeamKnowledge } from '@/lib/db/site-team-knowledge'

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

interface Props {
  teams: SiteTeamKnowledge[]
}

export function SiteTeamsKnowledgeSection({ teams }: Props) {
  if (teams.length === 0) return null

  return (
    <Card data-slot="site-teams-knowledge">
      <CardHeader>
        <CardTitle className="text-base inline-flex items-center gap-2">
          <Users className="h-4 w-4" />
          Équipes qui connaissent ce chantier ({teams.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {teams.map((t) => (
            <li
              key={t.team_id}
              className={`px-6 py-3 ${t.isActive ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TeamBadge name={t.team_name} color={t.team_color} size="sm" />
                    {!t.isActive && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground italic">
                        archivée
                      </Badge>
                    )}
                  </div>
                  {t.missionNames.length > 0 && (
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1 flex-wrap">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>
                        {t.missionNames.slice(0, 4).join(' · ')}
                        {t.missionNames.length > 4 && (
                          <span className="text-muted-foreground/70"> · +{t.missionNames.length - 4}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                  <div className="text-right">
                    <div className="tabular-nums font-medium text-foreground">
                      {t.interventionsDocumentedCount.toLocaleString('fr-FR')}
                    </div>
                    <div>
                      intervention{t.interventionsDocumentedCount > 1 ? 's' : ''}<br />
                      documentée{t.interventionsDocumentedCount > 1 ? 's' : ''}
                    </div>
                  </div>
                  {t.lastPassageDate && (
                    <div className="text-right">
                      <div className="tabular-nums font-medium text-foreground inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateShort(t.lastPassageDate)}
                      </div>
                      <div>dernier passage</div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
