import 'server-only'

// ── Liaison automatique canonical_subject → company / contact ─────────────────
//
// Deux fonctions :
//
//   tryActorAutoLink()         — résolution depuis un label : cherche l'identité
//                                dans l'org, écrit si unique (PV historique)
//
//   ensureActorCanonicalSubject() — identité déjà connue (companyId/contactId) :
//                                crée le CS + STI si absent (visites/casting)
//
// Règle stricte :
//   company : match exact normalisé dans la même organisation → link si unique
//   person  : comparerNoms() règle identique|initiale-et-nom → link si unique
//   ambigu  → aucune écriture ; pas de match → sujet reste valide mais non lié

import { createAdminClient } from '@/lib/supabase/admin'
import { normaliserNom, comparerNoms } from '@/lib/acteurs/resolution-identite'

export type ActorAutoLinkOutcome =
  | 'linked'
  | 'skipped'
  | 'no_match'
  | 'ambiguous'
  | 'conflict'
  | 'error'

export interface ActorAutoLinkResult {
  outcome: ActorAutoLinkOutcome
  matchedId?: string
  detail?: string
}

// Seules ces règles autorisent un lien automatique pour une personne.
// orthographe-proche et prenom-seul sont trop risquées sans validation humaine.
const PERSON_AUTO_RULES = new Set(['identique', 'initiale-et-nom'])

export async function tryActorAutoLink(
  canonicalSubjectId: string,
  siteId: string,
  family: 'person' | 'company',
): Promise<ActorAutoLinkResult> {
  const sb = createAdminClient()

  // 1. Charger le canonical_subject
  const { data: cs } = await sb
    .from('canonical_subject')
    .select('id, label, company_id, contact_id, status')
    .eq('id', canonicalSubjectId)
    .eq('status', 'active')
    .maybeSingle()

  if (!cs) return { outcome: 'error', detail: 'canonical_subject introuvable ou inactif' }

  const label = cs.label as string

  // 2. Déjà lié → skip
  if (cs.company_id || cs.contact_id) return { outcome: 'skipped', detail: 'déjà lié' }

  // 3. Organisation du chantier
  const { data: site } = await sb
    .from('sites')
    .select('organization_id')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) return { outcome: 'error', detail: 'chantier introuvable' }
  const orgId = site.organization_id as string

  return family === 'company'
    ? tryLinkCompany(sb, canonicalSubjectId, label, orgId)
    : tryLinkPerson(sb, canonicalSubjectId, label, orgId)
}

// ── Résolution entreprise ─────────────────────────────────────────────────────

async function tryLinkCompany(
  sb: ReturnType<typeof createAdminClient>,
  csId: string,
  label: string,
  orgId: string,
): Promise<ActorAutoLinkResult> {
  const norm = normaliserNom(label)

  const { data: companies } = await sb
    .from('companies')
    .select('id, name')
    .eq('organization_id', orgId)
    .is('deleted_at', null)

  const hits = (companies ?? []).filter(
    (c) => normaliserNom(c.name as string) === norm,
  )

  if (hits.length === 0) return { outcome: 'no_match' }
  if (hits.length > 1) {
    return { outcome: 'ambiguous', detail: `${hits.length} entreprises normalisées identiques` }
  }

  const matched = hits[0]!
  const { error } = await sb
    .from('canonical_subject')
    .update({
      company_id: matched.id,
      actor_link_source: 'auto',
      actor_link_confidence: 1.000,
      actor_link_validated_at: null,
      actor_link_validated_by: null,
    })
    .eq('id', csId)
    .eq('status', 'active')
    .is('company_id', null)

  if (error) return { outcome: 'error', detail: error.message }
  return { outcome: 'linked', matchedId: matched.id as string }
}

// ── Résolution personne ───────────────────────────────────────────────────────

