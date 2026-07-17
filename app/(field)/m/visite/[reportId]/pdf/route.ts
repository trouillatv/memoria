// Route GET /m/visite/[reportId]/pdf
// Génère à la volée le PDF « Compte-rendu de visite » — sortie partageable du
// Débrief, depuis le terrain. Projection déterministe du VisitCrDoc (zéro IA,
// zéro stockage).
//
// Auth : rôles terrain (chef_equipe / admin / manager) + scope organisation.

import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit, buildVisitCrDoc } from '@/lib/db/visits'
import { loadOrRunVisitDebrief } from '@/lib/visits/debrief-analysis'
import { VisitCrPdf } from '@/lib/pdf/visit-cr'
import { getVisitSummary } from '@/lib/knowledge/visit-summary'
import { loadCrMapSnapshotDataUri } from '@/lib/pdf/cr-map-snapshot'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteCtx {
  params: Promise<{ reportId: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  const user = await getCurrentUserWithProfile()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (user.role !== 'chef_equipe' && user.role !== 'admin' && user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { reportId } = await ctx.params
  const visit = await getVisit(reportId)
  if (!visit) return NextResponse.json({ error: 'Visite introuvable' }, { status: 404 })
  // Scope org : une visite d'une autre organisation n'existe pas pour cet agent.
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const doc = await buildVisitCrDoc(reportId, user.id)
  if (!doc) return NextResponse.json({ error: 'Visite introuvable' }, { status: 404 })

  // Le PDF projette LE MÊME modèle que le mobile : « Ce que MemorIA a retenu »
  // (résumé, actions proposées, points de vigilance), pas le verbatim. On charge
  // l'analyse persistée (lazy-once + cache ; l'org est déjà vérifiée ci-dessus).
  // Best-effort : si l'analyse échoue ou n'est pas prête (colonne absente avant
  // migration), le PDF retombe proprement sur le résumé déterministe du doc.
  const debrief = await loadOrRunVisitDebrief(reportId, user.id)
    .then((r) => (r.ok && (r.status === 'ready' || r.status === 'stale') ? r.loaded.analysis : null))
    .catch(() => null)

  // LA source unique des objets métier du CR : le PDF lit ce que l'écran lit.
  // `debrief` ne sert plus qu'au RÉCIT (summary) — une prose, pas un objet : rien
  // ne peut la contredire, elle n'a pas de cycle de validation.
  const summary = await getVisitSummary(reportId)

  const exportDate = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Noumea',
  })

  // Le PDF CONSOMME l'instantané carte déjà produit — il ne le fabrique jamais
  // (aucune requête réseau ici). Absent → VisitCrPdf retombe sur le schéma métrique.
  const mapImage = doc.positions.length > 0
    ? await loadCrMapSnapshotDataUri(reportId).catch(() => null)
    : null

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(VisitCrPdf({ doc, debrief, summary, exportDate, mapImage }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'render error'
    console.error('[visit-cr-pdf] PDF render failed:', e)
    return NextResponse.json({ error: `Erreur génération PDF: ${msg}` }, { status: 500 })
  }

  const slug = doc.siteName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  // Nom de fichier UNIQUE par visite ET PAR VERSION : chantier + date/heure de la
  // visite (fuseau Nouméa) + numéro de synthèse.
  //
  // L'horodatage de la VISITE ne suffisait pas. Il empêche bien de confondre deux
  // visites, mais pas deux VERSIONS de la même : on met à jour la synthèse, on
  // confirme des actions, le gabarit évolue — même nom, contenu différent. Android
  // rouvre alors le fichier déjà présent dans Téléchargements et affiche l'ancien
  // PDF ; le conducteur croit que MemorIA s'est trompée, alors qu'elle a raison et
  // que c'est le téléphone qui montre un fichier périmé.
  // Ex. « cr-cuisine-petratiti-2026-07-22-14h32-v2.pdf ».
  const visitInstant = new Date(visit.started_at ?? visit.created_at ?? Date.now())
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Noumea',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(visitInstant) // « 2026-07-22 »
  const hm = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Pacific/Noumea',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(visitInstant)
    .replace(':', 'h') // « 14h32 »
  // Le numéro de synthèse : il change à chaque « Mettre à jour ». C'est LUI qui
  // distingue deux PDF du même passage.
  const version = debrief?.analysis_version ?? 0
  const stamp = `${ymd}-${hm}-v${version}`

  // ?download=1 → attachment : le mobile TÉLÉCHARGE le fichier (bouton « Télécharger »).
  // Sinon inline : le mobile OUVRE le PDF (aperçu), l'agent peut ensuite partager.
  const download = new URL(req.url).searchParams.has('download')
  const disposition = download ? 'attachment' : 'inline'

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="cr-${slug || 'chantier'}-${stamp}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
