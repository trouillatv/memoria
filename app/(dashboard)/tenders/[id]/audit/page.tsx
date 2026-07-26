import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ScanSearch } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getTender, listTenderDocuments } from '@/lib/db/tenders'
import { getTenderCorpus } from '@/lib/tenders/corpus'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { listTenderEngagementProvenance } from '@/lib/db/tender-engagement-provenance'
import { paragraphAround } from '@/lib/pdf/paragraph'
import { pagesContaining, glossaryFormsForLabel } from '@/lib/pdf/occurrences'
import { listGlossaryTerms } from '@/lib/db/glossary'
import { createAdminClient } from '@/lib/supabase/admin'
import { DocumentAudit, type AuditEngagement } from './DocumentAudit'
import type { AuditDocumentItem, AuditProvenance } from './audit-provenance'

export const dynamic = 'force-dynamic'

// Niveau 2 — Audit documentaire d'un AO : TOUTES les pièces du dossier + tous
// les engagements détectés, navigables. La source de chaque engagement vient du
// read model de provenance persisté (tender_document_id, page_number, state) —
// jamais de source_ref.page, jamais d'inférence par nom ou par ordre.
export default async function TenderAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/')

  const { id } = await params
  // Le texte audité (contexte, occurrences) reste celui du DOSSIER entier ;
  // la NAVIGATION, elle, suit la provenance structurée pièce par pièce.
  const [tender, docs, corpus, engagements, provenanceRows, glossary] = await Promise.all([
    getTender(id), listTenderDocuments(id), getTenderCorpus(id), listEngagementsByTender(id),
    listTenderEngagementProvenance(id), listGlossaryTerms().catch(() => []),
  ])
  if (!tender) notFound()

  // CHOIX EXPLICITE : on pré-signe une URL par pièce (un dossier en compte
  // quelques-unes, jamais des centaines) pour que le changement de document
  // reste 100 % côté client. Jamais de chemin Storage brut exposé.
  const sb = createAdminClient()
  const documents: AuditDocumentItem[] = await Promise.all(
    docs.map(async (d) => {
      const { data } = await sb.storage.from('tender-documents').createSignedUrl(d.storage_path, 3600)
      return { id: d.id, filename: d.filename, url: data?.signedUrl ?? null }
    }),
  )

  // Provenance par engagement — un engagement sans ligne de read model est
  // traité comme non localisé, jamais deviné.
  const provenanceById = new Map(provenanceRows.map((r) => [r.engagementId, r]))
  const docIndex = new Map(docs.map((d, idx) => [d.id, idx]))

  const docText = corpus || null
  const items: AuditEngagement[] = engagements
    .map((e) => {
      const row = provenanceById.get(e.id)
      const provenance: AuditProvenance = row
        ? { state: row.state, documentId: row.documentId, pageNumber: row.pageNumber, filename: row.filename, sourceType: row.sourceType }
        : { state: 'unavailable', documentId: null, pageNumber: null, filename: null, sourceType: null }
      // Occurrences : pages où le terme canonique (glossaire) apparaît dans le doc.
      const forms = glossaryFormsForLabel(e.short_label, glossary) ?? glossaryFormsForLabel(e.source_excerpt, glossary)
      return {
        id: e.id,
        kind: e.kind,
        shortLabel: e.short_label,
        excerpt: e.source_excerpt,
        context: paragraphAround(docText, e.source_excerpt),
        occurrences: forms ? pagesContaining(docText, forms) : [],
        provenance,
      }
    })
    // L'audit suit le dossier : pièce par pièce (ordre de dépôt), page par page.
    // Les provenances non localisées ferment la marche.
    .sort((a, b) => {
      const da = a.provenance.documentId ? docIndex.get(a.provenance.documentId) ?? 1e9 : 1e9
      const db = b.provenance.documentId ? docIndex.get(b.provenance.documentId) ?? 1e9 : 1e9
      if (da !== db) return da - db
      return (a.provenance.pageNumber ?? 1e9) - (b.provenance.pageNumber ?? 1e9)
    })

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2">
        <Link href={`/tenders/${id}/engagements`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
          <ArrowLeft className="h-3.5 w-3.5" /> Retour aux engagements
        </Link>
        <Link href={`/tenders/${id}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40">
          <ArrowLeft className="h-3.5 w-3.5" /> Retour au dossier
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold inline-flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-muted-foreground" /> Audit documentaire
        </h1>
        <p className="text-xs text-muted-foreground">
          {items.length} engagement{items.length > 1 ? 's' : ''} détecté{items.length > 1 ? 's' : ''} dans{' '}
          {documents.length > 1 ? `les ${documents.length} pièces du dossier` : documents[0]?.filename ?? 'le dossier'}.
          Parcourez-les ; la pièce source s&apos;ouvre à la page démontrée.
        </p>
      </header>

      <DocumentAudit documents={documents} engagements={items} />
    </div>
  )
}
