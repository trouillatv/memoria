// N3 — LE RÉCIT DE VISITE.
//
// « N1 : MemorIA écrit un compte-rendu. N2 : MemorIA explique ce qu'elle a
//   retenu. N3 : MemorIA démontre pourquoi chaque information existe. »
//
// Cette page ne fait que réunir les faits ; toute l'exploration vit dans
// NarrativeReader. La règle de preuve, elle, reste dans le read-model : aucun
// écran n'a le droit de la contourner.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { getVisit } from '@/lib/db/visits'
import { buildVisitNarrative } from '@/lib/db/visit-narrative'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { NarrativeReader, type CaptureMedia } from './NarrativeReader'

export const dynamic = 'force-dynamic'

export default async function VisitNarrativePage({
  params,
}: {
  params: Promise<{ id: string; visitId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, visitId } = await params
  const [identity, visit, narrative] = await Promise.all([
    getSiteIdentity(id),
    getVisit(visitId),
    buildVisitNarrative(visitId),
  ])
  if (!identity || !visit || visit.site_id !== id || !narrative) notFound()
  // Isolation tenant : le service-role passe outre la RLS, le filtre est ICI.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  // Les URL signées des pièces jointes — pour écouter le vocal, revoir la photo.
  const media: CaptureMedia = await getVisitCapturePreviewUrls(
    narrative.captured
      .filter((c) => c.attachmentId)
      .map((c) => ({ id: c.id, attachment_id: c.attachmentId }) as VisitCaptureRow),
  ).catch(() => ({}))

  const doc = narrative.validated.document
  const dateVisite = new Date(visit.started_at ?? visit.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-8 space-y-1">
        <Link
          href={`/sites/${id}/visites/${visitId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour à la visite
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Récit de la visite</h1>
        <p className="text-sm text-muted-foreground">
          {identity.name} — {dateVisite}. D’où vient chaque information, et ce qui n’a pas été retenu.
        </p>
      </header>

      <NarrativeReader
        narrative={narrative}
        media={media}
        canPromote={doc?.status === 'draft'}
        crHref={doc ? `/m/visite/${visitId}/cr` : null}
      />
    </div>
  )
}
