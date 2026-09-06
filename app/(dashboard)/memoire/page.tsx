import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Brain, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { MEMORY_HUB } from '@/components/layout/nav-items'
import { OrgMemoryQuery } from './OrgMemoryQuery'

export const dynamic = 'force-dynamic'

// NAV LOT 1 (2026-09-06) — /memoire devient le HUB Mémoire : « Interroger
// l'entreprise » reste le CTA principal (même composant, même route), et les
// surfaces mémoire qui quittaient le premier niveau du menu (Bibliothèque,
// Recherche, Dossiers de démarrage, Passages de témoin, Preuves) sont exposées
// ici. Aucune route supprimée — le hub ne fait que donner une porte lisible.

export default async function MemoirePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  return (
    <div className="space-y-8 w-full max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Brain className="h-5 w-5 text-muted-foreground" />
          Mémoire
        </h1>
        <p className="text-sm text-muted-foreground">
          Ce que l&apos;entreprise sait : interrogez-la, cherchez une trace, retrouvez un
          document ou une preuve, préparez une passation.
        </p>
        {/* Les DEUX mémoires, nommées (doctrine 2026-07-13) : l'utilisateur doit
            comprendre pourquoi certaines connaissances se réutilisent partout. */}
        <p className="text-xs text-muted-foreground/80">
          Ici, c&apos;est la <strong>mémoire de l&apos;entreprise</strong> : ce que vos chantiers
          vous ont appris, réutilisable sur tous vos projets. La <strong>mémoire du
          chantier</strong> (visites, réunions, preuves) vit, elle, sur chaque fiche chantier.
        </p>
      </header>

      {/* CTA principal — Interroger l'entreprise (inchangé fonctionnellement). */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Interroger l&apos;entreprise</h2>
        <OrgMemoryQuery />
      </section>

      {/* Les surfaces mémoire — Bibliothèque en tête (surface réellement utilisée). */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Explorer</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {MEMORY_HUB.filter((e) => e.roles.includes(user.role)).map(({ href, label, icon: Icon, description }) => (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
