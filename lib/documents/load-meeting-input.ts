// Charge une VRAIE réunion (site_report) + son contexte (site, contrat, actions).
// UN SEUL chargement DB expose deux vues :
//   - MeetingInput        : projection (lossy) consommée par le mapper CrBecib.
//   - MeetingSources       : les objets TYPÉS riches (chacun garde son `source`/
//     `confiance`), consommés tels quels par la surface de validation (PvValidation)
//     AVANT toute projection. Évite de re-charger la base deux fois.
// V1 : contenu éditorial (points discutés) = QUE les sources déterministes ; le
// reste = « à compléter » jusqu'au draft IA validé. RÈGLE : jamais inventer.
import { getSiteReport } from '@/lib/db/site-reports'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { getContract } from '@/lib/db/contracts'
import { buildRemarquesCrPrecedent } from '@/lib/db/meeting-followup'
import { buildPrevisionsFromInterventions } from '@/lib/db/site-previsions'
import { listMeetingScopedPhotos } from '@/lib/db/site-photos'
import { buildPointsExamines } from '@/lib/db/points-examines'
import { listPvSignalDecisions } from '@/lib/db/pv-signal-decisions'
import { getPhotoDataUrlsForCr } from '@/lib/storage/intervention-photos'
import { listReportPhotoMeta, getCrPhotosComment } from '@/lib/db/report-photo-meta'
import { listReportHumanPoints } from '@/lib/db/report-human-points'
import { companyLabelForOrg } from '@/lib/documents/templates/cr-chantier'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MeetingInput } from './meeting-to-cr-becib'
import type { RemarquesCrPrecedent } from '@/lib/db/meeting-followup'
import type { PrevisionItem } from '@/lib/db/site-previsions'
import type { SitePhoto } from '@/lib/db/site-photos'
import type { PointExamine } from '@/lib/db/points-examines'

