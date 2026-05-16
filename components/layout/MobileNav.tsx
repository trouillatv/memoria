'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, LayoutDashboard } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types/db'
import { NAV, isActive } from './nav-items'

export function MobileNav({ role, fullName }: { role: UserRole; fullName: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname() ?? ''

  // Fermeture automatique après navigation
  useEffect(() => { setOpen(false) }, [pathname])

  const visible = NAV.filter((n) => n.roles.includes(role))

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label="Ouvrir le menu"
            className="md:hidden flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          />
        }
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-14 items-center border-b px-4">
          <Link
            href={role === 'admin' || role === 'manager' ? '/dashboard' : '/missions'}
            className="flex items-center gap-2 font-semibold"
            onClick={() => setOpen(false)}
          >
            <LayoutDashboard className="h-5 w-5 text-brand-600" />
            <span>MemorIA</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visible.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    active ? 'text-brand-600' : 'text-muted-foreground',
                  )}
                />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t p-3">
          <Link
            href="/account"
            className="block rounded-md px-3 py-2 hover:bg-accent transition-colors"
            onClick={() => setOpen(false)}
          >
            <div className="text-xs text-muted-foreground truncate">{fullName}</div>
            <div className="text-xs text-muted-foreground">{role}</div>
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}
