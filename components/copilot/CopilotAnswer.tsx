'use client'

// Rendu d'une réponse du Copilote — présentation uniquement.
//
// Retour terrain du 15/08 sur la première passe : « ce rendu est indigeste,
// même si le contenu métier derrière est plutôt bon ». On affichait encore la
// structure interne de la réponse comme un texte rédigé — cinq mini-comptes
// rendus de quatre rubriques — alors que l'utilisateur a demandé « qu'est-ce
// que je vérifie demain ? ».
//
// Deux niveaux de lecture, décidés dans `toControlView` (pur, testé) :
//   visible    → le titre, ce qu'il faut contrôler, pourquoi maintenant ;
//   replié     → dernier état, dates, récurrence, motif de sélection.
//
// Aucune information n'est supprimée, et rien n'est reformulé : les phrases
// restent celles produites par le moteur. Seul leur niveau de lecture change.
//
// La qualité du « À vérifier » lui-même (« constater l'état réel » est trop
// générique pour être utile sur place) relève du moteur, pas d'ici : c'est un
// sujet Visit Engine, volontairement hors de cette passe.

import { Fragment, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  parseCopilotAnswer,
  toControlView,
  type CopilotAnswerBlock,
} from '@/lib/visits/copilot-answer-format'

/** Rend le gras Markdown résiduel d'une ligne libre (hors contrôles). */
function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold">{part}</strong>
      : <Fragment key={i}>{part}</Fragment>
  )
}

function ControlCard({ control }: { control: Extract<CopilotAnswerBlock, { kind: 'control' }> }) {
  const view = toControlView(control)
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border border-foreground/[0.07] bg-background/70 px-3 py-2.5">
      <p className="flex gap-2 text-[14px] font-semibold leading-snug text-foreground">
        <span className="shrink-0 tabular-nums text-violet-500">{view.index} ·</span>
        <span className="min-w-0">{view.title}</span>
      </p>

      {view.check && (
        <p className="mt-1.5 text-[13.5px] leading-snug text-foreground/90">
          <span className="font-medium text-muted-foreground">À vérifier — </span>
          {view.check}
        </p>
      )}

      {view.signal && (
        <p
          className={
            view.signal.tone === 'warning'
              ? 'mt-1.5 flex gap-1.5 text-[12.5px] leading-snug font-medium text-amber-700 dark:text-amber-500'
              : 'mt-1.5 text-[12.5px] leading-snug text-muted-foreground'
          }
        >
          {view.signal.tone === 'warning' && <span aria-hidden>⚠️</span>}
          <span>{view.signal.text}</span>
        </p>
      )}

      {view.details.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? 'Masquer l’historique' : 'Voir l’historique'}
            <ChevronDown className={open ? 'h-3.5 w-3.5 rotate-180 transition-transform' : 'h-3.5 w-3.5 transition-transform'} />
          </button>

          {open && (
            <div className="mt-1.5 space-y-1 border-l-2 border-foreground/10 pl-2.5">
              {view.details.map((field, i) => (
                <p key={i} className="text-[12.5px] leading-snug text-muted-foreground">
                  {field.label && <span className="font-medium">{field.label} : </span>}
                  {field.value}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function CopilotAnswer({ text, className }: { text: string; className?: string }) {
  const blocks = parseCopilotAnswer(text)

  return (
    <div className={className ?? 'space-y-2'}>
      {blocks.map((block, i) => {
        if (block.kind === 'control') {
          return <ControlCard key={i} control={block} />
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
