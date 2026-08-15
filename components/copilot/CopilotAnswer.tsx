// Rendu d'une réponse du Copilote — présentation uniquement.
//
// Avant cette passe, les trois surfaces affichaient `answer.text` dans un
// `<p className="whitespace-pre-line">` : le Markdown produit par le LLM était
// imprimé littéralement (« **Pourquoi ce contrôle :** ») et cinq contrôles à
// quatre champs formaient un pavé illisible sur téléphone.
//
// Ici : mêmes données, aucun champ retiré, aucune reformulation. Le découpage
// vit dans `parseCopilotAnswer` (pur, testé) ; ce composant ne fait que poser
// la typographie. Tout texte non reconnu retombe en paragraphe, donc une
// réponse courte ou un fallback s'affiche exactement comme avant.

import { Fragment, type ReactNode } from 'react'
import { parseCopilotAnswer } from '@/lib/visits/copilot-answer-format'

/** Rend le gras Markdown résiduel d'une ligne libre (hors contrôles). */
function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold">{part}</strong>
      : <Fragment key={i}>{part}</Fragment>
  )
}

export function CopilotAnswer({ text, className }: { text: string; className?: string }) {
  const blocks = parseCopilotAnswer(text)

  return (
    <div className={className ?? 'space-y-2'}>
      {blocks.map((block, i) => {
        if (block.kind === 'control') {
          return (
            <div
              key={i}
              className="rounded-xl border border-foreground/[0.06] bg-background/70 px-3 py-2.5"
            >
              <p className="flex gap-2 text-[13.5px] font-semibold leading-snug text-foreground">
                <span className="shrink-0 tabular-nums text-violet-500">{block.index}.</span>
                <span className="min-w-0">{block.title}</span>
              </p>
              {block.fields.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {block.fields.map((field, j) => (
                    <p key={j} className="text-[13px] leading-snug text-foreground/85">
                      {field.label && (
                        <span className="font-medium text-muted-foreground">{field.label} — </span>
                      )}
                      {field.value}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        }

        if (block.kind === 'bullet') {
          return (
            <p key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-foreground">
              <span className="text-muted-foreground">•</span>
              <span>{renderInline(block.text)}</span>
            </p>
          )
        }

        return (
          <p key={i} className="text-[13.5px] leading-relaxed text-foreground">
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}
