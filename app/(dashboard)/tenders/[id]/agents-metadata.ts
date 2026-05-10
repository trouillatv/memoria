import { Sparkles, FileSearch, FileText, Swords, Calculator, MapPinned, Scale } from 'lucide-react'
import type { ChatAgentName } from '@/types/db'

export interface AgentMeta {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

export const AGENTS: Record<ChatAgentName, AgentMeta> = {
  general:           { label: 'Général',            description: 'Assistant généraliste, répond à toutes vos questions sur l\'AO',        icon: Sparkles },
  lecteur_ao:        { label: 'Lecteur AO',         description: 'Spécialiste de la lecture critique du cahier des charges',              icon: FileSearch },
  memoire_technique: { label: 'Mémoire technique',  description: 'Reformule, enrichit ou adapte la mémoire technique générée',            icon: FileText },
  contradicteur:     { label: 'Contradicteur',      description: 'Avocat du diable : identifie les faiblesses, anticipe les critiques',  icon: Swords },
  financier:         { label: 'Financier',          description: 'Modélisation des coûts, marges, pénalités et ROI',                      icon: Calculator },
  terrain:           { label: 'Terrain',            description: 'Faisabilité opérationnelle : effectifs, rotations, logistique',         icon: MapPinned },
  conformite:        { label: 'Conformité',         description: 'Normes ISO, RGPD, clauses sociales, certifications métier',             icon: Scale },
}

export const AGENT_LABELS: Record<ChatAgentName, string> =
  Object.fromEntries((Object.keys(AGENTS) as ChatAgentName[]).map((k) => [k, AGENTS[k].label])) as Record<ChatAgentName, string>
