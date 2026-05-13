// Slice S3 — Layout pour /v/[token] (vérification authentique permanente).
//
// Plus sobre que /p/[token] : juste l'attestation, pas de contenu. Mais même
// structure visuelle pour cohérence (le client passe de l'un à l'autre).

import { ShieldCheck } from 'lucide-react'

export default function VerificationLayout({
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
            <div className="text-sm font-semibold leading-tight">NetoIAge</div>
            <div className="text-xs text-muted-foreground leading-tight">
              Vérification d&apos;authenticité
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-6 sm:py-8 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          {children}
        </div>
      </main>

      <footer className="py-4 px-4 sm:px-6 border-t bg-card text-center">
        <p className="text-xs text-muted-foreground">
          Vérification d&apos;authenticité · Infrastructure NetoIAge
        </p>
      </footer>
    </div>
  )
}
