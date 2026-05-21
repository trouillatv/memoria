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
  ShieldAlert,
} from 'lucide-react'
import type { UserRole } from '@/types/db'

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

export const NAV: NavItem[] = [
  { href: '/dashboard',  label: 'Tableau de bord',       icon: Sparkles,      roles: ['admin', 'manager'] },
  { href: '/aujourdhui', label: 'Interventions du jour',  icon: ListChecks,    roles: ['admin', 'manager'] },
  { href: '/semaine',    label: 'Semaine',                icon: Calendar,      roles: ['admin', 'manager'] },
  { href: '/briefing',   label: 'Briefing du soir',       icon: CalendarCheck, roles: ['admin', 'manager'] },
  { href: '/missions',   label: 'Missions',               icon: ClipboardList, roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/equipes',    label: 'Équipes',                icon: Users,         roles: ['admin', 'manager'] },
  // Vincent 2026-05-21 — module Intervenants gated par ENV INTERVENANTS_PAGE_ENABLED.
  // Si la feature est désactivée côté serveur, la page renvoie 404 ; le lien reste
  // affiché mais inopérant (volontaire pour ne pas faire dépendre la nav d'une
  // lecture process.env côté client).
  { href: '/intervenants', label: 'Intervenants',          icon: UserCog,       roles: ['admin', 'manager'] },
  { href: '/preuves',    label: 'Dossier de preuves',     icon: FileSearch,    roles: ['admin', 'manager'] },
  { href: '/tenders',    label: "Appels d'offres",        icon: FileText,      roles: ['admin', 'manager'] },
  { href: '/contracts',  label: 'Contrats',               icon: FileCheck,     roles: ['admin', 'manager'] },
  { href: '/sites',      label: 'Sites',                  icon: MapPin,        roles: ['admin', 'manager'] },
  // Option C (Vincent 2026-05-19) : « Bibliothèque » = bibliothèque
  // documentaire vivante (/documents). /library (savoir curé knowledge_items)
  // reste intacte (route directe + lien contextuel AO) ; pas d'entrée
  // « Documents » séparée. Convergence knowledge_items→documents = tranche future.
  { href: '/documents',  label: 'Bibliothèque',           icon: BookOpen,      roles: ['admin', 'manager'] },
  { href: '/admin',      label: 'Administration',         icon: ShieldAlert,   roles: ['admin'] },
]

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}
