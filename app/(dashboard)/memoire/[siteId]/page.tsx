// V5.1 Slice 5 — Page Atelier mémoire / Résonances pour un site.
//
// Doctrine Vincent 2026-05-14 :
//   - Nom UI : "Atelier mémoire" (JAMAIS "Atelier IA").
//   - L'IA reste invisible comme moteur. Pas de label "AI", "IA", "Powered by".
//   - 3 verbes : voici / fait écho-se ressemblent / persiste-cesse.
//   - Bouton "Voir toutes les traces" toujours visible (échappatoire à la curation).
//
// Cf. plan V5.1.2 § Slice 5 + lib/ai/memory-resonances.ts + lib/ai/forbidden-words.ts.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteById } from '@/lib/db/sites'
import { findResonance } from '@/lib/ai/memory-resonances'

interface PageProps {
  params: Promise<{ siteId: string }>
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

function eventTypeLabel(type: 'anomaly' | 'site_note' | 'intervention'): string {
  if (type === 'anomaly') return 'anomalie'
  if (type === 'site_note') return 'note'
  return 'passage'
}

export default async function MemoireSitePage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { siteId } = await params
  const site = await getSiteById(siteId)
  if (!site) notFound()

  const resonance = await findResonance(siteId, { periodDays: 180, topK: 5 })

  return (
    <div className="space-y-6 w-full">
      <header className="space-y-1">
        <Link
          href={`/sites/${siteId}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {site.name}
        </Link>
        <h1 className="text-2xl font-semibold">Atelier mémoire</h1>
      </header>

      {resonance ? (
        <section className="space-y-4">
          {/* Intro pré-rédigée, conforme wording verrouillé (3 verbes) */}
          <p className="text-base leading-relaxed">{resonance.intro}</p>

          <ol className="space-y-3">
            {resonance.events.map((e) => {
              const href = e.interventionId ? `/interventions/${e.interventionId}` : null
              const inner = (
                <div className="border-l-2 border-muted pl-3 py-1">
                  <div className="text-[12px] text-muted-foreground uppercase tracking-wider">
                    {formatEventDate(e.occurredAt)} · {eventTypeLabel(e.type)}
                  </div>
                  <p className="text-sm mt-0.5 line-clamp-3">{e.text}</p>
                </div>
              )
              return (
                <li key={`${e.type}-${e.id}`}>
                  {href ? <Link href={href} className="block hover:bg-muted/30 rounded-sm">{inner}</Link> : inner}
                </li>
              )
            })}
          </ol>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Pas de résonance détectée ce mois-ci.
        </p>
      )}

      {/* Échappatoire à la curation — toujours visible */}
      <div className="pt-4 border-t">
        <Link
          href={`/sites/${siteId}`}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Voir toutes les traces du site →
        </Link>
      </div>
    </div>
  )
}
