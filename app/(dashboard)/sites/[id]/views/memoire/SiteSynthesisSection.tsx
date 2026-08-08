import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { generateSiteStory } from '@/services/ai/site-story'

export function SiteSynthesisSkeleton() {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-muted animate-pulse" />
        <div className="h-3 w-32 rounded bg-muted animate-pulse" />
      </div>
      <div className="mb-1.5 h-4 w-3/4 rounded bg-muted animate-pulse" />
      <div className="space-y-2 mt-3">
        <div className="h-3 w-full rounded bg-muted animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
      </div>
    </section>
  )
}

export async function SiteSynthesisSection({ siteId }: { siteId: string }) {
  const story = await generateSiteStory(siteId, null).catch(() => null)
  if (!story || !story.narrative) return null

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Synthèse du chantier
        </span>
      </div>

      {story.headline && (
        <p className="mb-2.5 text-base font-semibold leading-snug text-foreground">
          {story.headline}
        </p>
      )}

      <p className="text-sm leading-relaxed text-foreground/80">
        {story.narrative}
      </p>

      {story.keyFindings.length > 0 && (
        <ul className="mt-3.5 space-y-2 border-t pt-3.5">
          {story.keyFindings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0 h-1.5 w-1.5 rounded-full bg-foreground/30" />
              <span className="leading-snug text-foreground/80">
                {f.text}
                {f.subjectId && (
                  <> {' '}<Link
                    href={`/sites/${siteId}/historique/sujets/${f.subjectId}`}
                    className="ml-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Voir le sujet →
                  </Link></>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3.5 text-[11px] text-muted-foreground">
        Basé sur {story.subjectCount} sujet{story.subjectCount > 1 ? 's' : ''} actif{story.subjectCount > 1 ? 's' : ''}
        {story.linkCount > 0 && ` et ${story.linkCount} relation${story.linkCount > 1 ? 's' : ''} confirmée${story.linkCount > 1 ? 's' : ''}`}.
        {' '}Généré par IA — peut contenir des imprécisions.
      </p>
    </section>
  )
}
