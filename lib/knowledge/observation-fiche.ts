import 'server-only'

// ── LA FICHE OBSERVATION — le constat de terrain ─────────────────────────────
// Quatrième et dernier objet du Lot 4. Aucune doctrine nouvelle : c'était le test.
//
// ── QUELLE EST SA RELATION PRINCIPALE ? (la seule vraie question de cet objet)
//
// Le schéma tranche, et il tranche seul :
//   · `report_id` est NOT NULL — une observation appartient TOUJOURS à une visite.
//     C'est sa seule relation garantie par construction ;
//   · `subject_id` est nullable — et NULL sur 93 observations sur 93 ;
//   · `visit_capture_routes` dit ce qu'elle est DEVENUE — et compte 0 ligne.
//
// La visite est donc la relation structurelle. Mais elle ne peut pas être le CHAPÔ :
// le fil la porte déjà (Visite › Observation), et une information ne s'explique
// qu'une seule fois (règle 4). Le chapô porte donc ce que l'observation a PRODUIT —
// la relation qui explique pourquoi elle compte dans le graphe plutôt que de rester
// une capture.
//
// Conséquence assumée, identique à celle de la fiche Document : aujourd'hui aucune
// observation n'a de chapô, parce qu'aucune n'a encore été routée. La fiche le DIT.
// Une fiche pauvre qui reflète fidèlement le modèle vaut mieux qu'une fiche remplie
// par une relation inventée.
//
// ⚠️ Deux natures de routage à ne pas confondre (contrainte de la mig 165) :
// MATÉRIELLE (`target_id` renseigné : action, réserve, anomalie, sujet, document)
// et PROJECTION (`target_id` NULL : journal, compte-rendu — la capture APPARAÎT
// dans une vue, il n'y a aucun objet à ouvrir). On ne cherche jamais de cible sur
// une projection : elle n'existe pas par construction.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null | undefined): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

/** Ce que l'observation est devenue — uniquement les routages MATÉRIELS. */
export interface ObservationProduit {
  id: string
  typeLabel: string
  /** `null` quand l'objet visé n'a pas encore de fiche : on ne fabrique pas de lien. */
  href: string | null
}

export interface ObservationFicheData {
  id: string
  siteId: string
  /** Note saisie ou transcription du vocal. `null` = rien d'écrit (photo seule). */
  texte: string | null
  /** Le geste : photo, vocal, note, vérification, position. */
  genreLabel: string
  /** Une transcription est-elle encore en cours ? On le dit, on n'invente pas. */
  transcriptionEnCours: boolean
  /** Où en est la capture dans les trois temps de la visite. */
  statutLabel: string
  ecartee: boolean
  date: string | null
  /** La visite — relation NOT NULL, donc toujours présente. */
  visite: { label: string; href: string }
  /** Ce qu'elle a produit (routages matériels). */
  produits: ObservationProduit[]
  /** Une pièce (photo, vocal) est-elle attachée ? Annoncée, jamais simulée. */
  pieceJointe: boolean
}

const GENRE: Record<string, string> = {
  photo: 'Photo',
  vocal: 'Vocal',
  video: 'Vidéo',
  note: 'Note',
  verification: 'Vérification',
  position: 'Position',
}

// Vocabulaire de conducteur, jamais de développeur : personne ne dit « capturée »
// ni « routée » sur un chantier.
const STATUT: Record<string, string> = {
  captured: 'Relevée sur le terrain — pas encore triée',
  kept: 'Retenue au tri',
  discarded: 'Écartée au tri',
  processed: 'Versée dans la mémoire du chantier',
}

/** Où mène un routage matériel. `null` quand la cible n'a pas de fiche. */
function cibleHref(table: string | null, targetId: string, siteId: string): { typeLabel: string; href: string | null } {
  switch (table) {
    case 'site_actions': return { typeLabel: 'Action', href: `/sites/${siteId}/action/${targetId}` }
    case 'site_reserve': return { typeLabel: 'Réserve', href: `/sites/${siteId}/reserve/${targetId}` }
    case 'subjects': return { typeLabel: 'Sujet', href: `/sites/${siteId}/subjects/${targetId}` }
    case 'documents': return { typeLabel: 'Document', href: `/sites/${siteId}/document/${targetId}` }
    // Une anomalie n'a pas de fiche : on la nomme sans fabriquer d'adresse.
    default: return { typeLabel: 'Anomalie', href: null }
  }
}

