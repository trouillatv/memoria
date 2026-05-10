'use client'

import { Sparkles, ShieldAlert, ListChecks, BookOpen, Calculator, MapPinned, Scale } from 'lucide-react'
import type { DbTenderAnalysis, ChatAgentName } from '@/types/db'

export interface SuggestedPrompt {
  label: string
  icon: React.ComponentType<{ className?: string }>
  prompt: string
  agents: ChatAgentName[]
}

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    label: 'Risques cachés',
    icon: ShieldAlert,
    prompt: 'Quels sont les 3 risques cachés de cet AO que je n\'ai peut-être pas vus ?',
    agents: ['contradicteur'],
  },
  {
    label: 'Marge sur 12 mois',
    icon: Calculator,
    prompt: 'Estime la marge réaliste sur 12 mois et identifie les coûts cachés à anticiper.',
    agents: ['financier'],
  },
  {
    label: 'Faisabilité terrain',
    icon: MapPinned,
    prompt: 'Évalue la faisabilité opérationnelle : effectifs nécessaires, rotations, points d\'attention logistique.',
    agents: ['terrain'],
  },
  {
    label: 'Conformité',
    icon: Scale,
    prompt: 'Vérifie les certifications et clauses sociales obligatoires, ainsi que les zones grises règlementaires.',
    agents: ['conformite'],
  },
  {
    label: 'Synthèse 5 points',
    icon: ListChecks,
    prompt: 'Donne-moi les 5 points-clés à retenir absolument pour répondre à cet AO.',
    agents: ['general', 'lecteur_ao'],
  },
  {
    label: 'Reformuler la mémoire',
    icon: BookOpen,
    prompt: 'Reformule la mémoire technique en mettant l\'accent sur nos différenciants principaux.',
    agents: ['memoire_technique'],
  },
]

interface CopiloteHeroCardProps {
  tenderTitle: string
  analysis: DbTenderAnalysis | null
  onPromptClick: (prompt: string, agents: ChatAgentName[]) => void
}

export function CopiloteHeroCard({ tenderTitle: _tenderTitle, analysis, onPromptClick }: CopiloteHeroCardProps) {
  // Compute KPIs depuis l'analyse principale
  const risks = (analysis?.risks ?? []) as Array<{ severity?: string }>
  const constraints = (analysis?.constraints ?? []) as Array<{ required?: boolean }>
  const checklist = (analysis?.checklist ?? []) as unknown[]
  const risksCount = risks.length
  const risksHigh = risks.filter(r => r.severity === 'high').length
  const obligatoires = constraints.filter(c => c.required).length

  return (
    <div className="space-y-4 mb-6">
      {/* Header avec point vert "agents prêts" */}
      <div className="flex items-start gap-3 p-4 rounded-xl border bg-gradient-to-br from-emerald-50/50 to-background">
        <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-emerald-700" />
        </div>
        <div className="flex-1 space-y-1">
          <h3 className="text-sm font-semibold">Vos 7 agents IA ont lu cet AO</h3>
          <p className="text-xs text-muted-foreground">
            Première lecture terminée. Demandez-leur de creuser un point précis ci-dessous, ou posez votre propre question.
          </p>
        </div>
      </div>

      {/* KPIs au regard rapide */}
      {analysis && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Risques</div>
            <div className="text-lg font-bold mt-0.5">
              {risksCount}
              {risksHigh > 0 && <span className="text-xs text-rose-600 font-medium ml-1">({risksHigh} élevé{risksHigh > 1 ? 's' : ''})</span>}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Contraintes oblig.</div>
            <div className="text-lg font-bold mt-0.5">{obligatoires}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Checklist</div>
            <div className="text-lg font-bold mt-0.5">{checklist.length} <span className="text-xs font-normal text-muted-foreground">items</span></div>
          </div>
        </div>
      )}

      {/* Suggested prompts */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Allez plus loin</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTED_PROMPTS.map((p) => {
            const Icon = p.icon
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onPromptClick(p.prompt, p.agents)}
                className="flex items-start gap-2.5 p-3 rounded-lg border bg-card hover:bg-muted/40 hover:border-brand-300 transition-colors text-left group"
              >
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-brand-600 shrink-0 mt-0.5 transition-colors" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{p.prompt}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Astuce footer */}
      <p className="text-[11px] text-muted-foreground text-center">
        Tu peux aussi cocher 2-3 agents en bas et leur poser ta propre question pour les faire réagir en parallèle.
      </p>
    </div>
  )
}
