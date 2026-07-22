import 'server-only'

// ── LA FICHE DOCUMENT — la PREUVE dans le graphe ─────────────────────────────
// Deuxième objet du Lot 4. Le gabarit est figé : on l'applique, on ne le
// rediscute pas (adresse propre · fiche propre · fil · relations · recherche ·
// trois gestes).
//
// Ce que la fiche est, et n'est pas :
//   · elle EST le nœud du graphe — « d'où vient ce document, que prouve-t-il ? » ;
//   · elle n'est PAS la visionneuse (`/documents/<id>` : URL signée courte, rôle,
//     journal d'audit, liens éditables). Le lien vers elle est une SORTIE nommée.
//     Même règle que la Réunion — cf. doctrines/objets-jamais-conteneurs.md.
//
// ⚠️ RELATION ABSENTE DU MODÈLE, à ne pas inventer : il n'existe AUCUN lien entre
// un document et une action ou une décision. `document_links.target_type` accepte
// contract · site · tender · client · intervention · team · tenant · reserve.
// La fiche montre donc ce qui existe (réunion source, réserve prouvée) et se tait
// sur le reste, plutôt que de suggérer une causalité non enregistrée.
//
// ⚠️ LITIGE : un document de type `litige` n'entre PAS dans le graphe. Il reste
// consultable depuis son dossier et sa visionneuse — il n'est pas caché, il n'est
// pas MÉLANGÉ aux faits de chantier. Même règle que son exclusion du corpus de
// recherche (mig 204), appliquée ici à la navigation.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { canViewDocument } from '@/lib/documents/access'
import { DOCUMENT_TYPE_OPTIONS } from '@/lib/documents/labels'
import type { UserRole, DocumentVisibility, DocumentType } from '@/types/db'

// Le libellé du type vient de la MÊME source que les formulaires : une seule
// liste de vérité, jamais un second dictionnaire qui divergerait.
const TYPE_LABEL = new Map(DOCUMENT_TYPE_OPTIONS.map((o) => [o.value, o.label]))

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export interface DocumentFicheData {
  id: string
  siteId: string
  filename: string
  typeLabel: string
  /** Date d'effet si elle est connue, sinon date de dépôt — jamais inventée. */
  dateLabel: string | null
  dateIsEffective: boolean
  /** La réunion qui a produit ce document (compte-rendu validé). */
  reunion: { label: string; href: string } | null
  /** Les réserves que ce document prouve (`document_links.target_type = 'reserve'`). */
  reserves: Array<{ id: string; label: string }>
  /** La visionneuse : URL signée, rôle, audit. Une SORTIE, pas le contenu. */
  visionneuseHref: string
}

/** Le document est-il rattaché à ce chantier, directement ou via un de ses objets ?
 *  Les cibles indirectes sont relues SCOPÉES au chantier : un lien vers une réserve
 *  d'un autre chantier ne rattache rien. */
async function documentAppartientAuChantier(
  db: ReturnType<typeof createAdminClient>,
  liens: Array<{ target_type: string; target_id: string }>,
  siteId: string,
): Promise<boolean> {
  if (liens.some((l) => l.target_type === 'site' && l.target_id === siteId)) return true

  // Les seuls rattachements indirects qui valent : un objet qui APPARTIENT au
  // chantier. On ne remonte pas au contrat ni au client — leur périmètre dépasse
  // celui du chantier, et le document ne lui appartiendrait pas pour autant.
  const INDIRECTS: Array<[string, 'subjects' | 'site_reserve']> = [
    ['subject', 'subjects'],
    ['reserve', 'site_reserve'],
  ]
  for (const [type, table] of INDIRECTS) {
    const ids = liens.filter((l) => l.target_type === type).map((l) => l.target_id)
    if (!ids.length) continue
    const { data } = await db.from(table).select('id').in('id', ids).eq('site_id', siteId).limit(1)
    if ((data ?? []).length > 0) return true
  }
  return false
}

