import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Quote, FileText, ExternalLink, ArrowLeft, ChevronDown } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getObligationOrigin } from '@/lib/db/obligations'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'

export const dynamic = 'force-dynamic'

// Sprint C1 (affiné, Vincent) — Usage 1 « montre-moi le passage » : l'EXTRAIT est le
// héros (source / page / chapitre / extrait complet), le PDF est SECONDAIRE (replié).
// Ouvrir un PDF de 300 pages même à la bonne page est un mauvais réflexe. Pas de pdf.js.
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

  const pdfSrc = origin.pdfUrl ? `${origin.pdfUrl}#page=${origin.page ?? 1}&view=FitH` : null

  return (
    <div className="space-y-4 w-full max-w-2xl">
      <DynamicCrumb segmentId="source" label="Source" />
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${id}/obligations`, label: 'Obligations' }]} />

      <Link href={`/sites/${id}/obligations`} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> Obligations
      </Link>

      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Engagement</p>
        <h1 className="text-xl font-semibold">{origin.obligationLabel}</h1>
      </header>

      {/* LE PASSAGE — héros. « Montre-moi le passage », pas « ouvre-moi le document ». */}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {origin.filename && (<><dt className="text-muted-foreground">Source</dt><dd className="font-medium">{origin.filename}</dd></>)}
          {origin.page != null && (<><dt className="text-muted-foreground">Page</dt><dd className="font-medium tabular-nums">{origin.page}</dd></>)}
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

        {pdfSrc && (
          <a href={pdfSrc} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted/40">
            <ExternalLink className="h-3.5 w-3.5" /> Ouvrir le PDF à la page {origin.page ?? 1}
          </a>
        )}
      </section>

      {/* PDF — SECONDAIRE, replié. La confirmation visuelle si on veut voir la page entière. */}
      {pdfSrc ? (
        <details className="rounded-xl border bg-card overflow-hidden group">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-muted/30">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            Voir le passage dans le document {origin.page != null ? `(page ${origin.page})` : ''}
          </summary>
          <iframe
            src={pdfSrc}
            title={`${origin.filename ?? 'Document source'} — page ${origin.page ?? 1}`}
            className="w-full h-[calc(100vh-14rem)] min-h-[460px] border-t"
          />
        </details>
      ) : (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Document source indisponible — l&apos;extrait ci-dessus reste la trace de la clause d&apos;origine.
        </p>
      )}
    </div>
  )
}
