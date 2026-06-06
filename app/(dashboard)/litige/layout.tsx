// Sprint 3 — UX-8 Mode litige express : layout immersif.
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - L'interface ENTIÈRE change en mode crise (pas une page de plus).
//   - Pas d'AppSidebar, pas d'AppTopbar, pas de menu.
//   - Background gris uniforme, container centré max-w-2xl.
//   - Header minimal : « Quitter le mode défense » + titre passif.
//   - Wording strictement passif descriptif : « Préparation de défense ».
//     JAMAIS « Attaque », « Alerte », « Urgence ».
//
// Note : on hérite quand même de l'auth du parent (dashboard/layout.tsx).

import Link from 'next/link'
import { ChevronLeft, Shield } from 'lucide-react'

export default function LitigeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 -mx-4 md:-mx-8 -my-6 md:-my-6 -mb-24 md:-mb-6">
      {/* Le -mx/-my « casse » le padding du <main> du parent dashboard layout
          pour vraiment occuper toute la surface (mode immersif).
          Pas de sidebar visible (elle est masquée par l'overlay full-bleed). */}
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="w-full px-4 md:px-8 py-3 flex items-center justify-between">
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              data-testid="litige-quit"
            >
              <ChevronLeft className="h-4 w-4" />
              Quitter le mode défense
            </Link>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Shield className="h-4 w-4 text-amber-600" aria-hidden />
              Préparation de défense
            </div>
          </div>
        </header>
        <main className="w-full px-4 md:px-8 py-8">{children}</main>
      </div>
    </div>
  )
}