async function tryLinkPerson(
  sb: ReturnType<typeof createAdminClient>,
  csId: string,
  label: string,
  orgId: string,
): Promise<ActorAutoLinkResult> {
  // Récupérer tous les contacts de l'org (via leurs entreprises)
  const { data: companyRows } = await sb
    .from('companies')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)

  if (!companyRows?.length) return { outcome: 'no_match' }

  const companyIds = companyRows.map((c) => c.id as string)
  const { data: contacts } = await sb
    .from('company_contacts')
    .select('id, full_name')
    .in('company_id', companyIds)
    .is('deleted_at', null)

  if (!contacts?.length) return { outcome: 'no_match' }

  interface PersonHit { id: string; confidence: number }
  const hits: PersonHit[] = []

  for (const contact of contacts) {
    const result = comparerNoms(label, contact.full_name as string)
    if (result && PERSON_AUTO_RULES.has(result.regle)) {
      hits.push({ id: contact.id as string, confidence: result.score / 100 })
    }
  }

  if (hits.length === 0) return { outcome: 'no_match' }
  if (hits.length > 1) {
    return { outcome: 'ambiguous', detail: `${hits.length} contacts correspondants` }
  }

  const matched = hits[0]!
  const { error } = await sb
    .from('canonical_subject')
    .update({
      contact_id: matched.id,
      actor_link_source: 'auto',
      actor_link_confidence: matched.confidence,
      actor_link_validated_at: null,
      actor_link_validated_by: null,
    })
    .eq('id', csId)
    .eq('status', 'active')
    .is('contact_id', null)

  if (error) return { outcome: 'error', detail: error.message }
  return { outcome: 'linked', matchedId: matched.id }
}

// ── Ensure actor canonical subject (visites / casting) ────────────────────────
//
// Appelé depuis openSiteIntervenant() — point d'entrée commun pour toutes les
// sources (visites terrain, casting, CR). Crée un canonical_subject + STI si
// aucun n'existe encore pour cet acteur (company ou contact) sur ce chantier.
//
// Le label est résolu depuis le répertoire (company.name / contact.full_name)
// pour garantir la cohérence avec l'identité canonique, pas la variante extraite.
//
// Non-bloquant : silencieux si le CS existe déjà (idempotent).

export async function ensureActorCanonicalSubject(
  siteId: string,
  companyId: string,
  contactId: string | null,
): Promise<void> {
  const sb = createAdminClient()

  // Clé de recherche : contact prime sur entreprise (person vs company actor)
  const existsQuery = contactId
    ? sb.from('canonical_subject').select('id').eq('site_id', siteId).eq('contact_id', contactId).eq('status', 'active').maybeSingle()
    : sb.from('canonical_subject').select('id').eq('site_id', siteId).eq('company_id', companyId).eq('status', 'active').maybeSingle()

  const { data: existing } = await existsQuery
  if (existing) return

  // Résoudre le label depuis le répertoire (nom canonique, pas la variante extraite)
  let label: string
  if (contactId) {
    const { data: contact } = await sb.from('company_contacts').select('full_name').eq('id', contactId).maybeSingle()
    if (!contact) return
    label = contact.full_name as string
  } else {
    const { data: company } = await sb.from('companies').select('name').eq('id', companyId).maybeSingle()
    if (!company) return
    label = company.name as string
  }

  // Créer le canonical_subject avec l'identité déjà résolue
  const { data: newCs, error: csErr } = await sb
    .from('canonical_subject')
    .insert({
      site_id: siteId,
      label,
      status: 'active',
      ...(contactId
        ? { contact_id: contactId, actor_link_source: 'auto', actor_link_confidence: 1.000 }
        : { company_id: companyId, actor_link_source: 'auto', actor_link_confidence: 1.000 }),
    })
    .select('id')
    .single()

  if (csErr || !newCs) return // Silencieux sur contrainte unique (race condition)

  await sb.from('subject_thread_identity').insert({
    subject_thread_id: crypto.randomUUID(),
    site_id: siteId,
    canonical_subject_id: (newCs as { id: string }).id,
    source: 'auto',
  })
}
