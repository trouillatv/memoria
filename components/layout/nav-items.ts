import {
  Sparkles,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Users,
  UserCog,
  FileSearch,
  FileText,
  FileCheck,
  MapPin,
  BookOpen,
  BookA,
  BookMarked,
  ShieldAlert,
  ArrowRightLeft,
  Eye,
  Brain,
  Boxes,
  Search,
  Building2,
  Mic,
  ListTodo,
  Compass, CalendarRange } from 'lucide-react'
import type { UserRole } from '@/types/db'

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
  /** Si défini, un en-tête de section portant ce libellé est affiché AVANT
   *  cet item dans la nav (regroupement visuel léger, sans sous-menu). */
  groupStart?: string
  /** Item gated par une variable d'environnement serveur : masqué de la nav
   *  quand la feature est OFF (la route renvoie déjà 404 côté serveur). */
  envGate?: 'intervenants'
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV LOT 1 (audit 2026-09-06, GO Vincent) — le menu doit raconter le produit,
// pas lister les modules. Règle : une fonctionnalité peut continuer d'exister
// sans avoir une ligne permanente dans le menu. AUCUNE route supprimée : tout
// ce qui quitte le premier niveau reste accessible via « Plus » ou le hub
// Mémoire (/memoire).
//
// L'usage réel (activity_logs, 90 j) a validé la cible ligne à ligne : le
// desktop vivant = Aujourd'hui (950 vues), Chantiers (540), Planning (321),
// Bibliothèque (215), Réunions (212) ; six entrées étaient à 0 vue sur 30 j.
// ─────────────────────────────────────────────────────────────────────────────

/** Premier niveau — la proposition de valeur en cinq lignes.
 *  AMENDEMENT (audit × organisations, 2026-09-06) : Recherche n'est plus une
 *  destination permanente (6 vues / 1 utilisateur en 90 j) — elle reste
 *  accessible via le SearchOverlay de la topbar (existant) et le hub Mémoire. */
export const NAV_PRIMARY: NavItem[] = [
  // « Aujourd'hui » : le point d'atterrissage réel (ex-« Tableau de bord »,
  // route inchangée). L'absorption fonctionnelle du Briefing viendra au lot 2.
  { href: '/dashboard', label: "Aujourd'hui", icon: Sparkles,      roles: ['admin', 'manager'] },
  { href: '/sites',     label: 'Chantiers',   icon: MapPin,        roles: ['admin', 'manager'] },
  // Actions = cockpit transverse (« que dois-je piloter, tous chantiers ? »).
  // Badge : comportement existant conservé (correctif = lot dédié).
  { href: '/actions',   label: 'Actions',     icon: ListTodo,      roles: ['admin', 'manager'] },
  // PLANNING — une seule entrée (PL6-R4) ; Réunions et Journal vivent désormais
  // sous « Plus » et dans les fiches (chantier → Réunions, etc.).
  { href: '/mois',      label: 'Planning',    icon: CalendarRange, roles: ['admin', 'manager'] },
  // Mémoire = HUB (/memoire refondu) : Interroger (CTA) · Bibliothèque ·
  // Recherche mémoire · Continuité (Démarrages, Passages) · Preuves.
  { href: '/memoire',   label: 'Mémoire',     icon: Brain,         roles: ['admin', 'manager'] },
]

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** « Plus » — profondeur fonctionnelle sans ligne permanente au premier niveau. */
export const NAV_PLUS: NavGroup[] = [
  {
    title: 'Activité',
    items: [
      // Réunions = objet métier central, mais 212 vues/90 j ne justifient pas une
      // ligne de premier niveau : accessible ici + Planning + fiche chantier.
      { href: '/meetings', label: 'Réunions', icon: Mic,          roles: ['admin', 'manager'] },
      // « Journal » (journal des interventions, route /planning historique).
      { href: '/planning', label: 'Journal',  icon: CalendarDays, roles: ['admin', 'manager', 'chef_equipe'] },
      // Le Briefing est un rituel, pas une destination (0 vue/30 j) ; il migrera
      // en carte d'Aujourd'hui (lot 2). Route vivante.
      { href: '/briefing', label: 'Briefing du soir', icon: CalendarCheck, roles: ['admin', 'manager'] },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { href: '/clients',      label: 'Clients',  icon: Building2,     roles: ['admin', 'manager'] },
      { href: '/missions',     label: 'Missions', icon: ClipboardList, roles: ['admin', 'manager'] },
      // Affaires (table `dossiers`) : une affaire naît à la prévisite, l'AO n'est
      // qu'un épisode. Ménage Clients/Missions/Affaires/Contrats = audit séparé (lot 4).
      { href: '/opportunites', label: 'Affaires', icon: Compass,       roles: ['admin', 'manager'] },
      { href: '/contracts',    label: 'Contrats', icon: FileCheck,     roles: ['admin', 'manager'] },
      { href: '/equipes',      label: 'Équipes',  icon: Users,         roles: ['admin', 'manager'] },
      // Acteurs : gated env INTERVENANTS_PAGE_ENABLED — désormais MASQUÉ de la nav
      // quand OFF (l'ancienne nav montrait un lien menant à un 404). Fusion réelle
      // Équipes/Acteurs en une expérience = lot 5.
      { href: '/intervenants', label: 'Acteurs',  icon: UserCog,       roles: ['admin', 'manager'], envGate: 'intervenants' },
    ],
  },
]