export async function getSiteObservationFiche(siteId: string, captureId: string): Promise<ObservationFicheData | null> {
  const db = createAdminClient()

  // UNE SEULE VAGUE — la garde d'organisation part avec les lectures (fail-closed).
  const [orgId, siteRes, capRes, routesRes] = await Promise.all([
    getOrgId(),
    db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle(),
    db.from('visit_capture')
      .select('id, report_id, kind, status, body, transcript_status, attachment_id, captured_at, created_at')
      .eq('id', captureId).eq('site_id', siteId).maybeSingle(),
    // Seuls les routages MATÉRIELS ouvrent quelque chose.
    db.from('visit_capture_routes')
      .select('destination, target_id, target_table')
      .eq('capture_id', captureId).not('target_id', 'is', null),
  ])

  if (!orgId) return null
  const site = siteRes.data as { organization_id: string | null } | null
  if (!site || site.organization_id !== orgId) return null

  const c = capRes.data as {
    id: string; report_id: string; kind: string; status: string
    body: string | null; transcript_status: string | null
    attachment_id: string | null; captured_at: string | null; created_at: string
  } | null
  if (!c) return null

  // La visite : relation NOT NULL, scopée au chantier par sécurité malgré tout.
  const { data: repData } = await db.from('site_reports')
    .select('origin, title, started_at, created_at')
    .eq('id', c.report_id).eq('site_id', siteId).is('deleted_at', null).maybeSingle()
  const rep = repData as { origin: string | null; title: string | null; started_at: string | null; created_at: string } | null
  // Sans visite lisible, la fiche n'a plus de fil : on préfère ne rien ouvrir
  // plutôt que d'afficher une observation flottante.
  if (!rep) return null
  const repType = rep.origin ? 'Visite' : 'Réunion'
  const repDate = frDate(rep.started_at ?? rep.created_at)

  // ── LA CIBLE D'UN ROUTAGE DOIT APPARTENIR À CE CHANTIER ────────────────────
  // `visit_capture_routes` ne porte pas de `site_id` : la capture est scopée, ses
  // cibles ne le sont pas. Sans cette vérification, un `target_id` pointant un
  // objet d'un autre chantier produisait un lien — et révélait son existence.
  // Les six autres fiches scopent chacune de leurs relations ; celle-ci était la
  // seule à ne pas le faire.
  const routes = (routesRes.data ?? []) as Array<{ target_id: string; target_table: string | null }>
  const idsParTable = new Map<string, string[]>()
  for (const r of routes) {
    if (!r.target_table) continue
    idsParTable.set(r.target_table, [...(idsParTable.get(r.target_table) ?? []), r.target_id])
  }

  // Une lecture par table, toutes en parallèle : on ne paie qu'une vague.
  const tablesConnues = ['site_actions', 'site_reserve', 'subjects', 'documents'] as const
  const verifs = await Promise.all(
    tablesConnues.map(async (table) => {
      const ids = idsParTable.get(table)
      if (!ids?.length) return [table, new Set<string>()] as const
      // `documents` n'a pas de `site_id` : son rattachement passe par un lien.
      const { data } = table === 'documents'
        ? await db.from('document_links').select('document_id')
            .in('document_id', ids).eq('target_type', 'site').eq('target_id', siteId)
        : await db.from(table).select('id').in('id', ids).eq('site_id', siteId)
      const vus = new Set(
        ((data ?? []) as Array<Record<string, string>>).map((row) => row.document_id ?? row.id),
      )
      return [table, vus] as const
    }),
  )
  const autorises: Map<string, Set<string>> = new Map(verifs)

  // Une seule passe : la cible garde sa ligne, mais ne devient CLIQUABLE que si
  // elle appartient bien à ce chantier. Ne pas l afficher du tout masquerait un
  // routage réel ; l ouvrir sans vérifier révélerait un objet d ailleurs.
  const produits: ObservationProduit[] = routes.map((r) => {
    const { typeLabel, href } = cibleHref(r.target_table, r.target_id, siteId)
    const verifiee = r.target_table ? (autorises.get(r.target_table)?.has(r.target_id) ?? false) : false
    return { id: r.target_id, typeLabel, href: verifiee ? href : null }
  })

  return {
    id: c.id,
    siteId,
    texte: c.body?.trim() || null,
    genreLabel: GENRE[c.kind] ?? c.kind,
    transcriptionEnCours: c.transcript_status === 'pending',
    statutLabel: STATUT[c.status] ?? c.status,
    ecartee: c.status === 'discarded',
    date: frDate(c.captured_at ?? c.created_at),
    visite: {
      label: `${rep.title?.trim() || repType}${repDate ? ` du ${repDate}` : ''}`,
      href: `/sites/${siteId}/reunion/${c.report_id}`,
    },
    produits,
    pieceJointe: Boolean(c.attachment_id),
  }
}
