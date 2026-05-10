import { ShieldAlert, ListChecks, Swords, Mail, ClipboardList, Sparkles } from 'lucide-react'
import type { ChatAgentName } from '@/types/db'

export interface SlashCommand {
  trigger: string                       // ex: 'risques' (sans le slash)
  label: string                         // affichage menu
  description: string                   // sous-titre menu
  icon: React.ComponentType<{ className?: string }>
  prompt: string                        // texte qui remplace dans le composer
  agents: ChatAgentName[]               // agents auto-sélectionnés
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    trigger: 'risques',
    label: '/risques',
    description: "Lister les risques principaux et cachés de l'AO",
    icon: ShieldAlert,
    prompt: "Liste les risques principaux de cet AO et identifie 2-3 risques cachés que je n'aurais peut-être pas vus.",
    agents: ['contradicteur', 'lecteur_ao'],
  },
  {
    trigger: 'contraintes',
    label: '/contraintes',
    description: 'Extraire les contraintes obligatoires et les zones grises',
    icon: ListChecks,
    prompt: "Extrais toutes les contraintes obligatoires de l'AO, en distinguant les obligations strictes des zones grises interprétables.",
    agents: ['lecteur_ao', 'conformite'],
  },
  {
    trigger: 'challenge',
    label: '/challenge',
    description: 'Confronter 3 agents sur les points sensibles',
    icon: Swords,
    prompt: "Donne-moi vos perspectives respectives sur les points les plus sensibles de cet AO. Soyez francs et challengez-vous mutuellement.",
    agents: ['contradicteur', 'financier', 'terrain'],
  },
  {
    trigger: 'email',
    label: '/email',
    description: "Générer un email d'accompagnement de la candidature",
    icon: Mail,
    prompt: "Rédige un email court (10-15 lignes max) d'accompagnement à envoyer avec notre candidature pour cet AO. Ton professionnel, valeur mise en avant.",
    agents: ['memoire_technique'],
  },
  {
    trigger: 'checklist',
    label: '/checklist',
    description: "Créer une checklist d'exécution terrain",
    icon: ClipboardList,
    prompt: "Génère une checklist opérationnelle terrain pour exécuter cette mission une fois le marché remporté. Effectifs, matériel, contrôles qualité.",
    agents: ['terrain'],
  },
  {
    trigger: 'synthese',
    label: '/synthese',
    description: 'Synthétiser les 5 points-clés à retenir',
    icon: Sparkles,
    prompt: "Synthétise en 5 bullet points les éléments absolument essentiels à retenir pour répondre à cet AO.",
    agents: ['general', 'lecteur_ao'],
  },
]
