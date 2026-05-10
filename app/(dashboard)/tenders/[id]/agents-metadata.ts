import { Sparkles, FileSearch, FileText, Swords, Calculator, MapPinned, Scale } from 'lucide-react'
import type { ChatAgentName } from '@/types/db'

export interface AgentMeta {
  label: string
  description: string
  signatureQuestion: string
  icon: React.ComponentType<{ className?: string }>
}

export const AGENTS: Record<ChatAgentName, AgentMeta> = {
  general:           { label: 'Général',            description: 'Assistant généraliste, répond à toutes vos questions sur l\'AO',        signatureQuestion: 'Que faut-il savoir en priorité ?',           icon: Sparkles },
  lecteur_ao:        { label: 'Lecteur AO',         description: 'Spécialiste de la lecture critique du cahier des charges',              signatureQuestion: 'Que dit vraiment le cahier des charges ?',  icon: FileSearch },
  memoire_technique: { label: 'Mémoire technique',  description: 'Reformule, enrichit ou adapte la mémoire technique générée',            signatureQuestion: 'Comment formuler une réponse convaincante ?', icon: FileText },
  contradicteur:     { label: 'Contradicteur',      description: 'Avocat du diable : identifie les faiblesses, anticipe les critiques',  signatureQuestion: 'Quels risques ai-je oubliés ?',              icon: Swords },
  financier:         { label: 'Financier',          description: 'Modélisation des coûts, marges, pénalités et ROI',                      signatureQuestion: 'Cette réponse est-elle rentable ?',          icon: Calculator },
  terrain:           { label: 'Terrain',            description: 'Faisabilité opérationnelle : effectifs, rotations, logistique',         signatureQuestion: 'Est-ce faisable sur le terrain ?',           icon: MapPinned },
  conformite:        { label: 'Conformité',         description: 'Normes ISO, RGPD, clauses sociales, certifications métier',             signatureQuestion: 'Quelles obligations faut-il respecter ?',    icon: Scale },
}

export const AGENT_LABELS: Record<ChatAgentName, string> =
  Object.fromEntries((Object.keys(AGENTS) as ChatAgentName[]).map((k) => [k, AGENTS[k].label])) as Record<ChatAgentName, string>
