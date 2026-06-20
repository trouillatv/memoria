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
import { createAdminClient } from '@/lib/supabase/admin'
import type { MeetingInput } from './meeting-to-cr-becib'
import type { CrBecibBloc, StatutPoint } from './cr-becib-schema'

function ddmmyyyy(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
function statutFromAction(s: string): StatutPoint | null {
  if (s === 'done') return 'fait'
  if (s === 'open') return 'à faire'
  if (s === 'planned') return 'en cours'
  return null
}

export async function loadMeetingInput(reportId: string): Promise<MeetingInput | null> {
  const report = await getSiteReport(reportId)
  if (!report) return null
  const identity = report.site_id ? await getSiteIdentity(report.site_id) : null
  const contract = report.contract_id ? await getContract(report.contract_id) : null
  const actions = await listSiteActionsByReport(reportId)

  // numéro de CR = nb de réunions du site jusqu'à cette date (déterministe).
  let numeroCR: string | null = null
  if (report.site_id) {
    const { count } = await createAdminClient()
      .from('site_reports').select('id', { count: 'exact', head: true })
      .eq('site_id', report.site_id).lte('created_at', report.created_at)
    numeroCR = count ? String(count) : null
  }

  // Actions VALIDÉES → un bloc « ACTIONS À SUIVRE » (donnée validée, pas IA).
  const liveActions = actions.filter((a) => a.status !== 'cancelled')
  const pointsTech: CrBecibBloc[] = liveActions.length
    ? [{
        sousTitre: 'ACTIONS À SUIVRE', action: [],
        points: liveActions.map((a) => ({
          texte: [a.title, a.assigned_to ? `— ${a.assigned_to}` : '', a.due_date ? `(échéance ${ddmmyyyy(a.due_date)}${a.due_date_status === 'estimated' ? ' à confirmer' : ''})` : ''].filter(Boolean).join(' '),
          statut: statutFromAction(a.status), action: [],
        })),
      }]
    : []

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
    pointsAdmin: [], // contenu éditorial admin = brouillon IA à valider (Sprint B)
    pointsTech, // actions validées
    ordreDuJour: report.title ? [report.title] : [],
  }
}
