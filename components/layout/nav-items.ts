import {
  Sparkles,
  ListChecks,
  Calendar,
  CalendarCheck,
  ClipboardList,
  Users,
  UserCog,
  FileSearch,
  FileText,
  FileCheck,
  MapPin,
  BookOpen,
  BookMarked,
  ShieldAlert,
  ArrowRightLeft,
  Eye,
  Brain,
  Boxes,
  Search,
  Building2,
} from 'lucide-react'
import type { UserRole } from '@/types/db'

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
  /** Si défini, un en-tête de section portant ce libellé est affiché AVANT
   *  cet item dans la nav (regroupement visuel léger, sans sous-menu). */
  groupStart?: string
}

// Ordre = importance / fréquence d'usage (Vincent 2026-05-26).
// 1) Pilotage quotidien (Semaine + Briefing gardés en haut) →
// 2) Cœur opérationnel (Missions/Sites/Contrats/Équipes) →
// 3) Mémoire & continuité (Intervenants/Passages/Continuité) →
// 4) Commercial & docs → 5) Guides → 6) Admin.
export const NAV: NavItem[] = [
  // — Recherche —
  { href: '/recherche',  label: 'Recherche',              icon: Search,        roles: ['admin', 'manager'] },
  // — Pilotage quotidien —
  { href: '/dashboard',  label: 'Tableau de bord',       icon: Sparkles,      roles: ['admin', 'manager'] },
  { href: '/aujourdhui', label: 'Interventions du jour',  icon: ListChecks,    roles: ['admin', 'manager'] },
  { href: '/semaine',    label: 'Semaine',                icon: Calendar,      roles: ['admin', 'manager'] },
  { href: '/briefing',   label: 'Briefing du soir',       icon: CalendarCheck, roles: ['admin', 'manager'] },
  // — Cœur opérationnel —
  { href: '/clients',    label: 'Clients',                icon: Building2,     roles: ['admin', 'manager'] },
  { href: '/missions',   label: 'Missions',               icon: ClipboardList, roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/sites',      label: 'Sites',                  icon: MapPin,        roles: ['admin', 'manager'] },
  { href: '/contracts',  label: 'Contrats',               icon: FileCheck,     roles: ['admin', 'manager'] },
  { href: '/equipes',    label: 'Équipes',                icon: Users,         roles: ['admin', 'manager'] },
  // — Mémoire & continuité —
  // Intervenants gated ENV INTERVENANTS_PAGE_ENABLED ; le lien reste visible
  // (404 si OFF) pour ne pas faire dépendre la nav d'un process.env côté client.
  { href: '/intervenants', label: 'Intervenants',          icon: UserCog,       roles: ['admin', 'manager'] },
  { href: '/tenders',    label: 'Dossiers de démarrage',  icon: FileText,      roles: ['admin', 'manager'] },
  // Passages de témoin — inclut désormais le radar « À anticiper » (fins de
  // contrat). Fusion 2026-05-27 de l'ancienne entrée « Continuité » (redondante,
  // source de confusion) ; /continuite redirige ici.
  { href: '/handovers',  label: 'Passages de témoin',     icon: ArrowRightLeft, roles: ['admin', 'manager'] },
  // — Preuves & documents —
  { href: '/preuves',    label: 'Dossier de preuves',     icon: FileSearch,    roles: ['admin', 'manager'] },
  // « Bibliothèque » = bibliothèque documentaire vivante (/documents).
  { href: '/documents',  label: 'Bibliothèque',           icon: BookOpen,      roles: ['admin', 'manager'] },
  // — Guides (les 3 regroupés sous l'en-tête « Guides ») —
  { href: '/manuel',     label: 'Manuel',                 icon: BookMarked,    roles: ['admin', 'manager'], groupStart: 'Guides' },
  { href: '/comprendre/memoire-ia',   label: 'Comprendre la mémoire', icon: Brain, roles: ['admin', 'manager'] },
  { href: '/comprendre/architecture', label: 'Comprendre l’archi',    icon: Boxes, roles: ['admin', 'manager'] },
  // — Admin —
  { href: '/admin',      label: 'Administration',         icon: ShieldAlert,   roles: ['admin'], groupStart: 'Admin' },
  { href: '/admin/observation', label: 'Observation pilote', icon: Eye,         roles: ['admin'] },
]

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}
