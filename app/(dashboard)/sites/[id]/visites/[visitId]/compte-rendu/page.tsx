// LE COMPTE-RENDU, AU BUREAU.
//
// Le CR éditable, la concrétisation et l'arbitrage n'existaient qu'à l'adresse
// mobile `/m/visite/[reportId]/cr`. Depuis le poste de travail, « Arbitrer »
// éjectait donc le conducteur dans la coquille téléphone — on quittait la
// visite pour faire le travail de la visite. Un seul moteur, deux surfaces :
// cette page compose les MÊMES composants que le terrain, dans le contexte du
// chantier (fil d'Ariane, retour vers la visite).
//
// Ouvrir n'a jamais voulu dire régénérer : `getOrCreateVisitCrDocument` crée le
// document depuis l'analyse EN CACHE, sans relancer le modèle.
//
// ── L'ATELIER DEVIENT LA PAGE (Vincent, 2026-07-22) ─────────────────────────
//
// Cette mise en page a vécu un temps à `compte-rendu/atelier`, en essai
// réversible, le temps d'être jugée sur pièces. Elle est validée : elle
// REMPLACE l'ancienne, et les deux liens de bascule disparaissent avec elle.
// `atelier/` ne garde qu'une redirection, pour les adresses déjà ouvertes.
//
// CE QU'ELLE A CORRIGÉ, ET QU'IL NE FAUT PAS DÉFAIRE :
//
//   On lisait deux fois la même histoire. Le document racontait la visite, puis
//   « Ce que MemorIA a retenu » la racontait à nouveau, juste en dessous, dans
//   le même axe de lecture. Le conducteur se demandait pourquoi il relisait.
//
//   L'axe a donc changé : à GAUCHE le compte-rendu — ce que le chantier saura ;
//   à DROITE le travail restant. L'analyse d'origine descend en bas, repliée :
//   elle devient ce qu'elle est vraiment, la PROVENANCE, et non une seconde
//   lecture.
//
//   Et les deux colonnes ne se concurrencent plus : ce sont trois MARCHES d'un
//   même parcours — je corrige, je termine mes arbitrages, je vois ce qui sera
//   créé. Le détail de cette grammaire vit dans `AtelierColonnes`.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { getOrCreateVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { MemoriaRetained } from '@/app/(field)/m/visite/[reportId]/cr/MemoriaRetained'
import { AtelierColonnes } from './AtelierColonnes'

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
    // `null` = pas encore d'analyse. Ouvrir n'a jamais voulu dire régénérer :
    // le document est créé depuis le cache, sans rappeler le modèle.
    getOrCreateVisitCrDocument(visitId, user.id).catch(() => null),
  ])
  if (!doc) notFound()

  const debut = visit.started_at ?? visit.created_at

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <nav aria-label="Fil d’Ariane" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href={`/sites/${id}`} className="hover:text-foreground">{identity.name}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={`/sites/${id}/visites/${visitId}`} className="hover:text-foreground">
          Visite du {frDate(debut)}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span className="font-medium text-foreground">Compte-rendu</span>
      </nav>

      <header className="mb-5 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">Compte-rendu de la visite</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {identity.name} — {frDate(debut)}. Corrigez le texte à gauche, tranchez ce qui attend à droite.
        </p>
        <Link
          href={`/sites/${id}/visites/${visitId}`}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la visite
        </Link>
      </header>

      {crDocument ? (
        // LES TROIS MARCHES ET LES FILS QUI LES RELIENT — côté client, parce
        // qu'une correction et une création doivent se répercuter sur des blocs
        // voisins sans refabriquer la page.
        <AtelierColonnes
          reportId={visitId}
          siteId={visit.site_id}
          sections={crDocument.sections}
          status={crDocument.status}
          transcriptions={doc.transcriptions}
        />
      ) : (
        // Aucun document : il n'y a rien à corriger ni à arbitrer tant que
        // l'analyse n'a pas eu lieu. On retombe sur le parcours normal.
        <MemoriaRetained reportId={visitId} siteId={visit.site_id} transcriptions={doc.transcriptions} />
      )}
    </div>
  )
}

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })
