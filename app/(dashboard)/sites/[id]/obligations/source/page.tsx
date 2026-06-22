import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Quote, FileText, ExternalLink, ArrowLeft, ChevronDown, AlertTriangle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getObligationOrigin } from '@/lib/db/obligations'
import { citationLevel } from '@/lib/engagements/citation'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'

export const dynamic = 'force-dynamic'

// Sprint C1 — provenance NAVIGABLE, avec 3 niveaux de CONFIANCE (Vincent) : jamais de
// fausse page. exact (page fiable) → ouvre la page. section (chapitre, pas de page) →
// ouvre le document à rechercher. approximate → pas de bouton page, l'extrait reste la trace.
export default async function ObligationSourcePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ o?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { o } = await searchParams
  if (!o) notFound()
  const origin = await getObligationOrigin(o)
  if (!origin) notFound()

  const level = citationLevel(origin.page, origin.section)
  // PDF : on n'ouvre à une page PRÉCISE que si la page est fiable (niveau exact).
  const pdfExact = level === 'exact' && origin.pdfUrl ? `${origin.pdfUrl}#page=${origin.page}&view=FitH` : null
  const pdfWhole = origin.pdfUrl ? `${origin.pdfUrl}#view=FitH` : null

  return (
    <div className="space-y-4 w-full max-w-2xl">
      <DynamicCrumb segmentId="source" label="Source" />
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${id}/obligations`, label: 'Obligations' }]} />

      <Link href={`/sites/${id}/obligations`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
        <ArrowLeft className="h-3.5 w-3.5" /> Retour aux obligations
      </Link>

      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Engagement</p>
        <h1 className="text-xl font-semibold">{origin.obligationLabel}</h1>
      </header>

      {/* LE PASSAGE — héros. L'extrait verbatim est la preuve fiable ; la localisation
          s'affiche selon son niveau de confiance. */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {origin.filename && (<><dt className="text-muted-foreground">Source</dt><dd className="font-medium">{origin.filename}</dd></>)}
          {level === 'exact' && (<><dt className="text-muted-foreground">Page</dt><dd className="font-medium tabular-nums">{origin.page}</dd></>)}
          {origin.section && (<><dt className="text-muted-foreground">Chapitre</dt><dd className="font-medium">{origin.section}</dd></>)}
        </dl>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 inline-flex items-center gap-1.5">
            <Quote className="h-3.5 w-3.5 text-sky-600" /> Extrait
          </p>
          {origin.excerpt ? (
            <blockquote className="text-[15px] leading-relaxed italic text-foreground/90 border-l-2 border-sky-300 pl-4">
              « {origin.excerpt} »
            </blockquote>
          ) : (
            <p className="text-xs text-muted-foreground italic">Aucun extrait conservé.</p>
          )}
        </div>

        {/* Action adaptée au niveau de confiance. */}
        {level === 'exact' && pdfExact && (
          <a href={pdfExact} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/40">
            <ExternalLink className="h-3.5 w-3.5" /> Ouvrir le PDF à la page {origin.page}
          </a>
        )}
        {level === 'section' && pdfWhole && (
          <div className="space-y-1">
            <a href={pdfWhole} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/40">
              <ExternalLink className="h-3.5 w-3.5" /> Ouvrir le document
            </a>
            <p className="text-[11px] text-muted-foreground">Page non identifiée de façon fiable — cherchez l&apos;extrait{origin.section ? ` au chapitre ${origin.section}` : ''}.</p>
          </div>
        )}
        {level === 'approximate' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800 inline-flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Référence approximative : l&apos;IA a identifié cette exigence dans le document mais n&apos;a pas de localisation fiable. L&apos;extrait ci-dessus reste la trace exacte.</span>
          </div>
        )}
      </section>

      {/* PDF intégré — uniquement quand la page est FIABLE (sinon on n'oriente pas vers une fausse page). */}
      {level === 'exact' && pdfExact && (
        <details className="rounded-xl border bg-card overflow-hidden group">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-muted/30">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            Voir le passage dans le document (page {origin.page})
          </summary>
          <iframe
            src={pdfExact}
            title={`${origin.filename ?? 'Document source'} — page ${origin.page}`}
            className="w-full h-[calc(100vh-14rem)] min-h-[460px] border-t"
          />
        </details>
      )}
    </div>
  )
}
