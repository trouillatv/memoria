// Données statiques d'équipe — SERVER-SAFE (PAS de 'use client').
//
// Pourquoi ce fichier existe (bug 2026-06-23) :
//   Les Server Actions (equipes/actions.ts) et TeamBadge (composant partagé,
//   rendu côté serveur) ont besoin de ces constantes pour VALIDER et RENDRE.
//   Si elles sont importées depuis un module 'use client' (team-icon-picker,
//   team-specialties), le serveur ne reçoit qu'une RÉFÉRENCE CLIENT opaque :
//   `TEAM_ICON_KEYS.includes(...)` jette alors « includes is not a function »
//   → l'action serveur plante (digest → écran « Quelque chose s'est passé »).
//   La couleur fonctionnait car ses constantes vivent dans team-badge.tsx,
//   qui n'est PAS 'use client'.
//
// Règle : tout ce qui est consommé par du code serveur DOIT vivre ici (ou dans
// un autre module sans directive 'use client'). Les composants client
// (pickers) importent simplement depuis ce fichier.

import {
  Sparkles,
  SprayCan,
  Brush,
  Droplets,
  Flower2,
  Leaf,
  Wind,
  ShieldCheck,
  Bed,
  Building2,
  Hospital,
  School,
  Factory,
  Package,
  Mountain,
  Truck,
  Key,
  Users,
  type LucideIcon,
} from 'lucide-react'

export const TEAM_ICONS = {
  sparkles: Sparkles,
  'spray-can': SprayCan,
  brush: Brush,
  droplets: Droplets,
  'flower-2': Flower2,
  leaf: Leaf,
  wind: Wind,
  'shield-check': ShieldCheck,
  bed: Bed,
  'building-2': Building2,
  hospital: Hospital,
  school: School,
  factory: Factory,
  package: Package,
  mountain: Mountain,
  truck: Truck,
  key: Key,
  users: Users,
} as const satisfies Record<string, LucideIcon>

export type TeamIconName = keyof typeof TEAM_ICONS

/** Liste des icônes dans l'ordre d'affichage du picker. */
export const TEAM_ICON_KEYS: TeamIconName[] = [
  'sparkles', 'spray-can', 'brush', 'droplets',
  'flower-2', 'leaf', 'wind', 'shield-check',
  'bed', 'building-2', 'hospital', 'school',
  'factory', 'package', 'mountain', 'truck',
  'key', 'users',
]

/** Tooltips FR — facultatifs, affichés au survol. */
export const TEAM_ICON_LABELS: Record<TeamIconName, string> = {
  sparkles: 'Nettoyage général',
  'spray-can': 'Désinfection',
  brush: 'Brossage',
  droplets: 'Eau / hydro',
  'flower-2': 'Espaces verts',
  leaf: 'Extérieur',
  wind: 'Vitrerie',
  'shield-check': 'Bio-nettoyage',
  bed: 'Hébergement',
  'building-2': 'Bureaux',
  hospital: 'Santé',
  school: 'Éducation',
  factory: 'Industrie',
  package: 'Logistique',
  mountain: 'Site éloigné',
  truck: 'Mobile',
  key: 'Conciergerie',
  users: 'Équipe générique',
}

/** Nombre max de spécialités déclarables par équipe (miroir du CHECK SQL). */
export const TEAM_SPECIALTY_MAX = 12
