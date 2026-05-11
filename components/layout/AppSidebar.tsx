import Link from 'next/link'
import { LayoutDashboard, FileText, ClipboardList, FileBarChart, BookOpen, ShieldAlert, FileCheck, Sparkles, FileSearch, Users } from 'lucide-react'
import type { UserRole } from '@/types/db'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Tableau de bord',  icon: Sparkles,      roles: ['admin', 'manager'] },
  { href: '/missions',  label: 'Missions',         icon: ClipboardList, roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/equipes',   label: 'Équipes',           icon: Users,         roles: ['admin', 'manager'] },
  { href: '/preuves',   label: 'Dossier de preuves', icon: FileSearch,   roles: ['admin', 'manager'] },
  { href: '/tenders',   label: "Appels d'offres",  icon: FileText,      roles: ['admin', 'manager'] },
  { href: '/contracts', label: 'Contrats',          icon: FileCheck,     roles: ['admin', 'manager'] },
  { href: '/library',   label: 'Bibliothèque',     icon: BookOpen,      roles: ['admin', 'manager'] },
  { href: '/reports',   label: 'Rapports',         icon: FileBarChart,  roles: ['admin', 'manager'] },
  { href: '/admin',     label: 'Administration',   icon: ShieldAlert,   roles: ['admin'] },
]

export function AppSidebar({ role, fullName }: { role: UserRole; fullName: string }) {
  const visible = NAV.filter((n) => n.roles.includes(role))
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-card">
      <div className="flex h-16 items-center border-b px-4">
        <Link href={role === 'admin' || role === 'manager' ? '/dashboard' : '/missions'} className="flex items-center gap-2 font-semibold">
          <LayoutDashboard className="h-5 w-5 text-brand-600" />
          <span>NetoIAge</span>
        </Link>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {visible.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-2">
        <Link
          href="/account"
          className="block rounded-md px-2 py-2 hover:bg-accent transition-colors"
          title="Mon compte"
        >
          <div className="text-xs text-muted-foreground truncate">{fullName}</div>
          <div className="text-xs">{role}</div>
        </Link>
      </div>
    </aside>
  )
}
