import type { SiteIdentity } from '@/lib/db/site-cockpit'

/**
 * V5.1.3 — Section 1 : IDENTITÉ
 *
 * "Le lieu avant les données." L'identité est le titre de la page —
 * pas de H2 minuscule au-dessus. La règle "H2 uppercase" commence à
 * partir de la Section 2.
 *
 * Doctrine wording (cf. memory netoiage-grille-pensee-produit) :
 * — sujet principal = le site, pas l'humain
 * — humains peuvent être nommés, jamais qualifiés
 */

function formatStartedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const month = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

export function IdentityHeader({ site }: { site: SiteIdentity }) {
  const startedLabel = formatStartedAt(site.contractStartedAt)

  return (
    <header className="space-y-1">
      <h1
        className="text-4xl font-semibold tracking-tight leading-[1.1]"
        style={{ color: '#0a0a0a' }}
      >
        {site.name}
      </h1>
      {site.contractName && (
        <p className="text-lg leading-snug mt-1" style={{ color: '#555' }}>
          {site.contractName}
        </p>
      )}
      <div className="text-sm leading-relaxed mt-6 space-y-0.5" style={{ color: '#888' }}>
        {startedLabel && <div>Contrat depuis {startedLabel}</div>}
        {site.clientName && <div>{site.clientName}</div>}
        {site.address && <div>{site.address}</div>}
      </div>
      {site.teamsSucceeded > 1 && (
        <p className="text-sm italic mt-6" style={{ color: '#555' }}>
          {site.teamsSucceeded} équipes se sont succédé ici.
        </p>
      )}
    </header>
  )
}
