'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { UserRole } from '@/types/db'

const NAV = [
  { href: '/missions', label: 'Missions',          roles: ['admin', 'manager', 'chef_equipe'] },
  { href: '/tenders',  label: 'Dossiers de démarrage', roles: ['admin', 'manager'] },
  // Option C : « Bibliothèque » → expérience documentaire vivante (/documents).
  // /library (savoir curé) reste intacte, hors menu principal.
  { href: '/documents', label: 'Bibliothèque',      roles: ['admin', 'manager'] },
  { href: '/reports',  label: 'Rapports',          roles: ['admin', 'manager'] },
  { href: '/admin',    label: 'Administration',    roles: ['admin'] },
] as const

export function MobileSheetMenu({ role }: { role: UserRole }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-60">
        <nav className="space-y-1 mt-8">
          {NAV.filter((n) => (n.roles as readonly UserRole[]).includes(role)).map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-accent">
              {n.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
