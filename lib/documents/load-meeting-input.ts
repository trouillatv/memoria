// Charge une VRAIE réunion (site_report) + son contexte (site, contrat, actions)
// et la met en forme MeetingInput pour le mapper. Réutilise les loaders existants
// (mêmes que generatePvAction → fonctionnent en contexte server action).
// V1 : contenu éditorial (points discutés) = pas encore de source validée → on
// ne met QUE les actions validées ; le reste = « à compléter » jusqu'au draft IA
// validé (Sprint B). RÈGLE : jamais inventer.
import { getSiteReport } from '@/lib/db/site-reports'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteActionsByReport } from '@/lib/db/site-actions'
import { getContract } from '@/lib/db/contracts'
import { buildRemarquesCrPrecedent } from '@/lib/db/meeting-followup'
import { buildPrevisionsFromInterventions } from '@/lib/db/site-previsions'
import { listSitePhotos } from '@/lib/db/site-photos'
import { buildPointsExamines } from '@/lib/db/points-examines'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MeetingInput } from './meeting-to-cr-becib'

function ddmmyyyy(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export async function loadMeetingInput(reportId: string): Promise<MeetingInput | null> {
  const report = await getSiteReport(reportId)
  if (!report) return null
  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const contract = report.contract_id ? await getContract(report.contract_id) : null
  const actions = await listSiteActionsByReport(reportId)

  // REMARQUES SUR CR PRÉCÉDENT : 100% déterministe (meeting_followup), pas le
  // transcript. mémoire → remarque → (rédaction LLM plus tard).
  const remarques = await buildRemarquesCrPrecedent({ id: reportId, site_id: report.site_id, created_at: report.created_at })

  // PRÉVISIONS (volet interventions) : anomalies non résolues + interventions à venir.
  const previsionsIntv = report.site_id ? await buildPrevisionsFromInterventions(report.site_id) : []

  // PHOTOS : structure mémoire réutilisable (intervention + clôture d'action).
  const sitePhotos = report.site_id ? await listSitePhotos(report.site_id) : []

  // POINTS EXAMINÉS typés (couche 3) : actions de la réunion + risques + anomalies.
  const pointsExaminesTyped = await buildPointsExamines({ id: reportId, site_id: report.site_id, risks: report.risks })

  // numéro de CR = nb de réunions du site jusqu'à cette date (déterministe).
  let numeroCR: string | null = null
  if (report.site_id) {
    const { count } = await createAdminClient()
      .from('site_reports').select('id', { count: 'exact', head: true })
      .eq('site_id', report.site_id).lte('created_at', report.created_at)
    numeroCR = count ? String(count) : null
  }

  // Actions VALIDÉES (pour l'avancement Fait/Prévisions ; les points examinés
  // typés gèrent désormais le rendu « actions à suivre » via buildPointsExamines).
  const liveActions = actions.filter((a) => a.status !== 'cancelled')

  return {
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
    actions: liveActions.map((a) => ({ title: a.title, assignedTo: a.assigned_to, dueDate: a.due_date, dueDateStatus: a.due_date_status, status: a.status })),
    contacts: [], // V1 : pas de jointure contacts → tel/mob/email = trous
    pointsExaminesTyped, // couche 3 : actions de la réunion + risques + anomalies
    ordreDuJour: report.title ? [report.title] : [],
    remarquesCrPrecedent: remarques.text, // déterministe (meeting_followup)
    previsionsInterventions: previsionsIntv.map((p) => p.texte), // anomalies + interventions à venir
    photos: sitePhotos.map((p) => ({ url: p.storagePath, legende: p.legende })), // structure → projection PV
  }
}
