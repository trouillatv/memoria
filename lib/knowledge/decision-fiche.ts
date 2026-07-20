import 'server-only'

// ── LA FICHE DÉCISION — le PIVOT du chantier (constat → actions) ─────────────
// Read model d'UNE décision, site-scopée + fail-closed org. La décision est
// l'objet de LIAISON : elle explique POURQUOI le chantier est dans son état.
// Tout est FACTUEL et dérivé du modèle — jamais une donnée inventée :
//   · « en vigueur » = interprétation STRICTE du statut (jamais un champ) ;
//   · le récit « ce que ça change » = `description` (un seul texte, pas dupliqué) ;
//   · pas de journal de décision → on montre le statut COURANT, jamais une
//     fausse transition « Proposée → Actée » ;
//   · conséquence = l'action liée (action_id, 1:1 assumé).

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getSiteDecision } from '@/lib/db/site-decisions'
import { STATUT_LABEL, IMPACT_LABEL, type DecisionStatut } from '@/lib/db/decision-constants'
import { actionStatusLabel } from '@/lib/knowledge/action-fiche'

/** « En vigueur » et libellé dérivés UNIQUEMENT du statut — jamais une donnée à part. */
const VIGUEUR: Record<DecisionStatut, string> = {
  proposee: 'Proposée — en attente de validation',
  actee: 'En vigueur — produit actuellement ses effets',
  appliquee: 'Appliquée — mise en œuvre',
  caduque: 'Caduque — ne s’applique plus',
  contredite: 'Contredite — remplacée depuis',
}
const EN_VIGUEUR = new Set<DecisionStatut>(['actee', 'appliquee'])

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export interface DecisionFicheData {
  id: string
  siteId: string
  titre: string
  /** Le récit « pourquoi / ce que ça change » — UN seul texte, jamais dupliqué. */
  description: string | null
  sujet: string | null
  statut: DecisionStatut
  statutLabel: string
  enVigueur: boolean
  vigueurLabel: string
  /** Catégorie d'impact (planning/coût/technique/sécurité/autre), pas une phrase. */
  impactLabel: string | null
  dateDecision: string | null
  echeance: string | null
  /** Qui PORTE la décision (≠ responsable d'action). Cliquable seulement si au casting. */
  decideur: { name: string; detail: string | null; href: string | null } | null
  /** La réunion/visite SOURCE (provenance). `kind` distingue les deux pour le fil. */
  meeting: { label: string; href: string; kind: 'reunion' | 'visite' } | null
  /** La conséquence : l'action qui en découle (1:1). */
  action: { title: string; statusLabel: string; href: string } | null
}

