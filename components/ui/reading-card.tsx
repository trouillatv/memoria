import { cn } from '@/lib/utils'
import { renderFragmentWithLinks } from '@/lib/ui/render-fragment'

/**
 * Identité visuelle unique des lectures IA — "cognition card".
 *
 * Règles :
 *   - Une couleur : reading-border / reading-bg / reading-label (cf. globals.css)
 *   - Aucune icône, aucun badge "AI", aucune animation flashy
 *   - Label optionnel : surface-specific, jamais technologique
 *   - compact=true pour mobile (fragment inline + frags en ligne)
 *   - Jamais de verdict, jamais de recommandation dans le fragment passé ici
 *
 * Prop `context` — pertinence contextuelle (pas une priorité, pas une gravité) :
 *   Le fragment dit CE QUE L'IA OBSERVE (passé, mémoire).
 *   Le context dit POURQUOI C'EST PERTINENT MAINTENANT (présent, planning).
 *   L'humain fait le lien. L'IA ne juge pas.
 *
 *   Fragment : "entrée nord absente depuis 7 semaines"
 *   Context  : "au planning aujourd'hui"
 *
 *   Interdit dans context : "critique", "important", "attention", "urgent".
 *   Autorisé  : "au planning aujourd'hui", "prévu ce matin", "revient",
 *               "déjà observé", "non documenté depuis".
 */

interface ReadingCardProps {
  fragment: string
  frags?: string[]
  context?: string
  label?: string
  compact?: boolean
  className?: string
  /** Map docId → filename pour rendre les `[doc:UUID]` cliquables avec
   *  le nom du PDF (sinon fallback « ↗ »). Optionnel — chaque surface
   *  qui veut le nom doit le fournir explicitement. */
  docNames?: Record<string, string>
}

export function ReadingCard({
  fragment,
  frags,
  context,
  label,
  compact = false,
  className,
  docNames,
}: ReadingCardProps) {
  return (
    <div
      className={cn(
        // Encadré marqué (Vincent 2026-05-20) : bande gauche épaisse +
        // fond plus contrasté + coins arrondis + ombre douce.
        'border-l-4 border-reading-border/70 bg-reading-bg/[0.10]',
        'pl-3.5 pr-3 rounded-md shadow-sm',
        compact ? 'py-2' : 'py-3',
        'animate-in fade-in-0 duration-500',
        className,
      )}
    >
      {label && (
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65 mb-1">
          {label}
        </div>
      )}

      {compact ? (
        <p className="text-[13px] leading-snug text-muted-foreground/90">
          {renderFragmentWithLinks(fragment, { docNames })}
          {frags && frags.length > 0 && (
            <span className="text-muted-foreground/70">
              {' '}
              {frags.slice(0, 3).join(' · ')}
            </span>
          )}
        </p>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed">{renderFragmentWithLinks(fragment, { docNames })}</p>
          {context && (
            <p className="text-[13px] leading-relaxed text-muted-foreground/70 mt-1">
              {context}
            </p>
          )}
          {frags && frags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {frags.map((f) => (
                <li key={f} className="text-sm text-muted-foreground">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
