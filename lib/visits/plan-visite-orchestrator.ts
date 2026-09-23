import 'server-only'

// ORCHESTRATEUR PLAN DE VISITE (Lot B) — point d'écriture UNIQUE d'un verdict
// terrain sur un point du Plan de visite.
//
// Autorisation CONTEXTUELLE, jamais globale : chef_equipe/admin/manager
// n'obtiennent un droit de mutation que sur LA source réellement seedée dans
// CETTE visite, sur LEUR site, dans LEUR organisation. Aucun de ces éléments
// n'est accepté en entrée — tous sont relus depuis la ligne `visit_watchlist_item`
// identifiée par (id, report_id, site_id), ce qui rend une substitution de
// source_ref/source_kind/site/organisation structurellement impossible (pas
// seulement validée) : l'appelant ne peut influencer QUE l'id de l'item et le
// verdict rendu.
//
// Ordre des écritures (jamais inversé) :
//   1. vérifier l'état courant de la source ;
//   2. exécuter la primitive métier existante ;
//   3. UNIQUEMENT après succès, persister le verdict watchlist.
// Un état incompatible refuse (jamais d'écrasement silencieux) ; un état déjà
// à la cible est idempotent (aucune primitive rejouée inutilement).

import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldAgent } from '@/lib/field/auth'
import { requireOrganizationRole } from '@/lib/auth/memberships'
import { setWatchlistItemState } from '@/lib/db/visit-watchlist'
import { liftReserve } from '@/lib/db/site-reserve'
import { markSiteActionDone, confirmSiteActionOpen, discardSiteAction } from '@/lib/db/site-actions'
import { getSiteDecision, updateSiteDecision } from '@/lib/db/site-decisions'
import { setObligationStatus } from '@/lib/db/obligations'
import {
  type PlanVisiteVerdict,
  isValidPlanVisiteVerdict,
  planVisiteVerdictRequiresComment,
  resolvePlanVisiteMutation,
  watchlistStateForVerdict,
} from '@/lib/visits/plan-visite-verdict'

export type PlanVisiteVerdictErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_verdict'
  | 'comment_required'
  | 'incompatible_state'

export interface SubmitPlanVisiteVerdictInput {
  watchlistItemId: string
  reportId: string
  siteId: string
  verdict: PlanVisiteVerdict
  comment?: string | null
}

export type SubmitPlanVisiteVerdictResult =
  | { ok: true }
  | { ok: false; code: PlanVisiteVerdictErrorCode; error: string }

function refuse(code: PlanVisiteVerdictErrorCode, error: string): SubmitPlanVisiteVerdictResult {
  return { ok: false, code, error }
}

