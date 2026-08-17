import 'server-only'

// Résolution d'une mention textuelle libre vers un acteur existant (company OU
// company_contact) — P4-B.2 (Vincent, 2026-08-17). Fusionne les deux pools
// dans UN SEUL résolveur car c'est le même problème (résoudre une mention
// humaine vers une identité déjà connue), pas une asymétrie organisme/personne.
//
// Doctrine :
//   1. Correspondance exacte normalisée (name/short_name/full_name) → resolved
//      si unique, ambiguous si plusieurs acteurs partagent le même nom exact.
//   2. Containment par tokens (ex. "Jérôme" ⊆ "Jérôme Martin") → resolved si un
//      seul acteur touché, ambiguous si plusieurs (ex. deux "Jérôme" réels).
//   3. not_found sinon.
//
// Pas de scoring Jaccard flou ici (à la différence de canonical_subject) : un
// nom d'acteur est un nom propre, l'exactitude prime sur la similarité.
// L'ambiguïté n'est JAMAIS tranchée automatiquement — c'est au resolver de la
// signaler, jamais au schéma de l'interdire (deux "Jérôme" confirmés peuvent
// coexister dans actor_alias, cf. mig 327).

import { createAdminClient } from '@/lib/supabase/admin'

export type ActorCandidate =
  | { kind: 'company'; id: string; label: string }
  | { kind: 'contact'; id: string; label: string; companyId: string | null }

export type ActorResolutionResult =
  | { kind: 'resolved'; candidate: ActorCandidate }
  | { kind: 'ambiguous'; candidates: ActorCandidate[] }
  | { kind: 'not_found' }

/**
 * Normalise un texte pour la comparaison d'identité d'acteur :
 * minuscules → suppression diacritiques → alphanumériques + espaces → trim.
 */
export function normalizeActorLabel(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalizeActorLabel(text).split(' ').filter(Boolean)
}

/**
 * Un candidat est touché par containment si TOUS les tokens de la mention
 * apparaissent parmi les tokens du nom candidat (ordre indifférent).
 * "jerome" ⊆ {jerome, martin} → true. "martin dupont" ⊄ {jerome, martin} → false.
 * Exportée pour les tests unitaires (pas d'appel DB).
 */
export function actorTokenContainment(queryText: string, candidateLabel: string): boolean {
  const queryTokens = tokenize(queryText)
  if (queryTokens.length === 0) return false
  const candidateTokens = new Set(tokenize(candidateLabel))
  return queryTokens.every((t) => candidateTokens.has(t))
}

type CompanyRow = { id: string; name: string; short_name: string | null }
type ContactRow = { id: string; full_name: string; company_id: string | null }

function buildCompanyCandidates(rows: CompanyRow[]): ActorCandidate[] {
  return rows.map((c) => ({ kind: 'company', id: c.id, label: c.name }))
}

function buildContactCandidates(rows: ContactRow[]): ActorCandidate[] {
  return rows.map((c) => ({ kind: 'contact', id: c.id, label: c.full_name, companyId: c.company_id }))
}

/**
 * Restreint un ensemble ambigu de candidats à ceux dont l'entreprise porteuse
 * correspond à `targetOrg` (ex. « Jérôme Martin de BECIB » → ne garde que le
 * contact Jérôme Martin dont l'entreprise est BECIB). Une company candidate
 * est comparée à elle-même (elle EST l'entreprise) ; un contact candidat est
 * comparé à son entreprise parente via `companyById` (déjà chargée, pas de
 * requête supplémentaire).
 *
 * Ne tranche jamais en absence d'info : un candidat sans entreprise connue
 * (companyId null / introuvable) est exclu, jamais gardé par défaut.
 */
function narrowByOrg(
  candidates: ActorCandidate[],
  targetOrg: string,
  companyById: Map<string, string>,
): ActorCandidate[] {
  return candidates.filter((c) => {
    const companyName = c.kind === 'company' ? c.label : (c.companyId ? companyById.get(c.companyId) ?? null : null)
    if (!companyName) return false
    return (
      normalizeActorLabel(companyName) === normalizeActorLabel(targetOrg) ||
      actorTokenContainment(targetOrg, companyName)
    )
  })
}

