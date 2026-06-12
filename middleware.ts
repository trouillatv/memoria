// Middleware Next.js — actuellement no-op (réservé pour de futures guards).
//
// Décision 2026-06-12 : pas de redirect UA mobile → /m.
// Guillaume (manager) veut son dashboard même sur téléphone.
// La surface terrain /m est accessible via :
//   - manifest.webmanifest start_url=/m (PWA installée)
//   - Navigation directe ou "Version bureau →" dans le footer de /m
//   - La redirection chef_equipe reste dans (dashboard)/layout.tsx

import { NextRequest, NextResponse } from 'next/server'

export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