/** Entrées du hub Mémoire (/memoire) — consommées par la page hub, pas par la sidebar. */
export const MEMORY_HUB: Array<NavItem & { description: string }> = [
  // Bibliothèque d'abord : 4e écran desktop le plus utilisé — le hub la met en avant.
  { href: '/documents', label: 'Bibliothèque',          icon: BookOpen,      roles: ['admin', 'manager'], description: 'La bibliothèque documentaire vivante : plans, PV, notices, classés par collection.' },
  { href: '/recherche', label: 'Recherche mémoire',     icon: Search,        roles: ['admin', 'manager'], description: 'Recherche déterministe dans toutes les traces : observations, décisions, actions, documents.' },
  { href: '/tenders',   label: 'Dossiers de démarrage', icon: FileText,      roles: ['admin', 'manager'], description: 'Les dossiers d’AO et de démarrage : extraction, analyse, conversion en contrat.' },
  { href: '/handovers', label: 'Passages de témoin',    icon: ArrowRightLeft, roles: ['admin', 'manager'], description: 'La continuité : fins de contrat à anticiper, briefs de passation, mémoire transmise.' },
  { href: '/preuves',   label: 'Dossier de preuves',    icon: FileSearch,    roles: ['admin', 'manager'], description: 'Retrouver la preuve d’une intervention : photos, validations, anomalies traitées.' },
]

/** Guides + Admin — inchangés (déjà groupés en bas de nav). */
export const NAV_FOOTER: NavItem[] = [
  { href: '/manuel',     label: 'Manuel',                 icon: BookMarked, roles: ['admin', 'manager'], groupStart: 'Guides' },
  { href: '/glossaire',  label: 'Glossaire métier',       icon: BookA,      roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/comprendre/memoire-ia',   label: 'Comprendre la mémoire', icon: Brain, roles: ['admin', 'manager'] },
  { href: '/comprendre/architecture', label: 'Comprendre l’archi',    icon: Boxes, roles: ['admin'] },
  { href: '/admin',          label: 'Administration', icon: ShieldAlert, roles: ['admin'], groupStart: 'Admin' },
  { href: '/admin/depenses-ia', label: 'Dépenses IA', icon: Eye,         roles: ['admin'] },
]

/**
 * Export de COMPATIBILITÉ : liste plate de toutes les entrées (même population de
 * routes qu'avant le lot 1 — aucune route perdue). Consommé par MobileNav,
 * pilot-metrics, user-journey et les tests de doctrine. La hiérarchie visuelle
 * de la sidebar vit dans NAV_PRIMARY / NAV_PLUS / NAV_FOOTER.
 */
export const NAV: NavItem[] = [
  ...NAV_PRIMARY,
  ...NAV_PLUS.flatMap((g) => g.items.map((it, j) => (j === 0 ? { ...it, groupStart: g.title } : it))),
  ...NAV_FOOTER,
]

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}
