import 'server-only'

// ── LA FICHE RÉUNION — la TÊTE de la chaîne causale ──────────────────────────
// Premier objet du Lot 4. Aucune conception nouvelle : on APPLIQUE le cadre
// stabilisé au Lot 3 (adresse propre · fiche propre · fil · relations · recherche
// · trois gestes). Si ce fichier avait demandé une doctrine de plus, c'est que le
// modèle n'était pas stabilisé.
//
// Ce que la fiche est, et n'est pas :
//   · elle EST le nœud du graphe — « qu'a produit cette réunion ? » ;
//   · elle n'est PAS l'espace de travail du compte-rendu (`/meetings/<id>` :
//     curation, chat, validation du PV). Le lien vers lui est une SORTIE nommée,
//     jamais une substitution — cf. doctrines/objets-jamais-conteneurs.md.
//
// Tout est factuel : les décisions viennent de `report_id`, les participants de
// la colonne `participants` (détectés par l'IA, validés par l'humain), le
// compte-rendu de `report_documents`. Rien n'est inféré.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { listDecisionsByReport } from '@/lib/db/site-decisions'
import { STATUT_LABEL, type DecisionStatut } from '@/lib/db/decision-constants'

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

/** Un présent. `kind` distingue une personne d'une entreprise ou d'un contrôle :
 *  on ne transforme jamais une entreprise en interlocuteur nommé. */
export interface ReunionParticipant {
  name: string
  role: string | null
  kind: 'person' | 'company' | 'control' | 'other'
}

export interface ReunionDecision {
  id: string
  titre: string
  statutLabel: string
  href: string
}

export interface ReunionFicheData {
  id: string
  siteId: string
  /** « Réunion » ou « Visite » — la distinction existe déjà dans le fil. */
  kind: 'reunion' | 'visite'
  kindLabel: string
  titre: string
  date: string | null
  /** L'espace de travail du compte-rendu. Une SORTIE, pas le contenu de la fiche. */
  compteRenduHref: string
  /** Le compte-rendu est-il figé (validé/exporté) ? `null` = aucun document. */
  compteRenduStatutLabel: string | null
  decisions: ReunionDecision[]
  participants: ReunionParticipant[]
}

const KINDS = new Set(['person', 'company', 'control', 'other'])

/** `participants` est du jsonb : on ne fait confiance à rien, on filtre. */
function lireParticipants(raw: unknown): ReunionParticipant[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p) => {
    if (!p || typeof p !== 'object') return []
    const o = p as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name) return []
    const kind = typeof o.kind === 'string' && KINDS.has(o.kind) ? (o.kind as ReunionParticipant['kind']) : 'other'
    const role = typeof o.role === 'string' && o.role.trim() ? o.role.trim() : null
    return [{ name, role, kind }]
  })
}

const CR_STATUT: Record<string, string> = {
  draft: 'Brouillon',
  validated: 'Validé',
  exported: 'Exporté',
}

export async function getSiteReunionFiche(siteId: string, reportId: string): Promise<ReunionFicheData | null> {
  const db = createAdminClient()

  // UNE SEULE VAGUE. Mesuré au Lot 3 : un aller-retour coûte ~185 ms quoi qu'il
  // lise, mais N simultanés coûtent le prix d'un seul. La garde d'organisation ne
  // dépend d'aucune lecture : elle part avec elles et décide toujours (fail-closed,
  // les résultats sont jetés si elle refuse).
  const [orgId, siteRes, reportRes, decisions, crRes] = await Promise.all([
    getOrgId(),
    db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle(),
    db.from('site_reports').select('id, origin, title, started_at, created_at, participants')
      .eq('id', reportId).eq('site_id', siteId).maybeSingle(),
    listDecisionsByReport(reportId),
    db.from('report_documents').select('status').eq('report_id', reportId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (!orgId) return null
  const site = siteRes.data as { organization_id: string | null } | null
  if (!site || site.organization_id !== orgId) return null
  const r = reportRes.data as {
    id: string; origin: string | null; title: string | null
    started_at: string | null; created_at: string; participants: unknown
  } | null
  if (!r) return null

  const kind: 'reunion' | 'visite' = r.origin ? 'visite' : 'reunion'
  const kindLabel = kind === 'visite' ? 'Visite' : 'Réunion'
  const date = frDate(r.started_at ?? r.created_at)

  // Les décisions sont déjà scopées par `report_id`, lui-même scopé au chantier
  // par la lecture ci-dessus : une décision d'un autre chantier ne peut pas
  // apparaître ici. On garde malgré tout le filtre explicite — la garde ne coûte
  // rien et ne dépend pas d'un raisonnement.
  const dec: ReunionDecision[] = decisions
    .filter((d) => d.siteId === siteId)
    .map((d) => ({
      id: d.id,
      titre: d.titre,
      statutLabel: STATUT_LABEL[d.statut as DecisionStatut] ?? d.statut,
      href: `/sites/${siteId}/decision/${d.id}`,
    }))

  const cr = crRes.data as { status: string } | null

  return {
    id: r.id,
    siteId,
    kind,
    kindLabel,
    titre: r.title?.trim() || `${kindLabel}${date ? ` du ${date}` : ''}`,
    date,
    compteRenduHref: `/meetings/${r.id}`,
    compteRenduStatutLabel: cr ? (CR_STATUT[cr.status] ?? cr.status) : null,
    decisions: dec,
    participants: lireParticipants(r.participants),
  }
}
