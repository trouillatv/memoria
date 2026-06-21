'use client'

import { Brain, Plus } from 'lucide-react'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import { CATEGORY_LABELS_FULL, CATEGORY_COLORS } from './category-targets'
import type { KnowledgeCategory } from '@/types/db'

interface StarterAction {
  category: KnowledgeCategory
  title: string
  description: string
}

const STARTER_ACTIONS: StarterAction[] = [
  {
    category: 'references_clients',
    title: 'Votre 1ère référence client',
    description:
      "Un client emblématique avec son contexte, secteur, surface, durée. Cette référence sera réutilisée par l'agent Mémoire technique.",
  },
  {
    category: 'moyens_humains',
    title: 'Votre effectif & qualifications',
    description:
      "Composition de votre équipe permanente, certifications CQP APH, formations. Base de calcul pour l’agent Financier et Terrain.",
  },
  {
    category: 'qualite',
    title: 'Vos certifications',
    description:
      "ISO 9001, Qualipropre, Ecolabel… L'agent Conformité s'en sert pour répondre aux exigences réglementaires des dossiers.",
  },
]

export function EmptyStateLibrary() {
  return (
    <div className="rounded-xl border-2 border-dashed bg-card p-8 md:p-12 text-center space-y-6">
      <div className="space-y-3">
        <div className="inline-flex w-12 h-12 rounded-full bg-amber-50 items-center justify-center">
          <Brain className="h-6 w-6 text-amber-700" />
        </div>
        <h2 className="text-xl font-bold">Votre IA est sous-alimentée</h2>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          La Bibliothèque est le cerveau métier de votre entreprise. Plus elle est riche en
          références, moyens et procédures, plus vos analyses de dossiers sont précises et défendables.
          Commencez par 3 éléments fondamentaux ci-dessous.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto text-left">
        {STARTER_ACTIONS.map((action) => {
          const colors = CATEGORY_COLORS[action.category]
          return (
            <KnowledgeItemDrawer
              key={action.category}
              defaultCategory={action.category}
              trigger={
                <button
                  type="button"
                  className="rounded-lg border bg-background p-4 text-left hover:border-foreground/30 hover:bg-muted/30 transition-colors flex flex-col gap-2 group"
                >
                  <span
                    className={`inline-flex self-start text-[10px] px-2 py-0.5 rounded font-medium ${colors.bg} ${colors.text}`}
                  >
                    {CATEGORY_LABELS_FULL[action.category]}
                  </span>
                  <span className="text-sm font-semibold">{action.title}</span>
                  <span className="text-xs text-muted-foreground line-clamp-3 flex-1">
                    {action.description}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-brand-600 font-medium mt-1 group-hover:underline">
                    <Plus className="h-3 w-3" />
                    Ajouter via template
                  </span>
                </button>
              }
            />
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Chaque template fournit une structure de départ. Tu restes libre de l'éditer ou d'écrire ton propre contenu.
      </p>
    </div>
  )
}
