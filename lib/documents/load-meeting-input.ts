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
import { listSitePhotos } from '@/lib/db/site-photos'
import { buildPointsExamines } from '@/lib/db/points-examines'
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

/** Charge une réunion : projection MeetingInput + sources typées riches (un seul accès DB). */
export async function loadMeetingContext(reportId: string): Promise<MeetingContext | null> {
  const report = await getSiteReport(reportId)
  if (!report) return null
  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const contract = report.contract_id ? await getContract(report.contract_id) : null
  const actions = await listSiteActionsByReport(reportId)

  // REMARQUES SUR CR PRÉCÉDENT : 100% déterministe (meeting_followup), pas le transcript.
  const remarques = await buildRemarquesCrPrecedent({ id: reportId, site_id: report.site_id, created_at: report.created_at })

  // PRÉVISIONS (volet interventions) : anomalies non résolues + interventions à venir.
  const previsions = report.site_id ? await buildPrevisionsFromInterventions(report.site_id) : []

  // PHOTOS : structure mémoire réutilisable (intervention + clôture d'action).
  const photos = report.site_id ? await listSitePhotos(report.site_id) : []

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
    pointsExaminesTyped: points, // couche 3 : actions de la réunion + risques + anomalies
    ordreDuJour: report.title ? [report.title] : [],
    remarquesCrPrecedent: remarques.text, // déterministe (meeting_followup)
    previsionsInterventions: previsions.map((p) => p.texte), // anomalies + interventions à venir
    photos: photos.map((p) => ({ url: p.storagePath, legende: p.legende })), // structure → projection PV
  }

  return { input, sources: { remarques, points, previsions, photos } }
}

/** Projection MeetingInput seule (contrat historique, consommé par generatePvAction). */
export async function loadMeetingInput(reportId: string): Promise<MeetingInput | null> {
  const ctx = await loadMeetingContext(reportId)
  return ctx?.input ?? null
}