export async function getSiteDecisionFiche(siteId: string, decisionId: string): Promise<DecisionFicheData | null> {
  const db = createAdminClient()
  // ── OUVRIR UNE FICHE NE DOIT PAS ÊTRE UNE FILE D'ATTENTE ────────────────────
  // Ces lectures étaient enchaînées : six allers-retours en série vers la base,
  // chacun attendant le précédent. Mesuré à ~230 ms l'unité, soit ~1,4 s rien
  // qu'en sérialisation — et 3 s ressenties à l'ouverture du panneau.
  // Aucune donnée n'est chargée en plus : seul l'ORDONNANCEMENT change.
  //
  // Niveau 1 — la garde d'organisation et la décision ne dépendent pas l'une de
  // l'autre. La garde décide toujours (fail-closed) ; on ne l'attend simplement
  // plus avant de commencer l'autre lecture, dont le résultat est jeté si la
  // garde refuse.
  // MESURÉ EN PRODUCTION (2026-07-20) : un aller-retour coûte ~185 ms, qu'il
  // lise une colonne ou un enregistrement entier ; mais cinq allers-retours
  // SIMULTANÉS coûtent le prix d'un seul. Ce qui se paie n'est donc pas le
  // nombre de requêtes, c'est le nombre de VAGUES.
  //
  // `getOrgId()` en est une à lui seul — deux, même : vérifier le jeton, puis
  // lire le profil. Il était attendu AVANT que la moindre lecture ne parte,
  // alors qu'il ne dépend d'aucune d'elles. Il part maintenant avec elles.
  //
  // La garde reste fail-closed et décide toujours : on ne l'a pas affaiblie,
  // on a seulement cessé de faire la queue derrière elle. Les résultats des
  // lectures lancées en parallèle sont jetés si elle refuse.
  const [orgId, siteRes, d] = await Promise.all([
    getOrgId(),
    db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle(),
    getSiteDecision(siteId, decisionId),
  ])
  if (!orgId) return null
  const site = siteRes.data
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null
  if (!d) return null

  // Niveau 2 — décideur, casting, réunion source et action ne dépendent QUE de la
  // décision. Ils partent donc ensemble : quatre allers-retours simultanés au
  // lieu de quatre en file.
  const nul = Promise.resolve({ data: null })
  const [cRes, interRes, rRes, aRes] = await Promise.all([
    d.decisionnaireContactId
      ? db.from('company_contacts').select('full_name, function').eq('id', d.decisionnaireContactId).maybeSingle()
      : nul,
    d.decisionnaireContactId
      ? db.from('site_intervenants').select('id').eq('site_id', siteId).eq('main_contact_id', d.decisionnaireContactId).is('effective_to', null).maybeSingle()
      : nul,
    d.reportId
      ? db.from('site_reports').select('origin, title, started_at, created_at').eq('id', d.reportId).eq('site_id', siteId).maybeSingle()
      : nul,
    d.actionId
      ? db.from('site_actions').select('title, status').eq('id', d.actionId).eq('site_id', siteId).maybeSingle()
      : nul,
  ])

  // Décideur — la personne qui PORTE la décision. Cliquable UNIQUEMENT si elle est
  // au casting actif (mêmes règles que le décisionnaire PV) ; sinon nom non lié,
  // ou le rôle/organisme en repli. Jamais un faux lien.
  let decideur: DecisionFicheData['decideur'] = null
  const c = cRes.data
  if (c) {
    const interId = (interRes.data as { id: string } | null)?.id ?? null
    const detail = [(c as { function: string | null }).function, d.decisionnaireRole, d.decisionnaireOrg].filter(Boolean).join(' · ') || null
    decideur = { name: (c as { full_name: string | null }).full_name ?? '', detail, href: interId ? `/sites/${siteId}?person=${interId}&person_source=decision` : null }
  }
  if (!decideur && (d.decisionnaireRole || d.decisionnaireOrg)) {
    decideur = { name: [d.decisionnaireRole, d.decisionnaireOrg].filter(Boolean).join(' · '), detail: null, href: null }
  }

  // Réunion source (provenance) — scopée au chantier.
  let meeting: DecisionFicheData['meeting'] = null
  const r = rRes.data
  if (r) {
    const rr = r as { origin: string | null; title: string | null; started_at: string | null; created_at: string }
    const type = rr.origin ? 'Visite' : 'Réunion'
    const date = frDate(rr.started_at ?? rr.created_at)
    meeting = { label: `${rr.title?.trim() || type}${date ? ` du ${date}` : ''}`, href: `/meetings/${d.reportId}`, kind: rr.origin ? 'visite' : 'reunion' }
  }

  // Conséquence : l'action liée (action_id) — scopée au chantier.
  let action: DecisionFicheData['action'] = null
  const a = aRes.data
  if (a) {
    const aa = a as { title: string; status: 'open' | 'planned' | 'done' | 'cancelled' }
    action = { title: aa.title, statusLabel: actionStatusLabel(aa.status), href: `/sites/${siteId}?action=${d.actionId}&action_source=decision` }
  }

  return {
    id: d.id,
    siteId,
    titre: d.titre,
    description: d.description,
    sujet: d.sujet,
    statut: d.statut,
    statutLabel: STATUT_LABEL[d.statut] ?? d.statut,
    enVigueur: EN_VIGUEUR.has(d.statut),
    vigueurLabel: VIGUEUR[d.statut],
    impactLabel: d.impact ? IMPACT_LABEL[d.impact] : null,
    dateDecision: frDate(d.dateDecision),
    echeance: frDate(d.echeance),
    decideur,
    meeting,
    action,
  }
}
