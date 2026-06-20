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

export type PvResolver = {
  label: string
  /** Applique la MUTATION MÉTIER qui enrichit la mémoire. Throw → message remonté à l'UI. */
  apply: (refId: string, value: string) => Promise<void>
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
}

/** Résout un signal via son resolver. Throw si resolver inconnu (jamais en prod :
 *  les cibles sont calculées côté serveur) ou si la mutation échoue. */
export async function resolvePvSignal(resolver: string, refId: string, value: string): Promise<void> {
  const r = PV_RESOLVERS[resolver]
  if (!r) throw new Error(`Resolver inconnu : ${resolver}`)
  await r.apply(refId, value)
}
