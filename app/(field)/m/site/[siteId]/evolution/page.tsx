import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteViewpointRows, getVisitCapturePreviewUrls } from '@/lib/db/visit-captures'
import { groupViewpointChains } from '@/lib/visits/viewpoints'
import { EvolutionViewer, type EvolutionPhoto } from './EvolutionViewer'

export const dynamic = 'force-dynamic'

/**
 * « Regarde l'évolution » (mig 195) — le comparateur des photos de référence.
 * Une série = le même cadrage repris visite après visite (caméra fantôme) ; ici
 * on la fait GLISSER dans le temps. C'est la scène de fin de chantier : poser
 * le téléphone devant le client, glisser, laisser le silence faire. Zéro IA.
 */
export default async function SiteEvolutionMobilePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ repere?: string }>
}) {
  const { siteId } = await params
  const { repere } = await searchParams
  // Un chantier d'une autre organisation doit être indiscernable d'un chantier
  // inexistant : la garde rend 404, jamais « accès refusé ».
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const rows = await listSiteViewpointRows(siteId).catch(() => [])
  const chains = groupViewpointChains(rows)
  const selected = chains.find((c) => c.anchorId === repere) ?? chains[0] ?? null

  // URLs signées de TOUTE la série sélectionnée (bornée par listSiteViewpointRows).
  const previews = selected
    ? await getVisitCapturePreviewUrls(selected.serie)
        .catch(() => ({} as Record<string, { url: string; mime: string | null }>))
    : {}
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea',
  })
  const photos: EvolutionPhoto[] = (selected?.serie ?? [])
    .map((c) => {
      const url = previews[c.id]?.url
      if (!url) return null
      return { url, dateLabel: dateFmt.format(new Date(c.captured_at ?? c.created_at)) }
    })
    .filter((p): p is EvolutionPhoto => p !== null)

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <h1 className="text-xl font-semibold">Évolution</h1>
        <p className="text-sm text-muted-foreground">
          Le même cadrage, visite après visite.
        </p>
      </header>

      {chains.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Pas encore de photo de référence. Pendant une visite, épinglez une photo (📌) —
            MemorIA vous proposera de la refaire au même cadrage à chaque passage, et
            l&apos;évolution se racontera ici toute seule.
          </p>
        </div>
      ) : (
        <>
          {/* Choix de la série quand il y en a plusieurs (Porte d'entrée, Zone cuisson…). */}
          {chains.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {chains.map((c) => (
                <Link
                  key={c.anchorId}
                  href={`/m/site/${siteId}/evolution?repere=${c.anchorId}`}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    c.anchorId === selected?.anchorId
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'text-muted-foreground'
                  }`}
                >
                  {c.label ?? 'Photo de référence'} · {c.shots}
                </Link>
              ))}
            </div>
          )}

          {photos.length > 0 ? (
            <EvolutionViewer photos={photos} />
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Les photos de cette série ne sont pas encore disponibles.
            </p>
          )}
        </>
      )}
    </div>
  )
}
