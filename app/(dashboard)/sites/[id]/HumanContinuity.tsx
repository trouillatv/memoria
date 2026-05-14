import type { HumanContinuity } from '@/lib/db/site-cockpit'
import { SectionTitle } from './SectionTitle'

/**
 * V5.1.3 — Section 5 : CONTINUITÉ HUMAINE
 *
 * Liste descriptive non-cliquable. Pas un classement, pas un leaderboard.
 *
 * VERROU DOCTRINAL V5.1.3 (Vincent 2026-05-14) :
 *   ✅ Les humains peuvent être nommés.
 *   ❌ Ils ne peuvent jamais être qualifiés.
 *
 * Test du dev : peut-on remplacer le prénom par "le passage de mardi"
 * sans perdre le sens ? Si oui = descriptif (OK). Si non = on a glissé
 * vers la qualification de la personne (KO).
 *
 * Acceptable :
 *   ✅ "Hervé a tenu ce site 4 ans." (temporel, contextuel)
 *   ✅ "Sosefo a repris en mai." (relais)
 * Interdit :
 *   ❌ "Hervé connaissait parfaitement ce lieu." (qualitatif)
 *   ❌ "Joseph suit ce site avec attention." (qualitatif)
 *   ❌ "Joseph 92% des passages." (mesure individuelle)
 *
 * PIÈGES À ÉVITER :
 *   ❌ avatar rond / initiales en cercle
 *   ❌ bouton "Voir le profil"
 *   ❌ stars / notation / classement
 *   ❌ pourcentage "X : 60% des passages"
 *   ❌ cliquabilité (créerait page profil = reverse-lookup interdit V3)
 */

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const month = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

function spanLabel(months: number): string {
  if (months < 1) return 'moins d’un mois'
  if (months === 1) return '1 mois'
  if (months < 12) return `${months} mois`
  const years = Math.floor(months / 12)
  const remainder = months % 12
  if (remainder === 0) return years === 1 ? '1 an' : `${years} ans`
  return `${years} an${years > 1 ? 's' : ''} ${remainder} mois`
}

export function HumanContinuityList({ continuity }: { continuity: HumanContinuity }) {
  if (continuity.predecessors.length === 0) {
    return (
      <section className="space-y-4">
        <SectionTitle>Continuité humaine</SectionTitle>
        <p className="text-sm italic" style={{ color: '#888' }}>
          Ce site n&apos;a pas encore trouvé son chef d&apos;équipe.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <SectionTitle>Continuité humaine</SectionTitle>
      <ol className="pt-2 space-y-6">
        {continuity.predecessors.map((p, idx) => {
          const startLabel = formatMonthYear(p.firstSeenAt)
          const endLabel = p.isCurrent ? "aujourd'hui" : formatMonthYear(p.lastSeenAt)
          const span = spanLabel(p.spanMonths)
          return (
            <li key={`${p.firstName}-${idx}`}>
              <div className="text-xl font-normal leading-snug" style={{ color: '#0a0a0a' }}>
                {p.firstName}
              </div>
              <div
                className="text-sm italic leading-snug mt-1"
                style={{ color: '#555' }}
              >
                {startLabel} — {endLabel}
                {p.isCurrent ? (
                  <span className="not-italic" style={{ color: '#0a0a0a' }}>
                    {' '}
                    (en cours)
                  </span>
                ) : (
                  <>, {span}</>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
