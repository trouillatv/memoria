import 'server-only'

// ── LA FICHE RÉSERVE — le défaut qui doit être levé ──────────────────────────
// Troisième objet du Lot 4. Gabarit appliqué, rien de rediscuté.
//
// Vocabulaire non négociable : une réserve se LÈVE, elle n'est jamais « résolue »
// ni « fermée ». C'est le mot du métier (OPR, PV de réception) et il porte une
// conséquence contractuelle.
//
// Relation d'identité (6ᵉ règle), convention déjà fixée : Réserve → « Corrigée par ».
// Elle vient de `site_actions.reserve_id` — l'action qui la traite.
//
// Ce que la fiche est, et n'est pas :
//   · elle EST le nœud du graphe — « qui l'a émise, qui la corrige, qu'est-ce qui
//     la prouve ? » ;
//   · elle n'est PAS l'écran de gestion des réserves (`/sites/<id>/reserves` :
//     saisie, photos avant/après, export PDF). Sortie nommée, comme ailleurs.
//
// Les PHOTOS de preuve (avant / après) vivent dans cet écran : elles demandent des
// URL signées et un rendu dédié. La fiche DIT qu'elles existent sans les afficher —
// annoncer une preuve sans la montrer serait pire que se taire.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { actionStatusLabel } from '@/lib/knowledge/action-fiche'

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

export interface ReserveAction {
  id: string
  titre: string
  statusLabel: string
  href: string
}

export interface ReserveFicheData {
  id: string
  siteId: string
  label: string
  /** Ouverte ou LEVÉE — jamais « résolue ». */
  levee: boolean
  statutLabel: string
  /** Date de levée, quand elle est levée. */
  leveeLe: string | null
  /** Comment elle a été levée, tel que saisi. Jamais reformulé. */
  noteLevee: string | null
  /** Zone / ouvrage concerné. */
  lieu: string | null
  /** Qui l'a émise (MOE, bureau de contrôle…) et quand. */
  emisePar: string | null
  emiseLe: string | null
  /** Les actions qui la traitent (`site_actions.reserve_id`). */
  actions: ReserveAction[]
  /** Le sujet auquel elle est rattachée, s'il existe. */
  sujet: { nom: string; href: string } | null
  /** Une preuve photo est-elle déposée ? On le DIT, on ne l'affiche pas ici. */
  photoAvant: boolean
  photoApres: boolean
  /** L'écran de gestion : saisie, photos, export. Une SORTIE. */
  gestionHref: string
}

export async function getSiteReserveFiche(siteId: string, reserveId: string): Promise<ReserveFicheData | null> {
  const db = createAdminClient()

  // UNE SEULE VAGUE — la garde d'organisation part avec les lectures (fail-closed).
  const [orgId, siteRes, reserveRes, actionsRes] = await Promise.all([
    getOrgId(),
    db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle(),
    db.from('site_reserve')
      .select('id, label, location, issued_by, issued_on, status, lifted_at, lift_note, subject_id, photo_before_path, photo_after_path')
      .eq('id', reserveId).eq('site_id', siteId).maybeSingle(),
    db.from('site_actions')
      .select('id, title, status').eq('reserve_id', reserveId).eq('site_id', siteId)
      .order('created_at', { ascending: true }),
  ])

  if (!orgId) return null
  const site = siteRes.data as { organization_id: string | null } | null
  if (!site || site.organization_id !== orgId) return null

  const r = reserveRes.data as {
    id: string; label: string; location: string | null
    issued_by: string | null; issued_on: string | null
    status: 'open' | 'lifted'; lifted_at: string | null; lift_note: string | null
    subject_id: string | null
    photo_before_path: string | null; photo_after_path: string | null
  } | null
  if (!r) return null

  const actions: ReserveAction[] = ((actionsRes.data ?? []) as Array<{ id: string; title: string; status: 'open' | 'planned' | 'done' | 'cancelled' }>)
    .map((a) => ({
      id: a.id,
      titre: a.title,
      statusLabel: actionStatusLabel(a.status),
      href: `/sites/${siteId}/action/${a.id}`,
    }))

  let sujet: ReserveFicheData['sujet'] = null
  if (r.subject_id) {
    const { data } = await db.from('subjects')
      .select('name').eq('id', r.subject_id).eq('site_id', siteId).maybeSingle()
    const s = data as { name: string | null } | null
    if (s?.name) sujet = { nom: s.name, href: `/sites/${siteId}/subjects/${r.subject_id}` }
  }

  const levee = r.status === 'lifted'

  return {
    id: r.id,
    siteId,
    label: r.label,
    levee,
    // Le libellé DIT le mot du métier. « Levée » n'a pas de synonyme ici.
    statutLabel: levee ? 'Levée' : 'Ouverte — à lever',
    leveeLe: frDate(r.lifted_at),
    noteLevee: r.lift_note?.trim() || null,
    lieu: r.location?.trim() || null,
    emisePar: r.issued_by?.trim() || null,
    emiseLe: frDate(r.issued_on),
    actions,
    sujet,
    photoAvant: Boolean(r.photo_before_path),
    photoApres: Boolean(r.photo_after_path),
    gestionHref: `/sites/${siteId}/reserves`,
  }
}