export async function submitPlanVisiteVerdict(
  input: SubmitPlanVisiteVerdictInput,
): Promise<SubmitPlanVisiteVerdictResult> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return refuse('forbidden', auth.error)

  const supabase = createAdminClient()

  // Identité RÉELLE de l'item — le seul point d'entrée pour source_kind/source_ref.
  const { data: item } = await supabase
    .from('visit_watchlist_item')
    .select('id, source_kind, source_ref')
    .eq('id', input.watchlistItemId)
    .eq('report_id', input.reportId)
    .eq('site_id', input.siteId)
    .maybeSingle()
  if (!item) return refuse('not_found', 'Point de visite introuvable')

  const { data: site } = await supabase
    .from('sites')
    .select('organization_id')
    .eq('id', input.siteId)
    .maybeSingle()
  if (!site) return refuse('not_found', 'Chantier introuvable')

  // Droit de confirmation CONTEXTUEL : membre actif de CETTE organisation avec
  // un rôle terrain — jamais un droit d'administration générale.
  const authz = await requireOrganizationRole(site.organization_id as string, ['chef_equipe', 'admin', 'manager'])
  if (!authz.ok) return refuse('forbidden', authz.error)

  const sourceKind = (item as { source_kind: string | null }).source_kind
  const sourceRef = (item as { source_ref: string | null }).source_ref

  if (!isValidPlanVisiteVerdict(sourceKind, input.verdict)) {
    return refuse('invalid_verdict', "Ce verdict n'est pas proposé pour ce point")
  }
  const mutation = resolvePlanVisiteMutation(sourceKind, input.verdict)
  if (!mutation) return refuse('invalid_verdict', "Ce verdict n'est pas proposé pour ce point")

  const comment = input.comment?.trim() || null
  if (planVisiteVerdictRequiresComment(sourceKind, input.verdict) && !comment) {
    return refuse('comment_required', 'Un commentaire est requis pour ce geste')
  }
  if (mutation.kind !== 'constat' && !sourceRef) {
    return refuse('not_found', 'Source introuvable pour ce point')
  }

  switch (mutation.kind) {
    case 'lift_reserve': {
      const { data: reserve } = await supabase
        .from('site_reserve')
        .select('id, status')
        .eq('id', sourceRef as string)
        .eq('site_id', input.siteId)
        .maybeSingle()
      if (!reserve) return refuse('not_found', 'Réserve introuvable')
      if ((reserve as { status: string }).status !== 'lifted') {
        await liftReserve({ id: sourceRef as string, liftNote: comment, photoAfterPath: null, userId: auth.userId })
      }
      break
    }

    case 'complete_action': {
      const { data: action } = await supabase
        .from('site_actions')
        .select('id, status')
        .eq('id', sourceRef as string)
        .eq('site_id', input.siteId)
        .maybeSingle()
      if (!action) return refuse('not_found', 'Action introuvable')
      const status = (action as { status: string }).status
      // fn_complete_action ne garde PAS 'cancelled' : le refus doit venir d'ici.
      if (status === 'cancelled') return refuse('incompatible_state', 'Action déjà écartée — impossible de la marquer faite')
      if (status !== 'done') {
        await markSiteActionDone(sourceRef as string, { comment }, auth.userId)
      }
      break
    }

    case 'confirm_action_open': {
      try {
        await confirmSiteActionOpen(sourceRef as string, comment, auth.userId, {
          source: 'visit_watchlist',
          reportId: input.reportId,
          watchlistItemId: input.watchlistItemId,
        })
      } catch (e) {
        // fn_confirm_action_open lève si l'objet n'est pas actif (open/planned).
        return refuse('incompatible_state', e instanceof Error ? e.message : 'État incompatible')
      }
      break
    }

    case 'discard_action': {
      const { data: action } = await supabase
        .from('site_actions')
        .select('id, status')
        .eq('id', sourceRef as string)
        .eq('site_id', input.siteId)
        .maybeSingle()
      if (!action) return refuse('not_found', 'Action introuvable')
      const status = (action as { status: string }).status
      // fn_cancel_action no-op SILENCIEUX sur 'done' : le refus doit venir d'ici,
      // sinon le verdict watchlist serait un faux positif.
      if (status === 'done') return refuse('incompatible_state', "Action déjà faite — la rouvrir avant de l'écarter")
      if (status !== 'cancelled') {
        await discardSiteAction(sourceRef as string, mutation.motif, comment as string, auth.userId)
      }
      break
    }

    case 'set_decision_statut': {
      const decision = await getSiteDecision(input.siteId, sourceRef as string)
      if (!decision) return refuse('not_found', 'Décision introuvable')
      const opposite = mutation.statut === 'appliquee' ? 'caduque' : 'appliquee'
      if (decision.statut === opposite) return refuse('incompatible_state', `Décision déjà ${opposite}`)
      if (decision.statut !== mutation.statut) {
        await updateSiteDecision(input.siteId, sourceRef as string, { statut: mutation.statut })
      }
      break
    }

    case 'set_obligation_status': {
      const { data: obligation } = await supabase
        .from('site_obligation')
        .select('id, status')
        .eq('id', sourceRef as string)
        .eq('site_id', input.siteId)
        .maybeSingle()
      if (!obligation) return refuse('not_found', 'Obligation introuvable')
      const status = (obligation as { status: string }).status
      const opposite = mutation.status === 'satisfaite' ? 'non_applicable' : 'satisfaite'
      if (status === opposite) {
        return refuse('incompatible_state', `Obligation déjà ${opposite === 'non_applicable' ? 'sans objet' : 'satisfaite'}`)
      }
      if (status !== mutation.status) {
        await setObligationStatus(sourceRef as string, mutation.status, comment)
      }
      break
    }

    case 'constat':
      break
  }

  await setWatchlistItemState(input.watchlistItemId, watchlistStateForVerdict(input.verdict), comment, auth.userId)
  return { ok: true }
}
