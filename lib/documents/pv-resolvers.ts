// RESOLVERS de signaux PV — « Compléter » corrige la MÉMOIRE, jamais seulement le
// document (décision fondatrice A, Vincent 2026-06-20).
//
// Architecture (Signal → Resolver → Mutation métier) : un signal ne se résout pas
// par un UPDATE SQL direct depuis l'UI, mais en s'adressant à un resolver nommé.
// Avantages : (1) zéro `if signal.type === …` dans l'écran/server action ;
// (2) un resolver peut faire une mutation COMPOSÉE (ex. à venir « Entreprise
// inconnue » = créer organisme + associer + MAJ participant) sans rien changer en
// amont. Aujourd'hui chaque resolver ne fait qu'un appel métier, mais le SEAM est
// posé. Toute mutation passe par les fonctions DB métier (jamais de SQL brut ici).
import { updateSiteAction } from '@/lib/db/site-actions'
import { createAdminClient } from '@/lib/supabase/admin'

export type PvResolver = {
  label: string
  /** Applique la MUTATION MÉTIER qui enrichit la mémoire. Throw → message remonté à l'UI.
   *  ctx.reportId = la réunion courante (utile aux mutations scopées CR, ex. participant). */
  apply: (refId: string, value: string, ctx: { reportId: string }) => Promise<void>
}

export const PV_RESOLVERS: Record<string, PvResolver> = {
  // Responsable d'une action → site_actions.assigned_to. Le gap « responsable
  // manquant » disparaît partout (briefing, recherche, CR suivant), pas juste au PV.
  action_responsable: {
    label: "Responsable de l'action",
    async apply(refId, value) {
      const v = value.trim()
      if (!v) throw new Error('Indiquez un responsable.')
      await updateSiteAction(refId, { assigned_to: v })
    },
  },
  // Échéance d'une action → site_actions.due_date + due_date_status null
  // (= échéance figée/confirmée par l'humain ; lève le badge « à confirmer »).
  action_echeance: {
    label: "Échéance de l'action",
    async apply(refId, value) {
      const v = value.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Date attendue au format AAAA-MM-JJ.')
      await updateSiteAction(refId, { due_date: v, due_date_status: null })
    },
  },
  // N° DNS du chantier → sites.dns (refId = site_id). Propre au chantier (tous ses CR).
  site_dns: {
    label: 'N° DNS du chantier',
    async apply(refId, value) {
      const v = value.trim()
      if (!v) throw new Error('Indiquez le N° DNS.')
      const { error } = await createAdminClient().from('sites').update({ dns: v }).eq('id', refId)
      if (error) throw new Error(error.message)
    },
  },
  // Date de prochaine réunion → site_reports.next_meeting_at (refId = report_id).
  reunion_date: {
    label: 'Date de la prochaine réunion',
    async apply(refId, value) {
      const v = value.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Date attendue au format AAAA-MM-JJ.')
      const { error } = await createAdminClient().from('site_reports').update({ next_meeting_at: v }).eq('id', refId)
      if (error) throw new Error(error.message)
    },
  },
  // Organisme d'un participant → site_reports.participants[index].role (refId = index).
  participant_organisme: {
    label: "Organisme d'un participant",
    async apply(refId, value, ctx) {
      const v = value.trim()
      if (!v) throw new Error("Indiquez l'organisme.")
      const sb = createAdminClient()
      const { data } = await sb.from('site_reports').select('participants').eq('id', ctx.reportId).maybeSingle()
      const participants = [...(((data as { participants?: unknown[] } | null)?.participants) ?? [])] as Array<Record<string, unknown>>
      const i = Number(refId)
      if (!Number.isInteger(i) || i < 0 || i >= participants.length) throw new Error('Participant introuvable.')
      participants[i] = { ...participants[i], role: v }
      const { error } = await sb.from('site_reports').update({ participants }).eq('id', ctx.reportId)
      if (error) throw new Error(error.message)
    },
  },
}

/** Résout un signal via son resolver. Throw si resolver inconnu (jamais en prod :
 *  les cibles sont calculées côté serveur) ou si la mutation échoue. */
export async function resolvePvSignal(resolver: string, refId: string, value: string, ctx: { reportId: string }): Promise<void> {
  const r = PV_RESOLVERS[resolver]
  if (!r) throw new Error(`Resolver inconnu : ${resolver}`)
  await r.apply(refId, value, ctx)
}
