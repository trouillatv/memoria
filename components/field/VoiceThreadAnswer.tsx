'use client'

import { Fragment, type ReactNode } from 'react'
import { parseCopilotAnswer, toControlView } from '@/lib/visits/copilot-answer-format'

// Projection ORALE d'une réponse du Copilote — le fil affiché dans l'orbe.
//
// Le défaut corrigé ici : l'orbe imprimait `answer` tel quel dans un `<p>`, donc
// « 1. **Gestion du matériel…** » et « * **Pourquoi ce contrôle :** … » sortaient
// avec leurs astérisques. La surface écrite avait été traitée (`CopilotAnswer`),
// pas la surface vocale.
//
// Même analyse, rendu différent, et la différence est volontaire. Arbitrage
// Vincent du 16/08 : « je ne remettrais surtout pas les grosses cartes de la
// surface écrite dans l'orbe : ce serait contradictoire avec son rôle. Je
// garderais ici un fil beaucoup plus léger. » On réutilise donc le module pur
// `copilot-answer-format` — même découpage, mêmes niveaux de lecture — mais on
// s'arrête à la PREMIÈRE lecture : numéro, titre, ce qu'il faut constater, la
// raison d'être ici. Ni cadre, ni chevron, ni repli.
//
// Ce n'est pas une perte d'information : le détail replié reste disponible dans
// la feuille écrite, qui vit sous l'orbe et rend la même réponse via
// `CopilotAnswer`. L'orbe oriente, l'écran approfondit — c'est la séparation
// posée pour la voix, appliquée ici à son fil.
//
// Contrat de sûreté hérité du module : tout ce qui n'est pas reconnu retombe en
// paragraphe. Une réponse courte, un repli déterministe ou un format futur
// s'affichent comme avant, jamais dégradés.

// Gras, italique et code inline. `parseCopilotAnswer` nettoie déjà les puces et
// les étiquettes de champ ; il reste le balisage LIBRE que le modèle glisse dans
// ses phrases, et que la voix, elle, ne prononce pas (`stripMarkdown`).
const INLINE_RE = /\*\*(.+?)\*\*|\*(?!\s)([^*\n]+?)\*|`([^`\n]+)`/g

/** Rend le Markdown résiduel d'une ligne libre : interprété, jamais imprimé. */
function renderInline(text: string): ReactNode {
  // Les titres Markdown n'ont pas de sens dans un fil de conversation : le
  // marqueur part, le texte reste.
  const source = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '')

  const out: ReactNode[] = []
  let cursor = 0
  let key = 0

  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(source)) !== null) {
    if (m.index > cursor) out.push(<Fragment key={key++}>{source.slice(cursor, m.index)}</Fragment>)
    if (m[1] !== undefined) {
      out.push(<strong key={key++} className="font-semibold text-white/90">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      out.push(<em key={key++} className="not-italic text-white/85">{m[2]}</em>)
    } else {
      out.push(<Fragment key={key++}>{m[3]}</Fragment>)
    }
    cursor = m.index + m[0].length
  }
  if (cursor < source.length) out.push(<Fragment key={key++}>{source.slice(cursor)}</Fragment>)

  return out.length > 0 ? out : source
}

export function VoiceThreadAnswer({ text }: { text: string }) {
  const blocks = parseCopilotAnswer(text)

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, i) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={i} className="text-[15px] leading-relaxed text-white/70">
              {renderInline(block.text)}
            </p>
          )
        }

        if (block.kind === 'bullet') {
          return (
            <p key={i} className="flex gap-2 text-[15px] leading-relaxed text-white/70">
              <span aria-hidden className="mt-[10px] h-[3px] w-[3px] flex-none rounded-full bg-white/35" />
              <span className="min-w-0">{renderInline(block.text)}</span>
            </p>
          )
        }

        // Contrôle : première lecture seulement. `view.details` existe et n'est
        // volontairement pas rendu ici (voir en-tête).
        const view = toControlView(block)
        return (
          <div key={i} className="flex gap-2.5">
            <span className="mt-[3px] w-3 flex-none text-[13px] font-semibold tabular-nums text-violet-300/65">
              {view.index}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-[15px] font-medium leading-snug text-white/90">{view.title}</p>
              {view.check && (
                <p className="text-[14px] leading-snug text-white/62">{renderInline(view.check)}</p>
              )}
              {view.signal && (
                <p
                  className={`text-[13px] leading-snug ${
                    view.signal.tone === 'warning' ? 'text-amber-300/72' : 'text-white/42'
                  }`}
                >
                  {view.signal.text}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