function ddmmyyyy(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

// Sources TYPÉES riches d'une réunion (chaque item conserve son `source`/`confiance`).
export interface MeetingSources {
  remarques: RemarquesCrPrecedent
  points: PointExamine[]
  previsions: PrevisionItem[]
  photos: SitePhoto[]
}
export interface MeetingContext { input: MeetingInput; sources: MeetingSources }

/** Charge une réunion : projection MeetingInput + sources typées riches (un seul accès DB).
 *  `embedPhotos` (chemin de RENDU CR seulement) : embarque les images en base64 ;
 *  l'écran de validation NE le demande PAS (sinon coût inutile à chaque ouverture). */
export async function loadMeetingContext(
  reportId: string,
  opts?: { embedPhotos?: boolean },
): Promise<MeetingContext | null> {
  const report = await getSiteReport(reportId)
  if (!report) return null
  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const contract = report.contract_id ? await getContract(report.contract_id) : null
  const actions = await listSiteActionsByReport(reportId)

  // REMARQUES SUR CR PRÉCÉDENT : 100% déterministe (meeting_followup), pas le transcript.
  const remarques = await buildRemarquesCrPrecedent({ id: reportId, site_id: report.site_id, created_at: report.created_at })

  // PRÉVISIONS (volet interventions) : anomalies non résolues + interventions à venir.
  const previsions = report.site_id ? await buildPrevisionsFromInterventions(report.site_id) : []

  // PHOTOS : scopées à CE CR (fenêtre depuis la réunion précédente), pas tout le site.
  const photos = await listMeetingScopedPhotos({ id: reportId, site_id: report.site_id, created_at: report.created_at })

  // POINTS EXAMINÉS typés (couche 3) : actions de la réunion + risques + anomalies.
  const points = await buildPointsExamines({ id: reportId, site_id: report.site_id, risks: report.risks })

  // numéro de CR = nb de réunions du site jusqu'à cette date (déterministe).
  let numeroCR: string | null = null
  if (report.site_id) {
    const { count } = await createAdminClient()
      .from('site_reports').select('id', { count: 'exact', head: true })
      .eq('site_id', report.site_id).lte('created_at', report.created_at)
    numeroCR = count ? String(count) : null
  }

  // IDENTITÉ MOE = l'organisation du chantier (« BECIB » seulement pour l'org BECIB,
  // sinon son propre nom). Trame BECIB partagée, identité propre à chaque org.
  let moe: string | null = null
  if (report.site_id) {
    const sb = createAdminClient()
    const { data: site } = await sb.from('sites').select('organization_id').eq('id', report.site_id).maybeSingle()
    const orgId = (site as { organization_id: string | null } | null)?.organization_id
    if (orgId) {
      const { data: org } = await sb.from('organizations').select('name, slug').eq('id', orgId).maybeSingle()
      moe = companyLabelForOrg(org as { slug?: string | null; name?: string | null } | null)
    }
  }

  // ITEMS EXCLUS DU PV (décision humaine « Exclure du PV » sur une ligne parasite,
  // ex. anomalie « szdz »). On filtre la projection CR (input) ; les sources restent
  // complètes pour que l'écran de validation puisse les montrer barrés + réintégrer.
  const decisions = await listPvSignalDecisions(reportId)
  const excluded = new Set(
    decisions.filter((d) => d.statut === 'ignored' || d.statut === 'false_positive').map((d) => d.signalId),
  )
  const pointsForCr = points.filter((p) => !excluded.has(p.source))
  const previsionsForCr = previsions.filter((p) => !excluded.has(p.source))

  // Présentation des photos (ordre/couverture/commentaire, mig 129) + remarques humaines (mig 130).
  const [photoMeta, photosComment, humanPointsRaw] = await Promise.all([
    listReportPhotoMeta(reportId),
    getCrPhotosComment(reportId),
    listReportHumanPoints(reportId),
  ])
  const humanPoints = humanPointsRaw.map((p) => ({ section: p.section, text: p.text }))

  // PHOTOS du CR : embarquées en base64 UNIQUEMENT au rendu (embedPhotos), hors
  // photos exclues, ORDONNÉES (couverture d'abord puis sort_order). @react-pdf
  // charge un data URL de façon fiable (≠ URL signée → 500).
  let crPhotos: { url: string; legende: string }[] = []
  if (opts?.embedPhotos) {
    const visible = photos
      .filter((p) => !excluded.has(p.id))
      .sort((a, b) => {
        const ma = photoMeta.get(a.id), mb = photoMeta.get(b.id)
        const ca = ma?.isCover ? 0 : 1, cb = mb?.isCover ? 0 : 1
        if (ca !== cb) return ca - cb
        return (ma?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (mb?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      })
    if (visible.length) {
      const dataUrls = await getPhotoDataUrlsForCr(visible.map((p) => p.storagePath))
      crPhotos = visible
        .map((p) => ({ url: dataUrls.get(p.storagePath) ?? '', legende: p.legende }))
        .filter((p) => p.url)
    }
  }

  // Actions VALIDÉES (pour l'avancement Fait/Prévisions ; le rendu « actions à
  // suivre » passe désormais par les points examinés typés).
  const liveActions = actions.filter((a) => a.status !== 'cancelled')

  const input: MeetingInput = {
    numeroCR,
    report: {
      title: report.title,
      createdAt: report.created_at,
      participants: (report.participants ?? []).map((p) => ({ name: p.name, role: p.role })),
    },
    site: { name: identity?.name ?? report.title ?? null, dns: null }, // DNS non stocké en base → trou (à compléter)
    contract: {
      name: contract?.name ?? null,
      clientName: contract?.client_name ?? identity?.clientName ?? null,
      startDate: ddmmyyyy(contract?.start_date),
      endDate: ddmmyyyy(contract?.end_date),
      delai: null,
    },
    actions: liveActions.map((a) => ({ id: a.id, title: a.title, assignedTo: a.assigned_to, dueDate: a.due_date, dueDateStatus: a.due_date_status, status: a.status })),
    contacts: [], // V1 : pas de jointure contacts → tel/mob/email = trous
    moe, // identité de l'org (BECIB réservé à l'org BECIB)
    pointsExaminesTyped: pointsForCr, // couche 3 (hors items exclus du PV)
    ordreDuJour: report.title ? [report.title] : [],
    remarquesCrPrecedent: remarques.text, // déterministe (meeting_followup)
    previsionsInterventions: previsionsForCr.map((p) => p.texte), // anomalies + interventions (hors exclus)
    photos: crPhotos, // base64 au rendu (embedPhotos) ; [] côté validation
    photosComment, // commentaire général du bloc photos (mig 129)
    humanPoints, // remarques humaines ajoutées par section (mig 130)
  }

  return { input, sources: { remarques, points, previsions, photos } }
}

/** Projection MeetingInput seule (contrat historique, consommé par generatePvAction). */
export async function loadMeetingInput(
  reportId: string,
  opts?: { embedPhotos?: boolean },
): Promise<MeetingInput | null> {
  const ctx = await loadMeetingContext(reportId, opts)
  return ctx?.input ?? null
}
