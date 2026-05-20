import Link from 'next/link'
import type { ReactNode } from 'react'

// Helper de rendu pour les fragments IA (résonances B1/B2, lectures site).
// Les fragments stockés en DB contiennent des refs structurées sous forme
// de tokens `[doc:UUID]` (et `[trace:UUID]` côté B2). Ce helper :
//
//   - convertit `[doc:UUID]` en lien Next/Link vers /documents/UUID.
//     Si `opts.docNames[UUID]` est fourni, le texte du lien est le
//     filename du PDF ; sinon, fallback caractère « ↗ » discret.
//   - strippe `[trace:UUID]` du texte visible : pas de page trace dédiée,
//     l'ID reste en `source_ids` pour audit/dismiss.
//
// Pure : retourne ReactNode[], aucun side effect, testable.
// Sécurité : la regex matche UNIQUEMENT le pattern UUID standard
// (chiffres hex + tirets), pas d'injection HTML possible. Le filename
// est échappé par React (texte rendu via {expression}, jamais innerHTML).

const DOC_REF_RE = /\[doc:([0-9a-f-]{8,})\]/g
const TRACE_REF_RE = /\[trace:[0-9a-f-]{8,}\]/g

export interface RenderFragmentOptions {
  /** Map docId → filename pour afficher le nom du PDF dans le lien. */
  docNames?: Record<string, string>
}

export function renderFragmentWithLinks(
  fragment: string,
  opts: RenderFragmentOptions = {},
): ReactNode[] {
  // 1. Strip [trace:UUID] d'abord (token entièrement retiré).
  const stripped = fragment.replace(TRACE_REF_RE, '').replace(/\s+\./g, '.')

  // 2. Découpe sur [doc:UUID] et intercale des <Link>.
  const parts: ReactNode[] = []
  const re = new RegExp(DOC_REF_RE.source, 'g')
  let lastIndex = 0
  let m: RegExpExecArray | null
  let idx = 0

  while ((m = re.exec(stripped)) !== null) {
    if (m.index > lastIndex) {
      parts.push(stripped.slice(lastIndex, m.index))
    }
    const docId = m[1]
    const filename = opts.docNames?.[docId]
    const linkText = filename ?? '↗'
    const ariaLabel = filename
      ? `Ouvrir « ${filename} »`
      : `Ouvrir le document ${docId.slice(0, 8)}`
    parts.push(
      <Link
        key={`doc-${idx++}`}
        href={`/documents/${docId}`}
        prefetch={false}
        className="text-foreground/85 underline decoration-dotted decoration-foreground/40 underline-offset-2 hover:decoration-foreground hover:decoration-solid mx-0.5 break-all"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {linkText}
      </Link>,
    )
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < stripped.length) {
    parts.push(stripped.slice(lastIndex))
  }
  return parts
}
