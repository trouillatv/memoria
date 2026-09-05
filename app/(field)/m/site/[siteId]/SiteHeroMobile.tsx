import { Bot } from 'lucide-react'

// P3-mobile Phase 1 — hero chantier COMPACT (identité MemorIA à l'entrée d'un chantier).
// Présentation seule, aucune vérité métier :
//   - logo client PRIORITAIRE (clients.logo_path → URL signée, via getSiteIdentity) ;
//   - fallback = présence MemorIA (placeholder — asset de marque à fournir, ne PAS figer
//     un SVG définitif ici) ;
//   - badge de passage = 1ʳᵉ venue TERRAIN de l'utilisateur (countDistinctVisitDays+1,
//     doctrine 9+10) — jamais import/report/documentaire ;
//   - AUCUN statut « tout est à jour » (aucune règle déterministe ne le prouve).
// Règle §22 : avec logo → le client est le héros, MemorIA accompagne ; sans logo → la
// présence MemorIA porte l'identité (signature affichée uniquement dans ce cas).

/** Normalisation d'AFFICHAGE seule (casse, accents, espaces, ponctuation légère) :
 *  sert uniquement à ne pas répéter « MAISON TERRA » sous « MAISON TERRA ». Aucun
 *  rapprochement métier, aucun fuzzy — égalité stricte après normalisation. */
function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

export function SiteHeroMobile({
  siteName,
  clientName,
  clientLogoUrl,
  nthPassage,
  greetingName,
}: {
  siteName: string
  clientName: string | null
  clientLogoUrl: string | null
  nthPassage: number
  greetingName?: string | null
}) {
  const passageLabel = nthPassage <= 1 ? '1er passage' : `${nthPassage}ᵉ passage`
  const hasLogo = !!clientLogoUrl
  // Le nom du client n'apporte rien s'il redit le nom du chantier.
  const showClientName = !!clientName && !sameLabel(clientName, siteName)

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Visuel du hero : logo client si présent, sinon présence MemorIA (placeholder). */}
        <div className="shrink-0">
          {hasLogo ? (
            <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-xl border bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={clientLogoUrl!} alt={clientName ? `Logo ${clientName}` : 'Logo client'} className="h-full w-full object-contain p-1" />
            </div>
          ) : (
            // PLACEHOLDER mascotte — à remplacer par l'asset de marque fourni (PNG/WebP/SVG propre).
            <div className="grid h-14 w-14 place-items-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300" aria-hidden>
              <Bot className="h-7 w-7" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {greetingName ? <p className="text-xs text-muted-foreground">Bonjour {greetingName}</p> : null}
          <span className="mt-0.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {passageLabel}
          </span>
          {/* Le nom du chantier est une donnée d'IDENTITÉ : jamais coupé à l'ellipse
              pour gagner quelques pixels. Deux lignes maximum. */}
          <h1 className="mt-1 line-clamp-2 text-xl font-bold leading-tight">{siteName}</h1>
          {showClientName ? <p className="truncate text-xs text-muted-foreground">{clientName}</p> : null}
          <p className="mt-0.5 text-xs text-muted-foreground">Tout ce qu&apos;il faut savoir pour avancer.</p>
        </div>
      </div>

      {/* Signature MemorIA — présence de marque LÉGÈRE, uniquement en l'absence de logo client. */}
      {!hasLogo && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-violet-700 dark:text-violet-300">
          <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Je veille sur ce chantier pour que vous gardiez le cap.
        </p>
      )}
    </section>
  )
}
