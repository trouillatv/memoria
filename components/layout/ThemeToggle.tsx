'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { updateThemePreferenceAction } from '@/app/(dashboard)/account/actions'

export function ThemeToggle() {
  const { setTheme } = useTheme()
  // Applique le thème ET le persiste en base (réappliqué au login, cross-device).
  function apply(theme: string) {
    setTheme(theme)
    void updateThemePreferenceAction(theme)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => apply('light')}>Clair</DropdownMenuItem>
        <DropdownMenuItem onClick={() => apply('dark')}>Sombre</DropdownMenuItem>
        <DropdownMenuItem onClick={() => apply('ocre')}>Ocre</DropdownMenuItem>
        <DropdownMenuItem onClick={() => apply('petrole')}>Pétrole</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
