import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Quote, FileText, ExternalLink, ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getObligationOrigin } from '@/lib/db/obligations'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'

export const dynamic = 'force-dynamic'

// Sprint C1 — provenance NAVIGABLE : « origine : CCTP p.148 » → cette page ouvre le
// PDF source à la bonne page (viewer natif, #page=N) avec l'extrait cité à côté.
// Pas de pdf.js, pas de surlignage : robuste, vérifiable en un clic.
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
    <div className="space-y-4 w-full">
      <DynamicCrumb segmentId="source" label="Source" />
      <BreadcrumbPrefix crumbs={[{ href: '/sites', label: 'Sites' }, { href: `/sites/${id}/obligations`, label: 'Obligations' }]} />

      <Link href={`/sites/${id}/obligations`} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> Obligations
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{origin.obligationLabel}</h1>
        <p className="text-xs text-muted-foreground">
          Origine contractuelle{origin.ref ? ` · ${origin.ref}` : ''} — vérifiez la clause directement dans le document source.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* Extrait cité — à côté du PDF (Vincent : « affiche l'extrait source à côté »). */}
        <aside className="space-y-3 lg:sticky lg:top-4">
          <div className="rounded-xl border bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold inline-flex items-center gap-2"><Quote className="h-4 w-4 text-sky-600" /> Extrait source</h2>
            {origin.excerpt ? (
              <blockquote className="text-sm italic text-foreground/90 border-l-2 border-sky-300 pl-3">« {origin.excerpt} »</blockquote>
            ) : (
              <p className="text-xs text-muted-foreground italic">Aucun extrait conservé.</p>
            )}
            {origin.ref && <p className="text-[11px] text-muted-foreground">Référence : {origin.ref}</p>}
          </div>
          {pdfSrc && (
            <a href={pdfSrc} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
              <ExternalLink className="h-3.5 w-3.5" /> Ouvrir le PDF dans un onglet
            </a>
          )}
        </aside>

        {/* PDF ouvert à la bonne page (viewer natif du navigateur via iframe + #page=N). */}
        <div className="rounded-xl border bg-card overflow-hidden">
          {pdfSrc ? (
            <iframe
              src={pdfSrc}
              title={`${origin.filename ?? 'Document source'} — page ${origin.page ?? 1}`}
              className="w-full h-[calc(100vh-12rem)] min-h-[480px]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="text-sm">Document source indisponible.</p>
              <p className="text-xs max-w-sm">L&apos;extrait ci-contre reste la trace de la clause d&apos;origine.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
