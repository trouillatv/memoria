import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'
import { Breadcrumb } from './Breadcrumb'

export function AppTopbar({ fullName }: { fullName: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-card px-4 md:pl-64">
      <Breadcrumb />
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="hidden lg:inline text-xs text-muted-foreground max-w-[16ch] truncate"
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
