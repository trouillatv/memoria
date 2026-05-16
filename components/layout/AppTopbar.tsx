import type { UserRole } from '@/types/db'
import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'
import { Breadcrumb } from './Breadcrumb'
import { SearchOverlay } from './SearchOverlay'
import { MobileNav } from './MobileNav'

export function AppTopbar({ fullName, role }: { fullName: string; role: UserRole }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-card px-4 md:px-6">
      <MobileNav role={role} fullName={fullName} />
      <Breadcrumb />
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <SearchOverlay />
        <span
          className="hidden lg:inline text-xs text-muted-foreground max-w-[18ch] truncate"
          title={fullName}
        >
          {fullName}
        </span>
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  )
}
