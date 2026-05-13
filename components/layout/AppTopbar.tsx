import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'
import { Breadcrumb } from './Breadcrumb'

export function AppTopbar({ fullName }: { fullName: string }) {
  // Header bar : sur desktop (>= md), pas de padding-left (le `md:pl-60`
  // du parent gère déjà l'offset sidebar). Sur le main content area, le
  // breadcrumb démarre donc dès le bord gauche du contenu — plus visible,
  // moins flottant.
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-card px-4 md:px-6">
      <Breadcrumb />
      <div className="flex items-center gap-2 shrink-0">
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
