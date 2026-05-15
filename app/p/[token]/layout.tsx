// Slice B.4 — Layout public autonome pour /p/[token].
//
// Doctrine impérative :
//   - Pas de sidebar dashboard. Pas de topbar avec menu utilisateur. Le
//     visiteur n'est pas authentifié, on ne lui propose rien.
//   - Sobriété B2B : un header minimaliste (icône ShieldCheck + tagline), un
//     footer "document partagé en lecture seule". Aucun CTA marketing.
//   - Container max-w-4xl centré, fond muted/20 calme.
//   - Mobile-first : le client peut consulter sur son téléphone.
//
// Hérite du root layout (Inter font + ThemeProvider). Pas de provider
// supplémentaire ici — la page est statique, server-rendered, aucune
// interactivité au-delà de la lightbox photo (client component existant).

import { ShieldCheck } from 'lucide-react'

export default function PublicProofLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      <header className="bg-card border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">MemorIA</div>
            <div className="text-xs text-muted-foreground leading-tight">
              Dossier de preuves vérifiable
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-6 sm:py-8 px-4 sm:px-6">
        {/* "Document officiel encadré" — un cadre clair sur fond muted
            permet au client mécontent de percevoir le sérieux du dossier.
            Le shadow-sm reste discret pour rester sobre. */}
        <div className="max-w-4xl mx-auto bg-card border border-border rounded-xl shadow-sm p-5 sm:p-7">
          {children}
        </div>
      </main>

      <footer className="py-4 px-4 sm:px-6 border-t bg-card text-center">
        <p className="text-xs text-muted-foreground">
          Document partagé en lecture seule · MemorIA — système de capital de preuves
        </p>
      </footer>
    </div>
  )
}