export async function getSiteDocumentFiche(
  siteId: string,
  documentId: string,
  role: UserRole | null,
): Promise<DocumentFicheData | null> {
  const db = createAdminClient()

  // UNE SEULE VAGUE. La garde d'organisation ne dépend d'aucune lecture : elle
  // part avec elles et décide toujours (fail-closed).
  const [orgIds, siteRes, docRes, lienSiteRes] = await Promise.all([
    getOrgIdsOfUser(),
    db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle(),
    db.from('documents')
      .select('id, filename, document_type, visibility_level, effective_date, created_at, organization_id, deleted_at')
      .eq('id', documentId).maybeSingle(),
    // Le document doit être RATTACHÉ à ce chantier : sans ce lien, l'adresse
    // `/sites/<A>/document/<X>` ne doit rien ouvrir, même si X existe ailleurs.
    // ⚠️ Le rattachement peut être INDIRECT : un document lié à un sujet ou à une
    // réserve appartient au chantier de cet objet sans forcément porter un lien
    // `site` en propre (`addDocumentLink` n'enregistre qu'un couple type/cible).
    // N'exiger que le lien direct rendait `notFound()` sur des documents pourtant
    // listés dans le chantier — défaut trouvé par le contrôle indépendant.
    db.from('document_links').select('target_type, target_id')
      .eq('document_id', documentId),
  ])

  if (orgIds.length === 0) return null
  const site = siteRes.data as { organization_id: string | null } | null
  if (!site || !orgIds.includes(site.organization_id ?? '')) return null

  const d = docRes.data as {
    id: string; filename: string; document_type: DocumentType
    visibility_level: DocumentVisibility; effective_date: string | null
    created_at: string; organization_id: string | null; deleted_at: string | null
  } | null
  if (!d || d.deleted_at) return null
  if (!orgIds.includes(d.organization_id ?? '')) return null
  // Rattachement direct, ou indirect via un objet DE CE CHANTIER.
  const liens = (lienSiteRes.data ?? []) as Array<{ target_type: string; target_id: string }>
  if (!(await documentAppartientAuChantier(db, liens, siteId))) return null

  // Le rôle décide, comme dans la visionneuse. On ne révèle pas l'existence.
  if (!canViewDocument(role, d.visibility_level)) return null
  // Le litige ne circule pas dans le graphe.
  if (d.document_type === 'litige') return null

  // Niveau 2 — ces lectures dépendent du document, pas l'une de l'autre.
  const [reunionRes, reserveLiensRes] = await Promise.all([
    db.from('report_documents').select('report_id').eq('document_id', documentId).maybeSingle(),
    db.from('document_links').select('target_id')
      .eq('document_id', documentId).eq('target_type', 'reserve'),
  ])

  let reunion: DocumentFicheData['reunion'] = null
  const repId = (reunionRes.data as { report_id: string | null } | null)?.report_id ?? null
  if (repId) {
    const { data } = await db.from('site_reports')
      .select('origin, title, started_at, created_at')
      .eq('id', repId).eq('site_id', siteId).is('deleted_at', null).maybeSingle()
    const r = data as { origin: string | null; title: string | null; started_at: string | null; created_at: string } | null
    if (r) {
      const type = r.origin ? 'Visite' : 'Réunion'
      const date = frDate(r.started_at ?? r.created_at)
      reunion = {
        label: `${r.title?.trim() || type}${date ? ` du ${date}` : ''}`,
        href: `/sites/${siteId}/reunion/${repId}`,
      }
    }
  }

  const reserveIds = ((reserveLiensRes.data ?? []) as Array<{ target_id: string }>).map((l) => l.target_id)
  let reserves: DocumentFicheData['reserves'] = []
  if (reserveIds.length > 0) {
    const { data } = await db.from('site_reserve')
      .select('id, label').in('id', reserveIds).eq('site_id', siteId)
    reserves = ((data ?? []) as Array<{ id: string; label: string | null }>)
      .map((r) => ({ id: r.id, label: r.label?.trim() || 'Réserve' }))
  }

  const effective = frDate(d.effective_date)

  return {
    id: d.id,
    siteId,
    filename: d.filename,
    typeLabel: TYPE_LABEL.get(d.document_type) ?? d.document_type,
    dateLabel: effective ?? frDate(d.created_at),
    dateIsEffective: Boolean(effective),
    reunion,
    reserves,
    visionneuseHref: `/documents/${d.id}`,
  }
}