/**
 * Résout une mention textuelle libre (ex : "Clim Expair", "Jérôme") vers un
 * acteur existant (company ou company_contact) de l'organisation.
 *
 * `targetOrg` (optionnel, ex. "BECIB" extrait de « Jérôme Martin de BECIB »)
 * ne sert qu'à DÉSAMBIGUÏSER un ensemble déjà ambigu — jamais à remplacer la
 * correspondance sur le nom lui-même. Si la restriction par organisation ne
 * laisse aucun candidat, on revient à l'ensemble ambigu non restreint plutôt
 * que de perdre l'information (jamais de not_found silencieux par ce biais).
 *
 * La validation que l'utilisateur a accès à organizationId est portée par la
 * couche appelante (requireSiteAccess + vérification org du site).
 */
export async function resolveActorTarget(
  organizationId: string,
  targetText: string,
  targetOrg?: string | null,
): Promise<ActorResolutionResult> {
  const supabase = createAdminClient()

  const [{ data: companies }, { data: contacts }] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, short_name')
      .eq('organization_id', organizationId)
      .is('deleted_at', null),
    supabase
      .from('company_contacts')
      .select('id, full_name, company_id')
      .eq('organization_id', organizationId)
      .is('deleted_at', null),
  ])

  const companyRows = (companies ?? []) as CompanyRow[]
  const contactRows = (contacts ?? []) as ContactRow[]

  if (companyRows.length === 0 && contactRows.length === 0) return { kind: 'not_found' }

  const companyById = new Map(companyRows.map((c) => [c.id, c.name]))
  const normalizedTarget = normalizeActorLabel(targetText)

  // ── Pass 1 : correspondance exacte normalisée ─────────────────────────────
  const exactCompanies = companyRows.filter(
    (c) => normalizeActorLabel(c.name) === normalizedTarget ||
      (c.short_name && normalizeActorLabel(c.short_name) === normalizedTarget),
  )
  const exactContacts = contactRows.filter((c) => normalizeActorLabel(c.full_name) === normalizedTarget)

  const exactMatches: ActorCandidate[] = [
    ...buildCompanyCandidates(exactCompanies),
    ...buildContactCandidates(exactContacts),
  ]

  if (exactMatches.length === 1) return { kind: 'resolved', candidate: exactMatches[0] }
  if (exactMatches.length > 1) {
    if (targetOrg) {
      const narrowed = narrowByOrg(exactMatches, targetOrg, companyById)
      if (narrowed.length === 1) return { kind: 'resolved', candidate: narrowed[0] }
      if (narrowed.length > 1) return { kind: 'ambiguous', candidates: narrowed }
    }
    return { kind: 'ambiguous', candidates: exactMatches }
  }

  // ── Pass 2 : containment par tokens ────────────────────────────────────────
  const containedCompanies = companyRows.filter(
    (c) => actorTokenContainment(targetText, c.name) ||
      (c.short_name ? actorTokenContainment(targetText, c.short_name) : false),
  )
  const containedContacts = contactRows.filter((c) => actorTokenContainment(targetText, c.full_name))

  const containedMatches: ActorCandidate[] = [
    ...buildCompanyCandidates(containedCompanies),
    ...buildContactCandidates(containedContacts),
  ]

  if (containedMatches.length === 1) return { kind: 'resolved', candidate: containedMatches[0] }
  if (containedMatches.length > 1) {
    if (targetOrg) {
      const narrowed = narrowByOrg(containedMatches, targetOrg, companyById)
      if (narrowed.length === 1) return { kind: 'resolved', candidate: narrowed[0] }
      if (narrowed.length > 1) return { kind: 'ambiguous', candidates: narrowed }
    }
    return { kind: 'ambiguous', candidates: containedMatches }
  }

  return { kind: 'not_found' }
}

/**
 * Recharge un candidat par id après une clarification (l'utilisateur a tranché
 * une ambiguïté côté client — cf. `selectedCandidateId` dans
 * copilot-free-prepare.ts). `id` peut appartenir à `companies` ou
 * `company_contacts` : les deux espaces d'id sont indépendants (gen_random_uuid()
 * dans chaque table), donc tenter l'un puis l'autre est sans risque de collision.
 */
export async function resolveActorCandidateById(
  organizationId: string,
  id: string,
): Promise<ActorCandidate | null> {
  const supabase = createAdminClient()

  const { data: company } = await supabase
    .from('companies')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (company) return { kind: 'company', id: company.id, label: company.name }

  const { data: contact } = await supabase
    .from('company_contacts')
    .select('id, full_name, company_id')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (contact) return { kind: 'contact', id: contact.id, label: contact.full_name, companyId: contact.company_id }

  return null
}
