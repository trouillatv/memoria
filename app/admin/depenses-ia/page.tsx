// /admin/depenses-ia — refonte 2026-06-15.
//
// Contrôle des dépenses IA, priorité explicite de l'admin : combien ça coûte
// (XPF), où, est-ce que ça marche, qu'est-ce que ça produit. Regroupe l'ancien
// « Monitoring IA » (APIs + Console + Production) sans sous-onglets, et expose
// le Backfill comme une action.

import { Suspense } from 'react'
import Link from 'next/link'
import { Database, ArrowRight } from 'lucide-react'
import { AIHealthSection } from '../monitoring/AIHealthSection'
import { AIMemorySection } from '../monitoring/AIMemorySection'

export const dynamic = 'force-dynamic'

export default function AdminDepensesIaPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dépenses IA</h1>
        <p className="text-sm text-muted-foreground">
          Combien l&apos;IA coûte, où, si elle fonctionne et ce qu&apos;elle produit. Coûts en XPF.
        </p>
      </div>

      {/* Coûts + santé + derniers appels (le plus important en premier). */}
      <Suspense fallback={null}>
        <AIMemorySection subtab="console" />
      </Suspense>

      {/* Production IA (résonances, documents analysés). */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Production IA</h2>
        <Suspense fallback={null}>
          <AIMemorySection subtab="production" />
        </Suspense>
      </section>

      {/* Santé des API IA (embeddings). */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">APIs IA — Mémoire</h2>
        <Suspense fallback={null}>
          <AIHealthSection />
        </Suspense>
      </section>

      {/* Backfill — action (ex-onglet). */}
      <Link
        href="/admin/backfill"
        className="group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/20"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Database className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Backfill des embeddings</div>
            <div className="text-xs text-muted-foreground">Re-vectoriser la bibliothèque et les dossiers (action ponctuelle).</div>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  )
}
