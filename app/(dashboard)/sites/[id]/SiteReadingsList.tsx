import type { SiteReadings, SiteReading } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Couche 3 IA perceptive : "Lectures du lieu".
 *
 * Vincent 2026-05-15 (pilier doctrinal majeur) :
 *
 *   "L'IA est un révélateur du réel, pas un générateur de texte.
 *    Pas dashboard. Pas reporting. Pas contrôle. Mais perception augmentée."
 *
 * Phrases factuelles extraites algorithmiquement de patterns faibles —
 * aucun LLM, aucune génération de prose (respect Pilier 4 : DG reste
 * auteur signataire). L'IA assemble des constats observés, elle ne
 * narrate pas.
 *
 * REFONTE VISUELLE (Vincent 2026-05-15) :
 * Quatre axes regroupés par sous-headers uppercase, beaucoup d'espace,
 * pas d'icône, pas de bullet — juste les phrases qui respirent. Lecture
 * lente. La typographie doit créer la signature "le lieu commence à se
 * répondre à lui-même".
 *
 *   RÉSONANCES    — ce qui fait écho dans le temps
 *   PERSISTANCES  — ce qui revient malgré le temps
 *   ABSENCES      — ce qui ne revient plus
 *   TRANSMISSIONS — bribes laissées au successeur (IA de continuité)
 *
 * PIÈGES À ÉVITER (cf. Pilier 4) :
 *   ❌ phrases narratives "Ce site semble stabilisé..." → IA bavarde
 *   ❌ recommandations "Envisagez de..." → IA conseillère
 *   ❌ adjectifs qualifieurs "calme", "actif" → évaluation interdite
 *   ❌ icônes ✨ animées → mise en scène SaaS "AI insights"
 *   ❌ background coloré par axe → ramène au dashboard
 */

const AXIS_LABEL: Record<SiteReading['axis'], string> = {
  resonance: 'Résonances',
  persistence: 'Persistances',
  absence: 'Absences',
  transmission: 'Transmissions',
}

const AXIS_ORDER: SiteReading['axis'][] = [
  'transmission',  // En premier si présent : pertinent pour Patrick quand un chef vient de prendre le site
  'resonance',
  'persistence',
  'absence',
]

export function SiteReadingsList({ data }: { data: SiteReadings }) {
  if (data.readings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas encore de motif perceptible sur ce lieu.
      </p>
    )
  }

  // Grouper par axe
  const grouped = new Map<SiteReading['axis'], SiteReading[]>()
  for (const r of data.readings) {
    const arr = grouped.get(r.axis) ?? []
    arr.push(r)
    grouped.set(r.axis, arr)
  }

  return (
    <div className="space-y-7">
      {AXIS_ORDER.map((axis) => {
        const items = grouped.get(axis)
        if (!items || items.length === 0) return null
        return (
          <div key={axis} className="space-y-3">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {AXIS_LABEL[axis]}
            </h3>
            <ul className="space-y-3">
              {items.map((r, idx) => (
                <li key={`${axis}-${idx}`} className="text-[15px] leading-relaxed">
                  {r.text}
                  {r.fragments && r.fragments.length > 0 && (
                    // V5.1.4 — Liste fragmentaire (Vincent 2026-05-15) :
                    // "L'IA expose le tissu. Le cerveau humain fait les liens."
                    // Pas de bullet, pas de séparateur — juste des mots posés
                    // les uns sous les autres, comme dans un carnet d'archiviste.
                    <ul className="mt-2 pl-1 space-y-1">
                      {r.fragments.map((frag) => (
                        <li
                          key={frag}
                          className="text-sm text-muted-foreground"
                        >
                          {frag}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
