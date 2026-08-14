'use client'

import { useState } from 'react'
import { Activity, ClipboardCheck, Users, Share2, Search, Sparkles, ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'

interface CapabilityCard {
  id: string
  icon: LucideIcon
  name: string
  description: string
  examples: string[]
  moreExamples: string[]
}

const CARDS: CapabilityCard[] = [
  {
    id: 'situation',
    icon: Activity,
    name: 'Situation',
    description: 'Ce qui mérite attention, priorités et blocages actifs',
    examples: [
      "Où en est le chantier ?",
      "Qu'est-ce qui bloque ce chantier ?",
    ],
    moreExamples: [
      "Quelles sont les priorités en ce moment ?",
      "Quels sujets demandent mon attention ?",
      "Y a-t-il des sujets critiques non traités ?",
      "Quel est l'état d'avancement global ?",
    ],
  },
  {
    id: 'visite',
    icon: ClipboardCheck,
    name: 'Préparer ma visite',
    description: 'Actions en retard, réserves ouvertes, sujets sans évolution',
    examples: [
      "Que dois-je vérifier lors de ma prochaine visite ?",
      "Quelles actions sont en retard ?",
    ],
    moreExamples: [
      "Quelles réserves sont encore ouvertes ?",
      "Quels sujets n'ont pas évolué depuis plusieurs semaines ?",
      "Que dois-je préparer pour la visite de la semaine prochaine ?",
      "Qu'est-ce que l'équipe attend de moi ?",
    ],
  },
  {
    id: 'responsabilites',
    icon: Users,
    name: 'Responsabilités',
    description: 'Qui intervient, qui est responsable, points sans responsable',
    examples: [
      "Qui intervient sur ce chantier ?",
      "Qui est responsable des essais béton ?",
    ],
    moreExamples: [
      "Qui est l'interlocuteur principal ?",
      "Quelles actions sont sans responsable ?",
      "Quelle entreprise gère le lot structure ?",
      "Quels lots n'ont pas de contact identifié ?",
    ],
  },
  {
    id: 'dependances',
    icon: Share2,
    name: 'Dépendances',
    description: 'Relations confirmées, blocages, enchaînement des travaux',
    examples: [
      "Quels sujets sont liés entre eux ?",
      "Quels sujets bloquent la réception ?",
    ],
    moreExamples: [
      "Quelles relations sont confirmées entre sujets ?",
      "Y a-t-il des blocages entre sujets ?",
      "Qu'est-ce qui est lié aux essais béton ?",
      "Quel est l'enchaînement des travaux sur ce lot ?",
    ],
  },
  {
    id: 'documents',
    icon: Search,
    name: 'Retrouver une information',
    description: 'PV, comptes-rendus, observations, documents',
    examples: [
      "Que disait le dernier PV sur les réserves ?",
      "Qu'est-ce qui a été écrit sur l'assainissement ?",
    ],
    moreExamples: [
      "Que disait le PV 008 sur les essais béton ?",
      "Y a-t-il une mention de R4 dans les comptes-rendus ?",
      "Quelles dimensions sont prévues au CCTP ?",
      "Donne-moi un extrait du dernier compte-rendu de réunion.",
    ],
  },
]

export function CapabilityDiscoveryPanel({
  onSelectQuestion,
  disabled,
  contextualSuggestions,
}: {
  onSelectQuestion: (q: string) => void
  disabled?: boolean
  /** Questions dérivées des données réelles de ce chantier — jamais un exemple générique. */
  contextualSuggestions?: string[]
}) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  return (
    <div className="rounded-xl border border-violet-100 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-950/10 p-3 space-y-2 max-h-[70vh] overflow-y-auto">
      {contextualSuggestions && contextualSuggestions.length > 0 && (
        <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-background p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" />
            <span className="text-[13px] font-semibold">Suggestions pour ce chantier</span>
          </div>
          <div className="flex flex-col gap-1">
            {contextualSuggestions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={disabled}
                onClick={() => onSelectQuestion(q)}
                className="text-left rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-[13px] text-foreground/70 hover:text-foreground hover:bg-muted/40 hover:border-foreground/20 disabled:opacity-50 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      {CARDS.map((card) => {
        const Icon = card.icon
        const isExpanded = expandedCard === card.id
        const visible = isExpanded
          ? [...card.examples, ...card.moreExamples]
          : card.examples

        return (
          <div key={card.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="text-[13px] font-semibold">{card.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setExpandedCard(isExpanded ? null : card.id)}
                className="flex items-center gap-0.5 text-[11px] text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors shrink-0"
              >
                {isExpanded
                  ? <><ChevronUp className="h-3 w-3" /> Moins</>
                  : <><ChevronDown className="h-3 w-3" /> Voir plus</>
                }
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{card.description}</p>
            <div className="flex flex-col gap-1">
              {visible.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectQuestion(q)}
                  className="text-left rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-[13px] text-foreground/70 hover:text-foreground hover:bg-muted/40 hover:border-foreground/20 disabled:opacity-50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
