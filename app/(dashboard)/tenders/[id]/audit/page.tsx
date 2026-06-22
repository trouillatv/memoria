import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ScanSearch } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getTender, getTenderDocument } from '@/lib/db/tenders'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { paragraphAround } from '@/lib/pdf/paragraph'
import { pagesContaining, glossaryFormsForLabel } from '@/lib/pdf/occurrences'
import { listGlossaryTerms } from '@/lib/db/glossary'
import { createAdminClient } from '@/lib/supabase/admin'
import { DocumentAudit, type AuditEngagement } from './DocumentAudit'

export const dynamic = 'force-dynamic'

// Niveau 2 — Audit documentaire d'un AO : le PDF complet + tous les engagements
// détectés, navigables. « Voir tout ce qui a été détecté, page par page. »
export default async function TenderAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/')

  const { id } = await params
  const [tender, doc, engagements, glossary] = await Promise.all([
    getTender(id), getTenderDocument(id), listEngagementsByTender(id),
    listGlossaryTerms().catch(() => []),
  ])
  if (!tender) notFound()

  let pdfUrl: string | null = null
  if (doc?.storage_path) {
    const sb = createAdminClient()
    const { data } = await sb.storage.from('tender-documents').createSignedUrl(doc.storage_path, 3600)
    pdfUrl = data?.signedUrl ?? null
  }

  // Tri par page (l'audit suit le document) ; pages inconnues à la fin.
  const docText = doc?.extracted_text ?? null
  const items: AuditEngagement[] = engagements
    .map((e) => {
      const ref = (e.source_ref ?? {}) as { page?: unknown; section?: unknown }
      // Occurrences : pages où le terme canonique (glossaire) apparaît dans le doc.
      const forms = glossaryFormsForLabel(e.short_label, glossary) ?? glossaryFormsForLabel(e.source_excerpt, glossary)
      return {
        id: e.id,
        kind: e.kind,
        shortLabel: e.short_label,
        excerpt: e.source_excerpt,
        context: paragraphAround(docText, e.source_excerpt),
        occurrences: forms ? pagesContaining(docText, forms) : [],
        page: typeof ref.page === 'number' ? ref.page : null,
        section: typeof ref.section === 'string' ? ref.section : null,
      }
    })
    .sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9))

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2">
        <Link href={`/tenders/${id}/engagements`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
          <ArrowLeft className="h-3.5 w-3.5" /> Retour aux engagements
        </Link>
        <Link href={`/tenders/${id}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
          Dossier
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-muted-foreground" /> Audit documentaire
        </h1>
        <p className="text-xs text-muted-foreground">
          {items.length} engagement{items.length > 1 ? 's' : ''} détecté{items.length > 1 ? 's' : ''} dans {doc?.filename ?? 'le dossier'}.
          Parcourez-les ; le document s&apos;ouvre à la page de chacun.
        </p>
      </header>

      <DocumentAudit pdfUrl={pdfUrl} filename={doc?.filename ?? null} engagements={items} />
    </div>
  )
}
