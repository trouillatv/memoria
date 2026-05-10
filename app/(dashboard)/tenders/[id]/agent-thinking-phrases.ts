import type { ChatAgentName } from '@/types/db'

export const THINKING_PHRASES: Record<ChatAgentName, string[]> = {
  general: [
    "Ouvre le dossier et reconstitue le contexte…",
    "Connecte les pièces de l'AO…",
    "Synthétise ce qui est demandé…",
    "Recoupe avec la bibliothèque…",
    "Prépare une vue d'ensemble…",
  ],
  lecteur_ao: [
    "Relit le cahier des charges en détail…",
    "Repère les contraintes oubliées…",
    "Vérifie les clauses critiques…",
    "Scanne les annexes et les détails…",
    "Extrait les obligations contractuelles…",
  ],
  memoire_technique: [
    "Structure la réponse commerciale…",
    "Adapte le ton pour ce client…",
    "Recoupe avec les références internes…",
    "Met en avant nos différenciants…",
    "Affine la mémoire technique…",
  ],
  contradicteur: [
    "Affûte ses contre-arguments…",
    "Cherche les failles de la proposition…",
    "Anticipe les critiques d'un jury…",
    "Identifie ce qu'on n'a pas vu…",
    "Joue l'avocat du diable…",
  ],
  financier: [
    "Estime les coûts cachés…",
    "Modélise la marge sur 12 mois…",
    "Calcule l'impact des pénalités…",
    "Évalue la faisabilité économique…",
    "Pose les chiffres de fond…",
  ],
  terrain: [
    "Modélise les rotations d'équipes…",
    "Visualise le dispositif terrain…",
    "Évalue les besoins en effectifs…",
    "Anticipe les contraintes logistiques…",
    "Confronte avec la réalité métier…",
  ],
  conformite: [
    "Vérifie les certifications requises…",
    "Scrute les clauses sociales…",
    "Décortique le RGPD applicable…",
    "Liste les normes ISO obligatoires…",
    "Confronte aux référentiels métier…",
  ],
}

export function pickThinkingPhrase(agent: ChatAgentName): string {
  const pool = THINKING_PHRASES[agent]
  return pool[Math.floor(Math.random() * pool.length)]
}
