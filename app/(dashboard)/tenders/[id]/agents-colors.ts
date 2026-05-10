import type { ChatAgentName } from '@/types/db'

export interface AgentColors {
  // Bordure (ex. border-l-4 sur les bulles, border 2px sur pills actives)
  borderClass: string
  // Texte / icône (ex. lucide-react color)
  textClass: string
  // Background subtil (chip, hover sur pills)
  bgClass: string
  // Couleur dot indicator (status pill)
  dotClass: string
}

export const AGENT_COLORS: Record<ChatAgentName, AgentColors> = {
  general:           { borderClass: 'border-slate-400',   textClass: 'text-slate-700',   bgClass: 'bg-slate-50',   dotClass: 'bg-slate-400'   },
  lecteur_ao:        { borderClass: 'border-sky-500',     textClass: 'text-sky-700',     bgClass: 'bg-sky-50',     dotClass: 'bg-sky-500'     },
  memoire_technique: { borderClass: 'border-indigo-500',  textClass: 'text-indigo-700',  bgClass: 'bg-indigo-50',  dotClass: 'bg-indigo-500'  },
  contradicteur:     { borderClass: 'border-amber-500',   textClass: 'text-amber-700',   bgClass: 'bg-amber-50',   dotClass: 'bg-amber-500'   },
  financier:         { borderClass: 'border-emerald-500', textClass: 'text-emerald-700', bgClass: 'bg-emerald-50', dotClass: 'bg-emerald-500' },
  terrain:           { borderClass: 'border-orange-500',  textClass: 'text-orange-700',  bgClass: 'bg-orange-50',  dotClass: 'bg-orange-500'  },
  conformite:        { borderClass: 'border-violet-500',  textClass: 'text-violet-700',  bgClass: 'bg-violet-50',  dotClass: 'bg-violet-500'  },
}
