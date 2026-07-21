// LE COMPTE-RENDU, AU BUREAU (Vincent, 2026-07-22).
//
// Le CR éditable, la concrétisation et l'arbitrage n'existaient qu'à l'adresse
// mobile `/m/visite/[reportId]/cr`. Depuis le poste de travail, « Arbitrer » ou
// « Ouvrir le compte-rendu » éjectait donc le conducteur dans la coquille
// téléphone — on quittait la visite pour faire le travail de la visite.
//
// UN SEUL MOTEUR, DEUX SURFACES. Cette page ne réécrit rien : elle compose
// exactement les mêmes composants (`CrDocumentSections`, `CrConcretisation`,
// `MemoriaRetained`) et le même `getOrCreateVisitCrDocument`. Ce qui change est
// le contexte — on reste dans le chantier, avec son fil d'Ariane et le retour
// vers la visite.
//
// Ouvrir n'a jamais voulu dire régénérer : `getOrCreateVisitCrDocument` crée le
// document depuis l'analyse EN CACHE, sans relancer le modèle.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { getOrCreateVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { CrDocumentSections } from '@/app/(field)/m/visite/[reportId]/cr/CrDocumentSections'
import { CrConcretisation } from '@/app/(field)/m/visite/[reportId]/cr/CrConcretisation'
import { MemoriaRetained } from '@/app/(field)/m/visite/[reportId]/cr/MemoriaRetained'

export const dynamic = 'force-dynamic'

export default async function VisitCrDesktopPage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit] = await Promise.all([getSiteIdentity(id), getVisit(visitId)])
  if (!identity || !visit || visit.site_id !== id) notFound()
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const [doc, crDocument] = await Promise.all([
    buildVisitCrDoc(visitId, user.id),
    // `null` = pas encore d'analyse. La page retombe alors sur la synthèse, qui
    // se charge côté client — exactement comme au terrain.
    getOrCreateVisitCrDocument(visitId, user.id).catch(() => null),
  ])
  if (!doc) notFound()

  const debut = visit.started_at ?? visit.created_at

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}/visites/${visitId}`} className="hover:text-foreground">
          Visite du {frDate(debut)}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium text-foreground">Compte-rendu</span>
      </nav>

      <header className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Compte-rendu de la visite</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {identity.name} — {frDate(debut)}. Corrigez le texte, puis concrétisez ce qui doit vivre au chantier.
        </p>
        <Link
          href={`/sites/${id}/visites/${visitId}`}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la visite
        </Link>
      </header>

      <div className="space-y-4">
        {crDocument ? (
          <>
            <CrDocumentSections reportId={visitId} sections={crDocument.sections} status={crDocument.status} />
            {/* On corrige, PUIS on transforme : la concrétisation vient après. */}
            <CrConcretisation reportId={visitId} />
            {/* L'analyse initiale explique la provenance — elle reste atteignable,
                mais ne charge rien tant qu'on ne la demande pas. */}
            <MemoriaRetained
              reportId={visitId}
              siteId={visit.site_id}
              transcriptions={doc.transcriptions}
              autoLoad={false}
            />
          </>
        ) : (
          <MemoriaRetained reportId={visitId} siteId={visit.site_id} transcriptions={doc.transcriptions} />
        )}
      </div>
    </div>
  )
}

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })
