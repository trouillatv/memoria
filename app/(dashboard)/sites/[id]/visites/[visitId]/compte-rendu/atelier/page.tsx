// L'ATELIER — une SECONDE mise en page du compte-rendu, à l'essai.
//
// Elle ne remplace rien. `../compte-rendu` reste intact et reste la page
// normale ; on bascule ici par un lien, et on revient par le lien inverse. Les
// deux écrivent le MÊME `report_document` : essayer cet atelier ne fabrique
// aucune donnée parallèle, et l'abandonner n'en perd aucune. Supprimer ce
// dossier suffirait à effacer l'expérience.
//
// CE QU'ELLE CHANGE, ET POURQUOI :
//
//   On lisait deux fois la même histoire. Le document racontait la visite, puis
//   « Ce que MemorIA a retenu » la racontait à nouveau, juste en dessous, dans
//   le même axe de lecture. Le conducteur se demandait pourquoi il relisait.
//
//   L'axe change donc : à GAUCHE le compte-rendu — ce que le chantier saura ;
//   à DROITE ce qu'il reste à trancher. Un document et son reste-à-faire, plus
//   deux récits concurrents. L'analyse d'origine descend en bas, repliée : elle
//   devient ce qu'elle est vraiment, la PROVENANCE, et non une seconde lecture.
//
// ── TROIS MARCHES, PAS DEUX PANNEAUX CONCURRENTS (Vincent, 2026-07-22) ──────
//
//   Première version : la concrétisation annonçait « 19 éléments proposés · 15
//   seront créés », le panneau d'arbitrage « 17 propositions à regarder ». Deux
//   totaux de la même visite, côte à côte, qui ne tombaient pas juste — et rien
//   n'expliquait pourquoi, donc on cherchait l'erreur.
//
//   Il n'y en avait pas : ils ne mesurent pas la même chose.
//     · le panneau       → « qu'est-ce que MemorIA me demande encore de DÉCIDER ? »
//     · la concrétisation → « si je valide, qu'est-ce qui SERA CRÉÉ ? »
//
//   Ce sont deux ÉTAPES successives d'un même parcours :
//     1. je corrige mon compte-rendu ;
//     2. je termine les arbitrages qui restent ;
//     3. je vois ce qui sera créé dans le chantier.
//
//   Elles cessent donc d'avoir le même poids visuel. Le panneau compte des
//   DÉCISIONS (et une famille entièrement arbitrée disparaît : c'est une liste
//   de tâches, pas un tableau de bord) ; la concrétisation perd son total
//   global — personne ne travaille avec « 19 », on travaille avec des actions
//   et des échéances. Les deux compteurs n'ont plus à coïncider, et plus rien
//   n'invite à les comparer.
//
// CE QU'ELLE NE TOUCHE PAS : `CrDocumentSections` et `MemoriaRetained` sont
// partagés avec le mobile (`/m/visite/[reportId]/cr`) et réutilisés TELS QUELS.
// `CrConcretisation` l'est aussi, mais reçoit ici `asStep` — un drapeau
// OPTIONNEL, faux par défaut : le mobile et l'ancienne page de bureau, où ce
// bloc est autonome et non l'étape d'un flux, gardent leur affichage.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Undo2 } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { getOrCreateVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import { MemoriaRetained } from '@/app/(field)/m/visite/[reportId]/cr/MemoriaRetained'
import { ColonneDocument } from './ColonneDocument'
import { PanneauArbitrage } from './PanneauArbitrage'

export const dynamic = 'force-dynamic'

export default async function VisitCrAtelierPage({
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
  const ancienne = `/sites/${id}/visites/${visitId}/compte-rendu`

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

      <header className="mb-5 mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
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
        </div>
        {/* LA SORTIE EST TOUJOURS VISIBLE — on essaie une mise en page, on n'y
            est pas enfermé. */}
        <Link
          href={ancienne}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[13px] hover:bg-muted"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          Revenir à l’ancienne mise en page
        </Link>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ── LE DOCUMENT — ce que le chantier saura ───────────────────────── */}
        <main className="min-w-0 flex-1 space-y-4 lg:order-1">
          {crDocument ? (
            <>
              {/* MARCHES 1 ET 3, ET LE FIL ENTRE ELLES. Corriger une section
                  périme ce que la concrétisation avait déduit du texte : elle
                  le dit, et remet « Mettre à jour les propositions » en avant.
                  Le fil vit côté client, d'où ce porteur. */}
              <ColonneDocument reportId={visitId} sections={crDocument.sections} status={crDocument.status} />
              {/* L'ANALYSE D'ORIGINE DEVIENT LA PROVENANCE. Elle ne charge rien
                  tant qu'on ne la demande pas, et ne raconte plus l'histoire une
                  seconde fois au-dessus du document. */}
              <MemoriaRetained
                reportId={visitId}
                siteId={visit.site_id}
                transcriptions={doc.transcriptions}
                autoLoad={false}
              />
            </>
          ) : (
            // Aucun document : il n'y a rien à corriger ni à arbitrer tant que
            // l'analyse n'a pas eu lieu. On retombe sur le parcours normal.
            <MemoriaRetained reportId={visitId} siteId={visit.site_id} transcriptions={doc.transcriptions} />
          )}
        </main>

        {/* ── LE RESTE À FAIRE ─────────────────────────────────────────────── */}
        {crDocument && (
          <aside className="lg:sticky lg:top-6 lg:order-2 lg:w-[360px] lg:shrink-0">
            <PanneauArbitrage reportId={visitId} />
          </aside>
        )}
      </div>
    </div>
  )
}

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long', year: 'numeric' })
