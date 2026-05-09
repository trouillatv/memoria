import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'

export function AppTopbar({ fullName }: { fullName: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-card px-4 md:pl-64">
      <div className="text-sm text-muted-foreground">{fullName}</div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  )
}
