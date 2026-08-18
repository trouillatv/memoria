import 'server-only'

// P3-B — construction du vocabulaire FERMÉ d'un chantier, pour la normalisation
// déterministe des transcripts (`lib/ai/transcript-normalizer.ts`).
//
// Distinct de `lib/ai/stt-lexicon.ts` : le lexique est un INDICE envoyé au
// modèle avant la transcription ; ce vocabulaire est une liste de cibles
// AUTORISÉES utilisée après, pour réécrire ce que le modèle a mal orthographié.
// Gemini Live n'accepte aucun indice lexical (prouvé 6/6 le 16/08) — d'où ce
// second chemin.
//
// SÉCURITÉ : lecture par le client admin, qui BYPASSE la RLS. L'appelant DOIT
// avoir vérifié l'appartenance de l'utilisateur à l'organisation du chantier
// AVANT de l'appeler (même contrainte que `buildLexicalPrompt`).

import { createAdminClient } from '@/lib/supabase/admin'
import type { VocabularyForm, VocabularyTerm } from '@/lib/ai/transcript-normalizer'

/** Ce que chaque site d'appel de `push()` sait sur une forme, avant qu'on y attache `canonicalValue`. */
type ExtraForm = Omit<VocabularyForm, 'canonicalValue'>

/**
 * Mots de type générique en tête d'un nom de chantier. « Lycée PETRO ATTITI »
 * est prononcé « pétro à Titi » : la partie distinctive est la seule cible utile,
 * et ne garder qu'elle évite que le normaliseur INSÈRE un mot non prononcé.
 */
const GENERIC_PREFIXES = new Set([
  'lycee', 'college', 'ecole', 'groupe', 'groupement', 'residence', 'immeuble',
  'centre', 'hopital', 'clinique', 'societe', 'entreprise', 'chantier', 'site',
  'villa', 'maison', 'tour', 'batiment', 'parking', 'usine', 'atelier', 'sarl',
  'sas', 'sa', 'eurl', 'scp', 'sci',
])

function strip(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Fautes de transcription CONNUES, indexées par terme réel.
 *
 * Pourquoi ici plutôt qu'en élargissant la tolérance du normaliseur : « Clim
 * Expert » est à 3 substitutions de « Clim Expair ». Autoriser 3 substitutions
 * ferait entrer en collision la moitié des noms d'un chantier. Nommer la faute,
 * elle, ne rend le moteur permissif pour rien d'autre — c'est exactement à ça
 * que sert un alias.
 *
 * Une entrée ne produit RIEN si le terme canonique n'est pas déjà dans le
 * vocabulaire du chantier : ce n'est pas une liste d'entreprises, c'est une
 * liste de fautes attendues sur des termes qui, eux, viennent de la base.
 *
 * `climexpair` : vérité métier tranchée le 17/08. L'entreprise s'appelle
 * « Clim Expair » ; « Clim Expert » n'existe pas — c'est le mot courant que le
 * modèle écrit à la place du nom propre.
 *
 * `petroattiti` : recette terrain du 17/08. Gemini Live a écrit « P3 à Titi ».
 * Le rapprochement flou ne pouvait pas le rattraper — « p3atiti » est à
 * 5 substitutions de « petroattiti » pour une tolérance de 1 — et il ne DOIT
 * pas : autoriser 5 substitutions sur 11 caractères ferait de n'importe quelle
 * expression française un nom de chantier. La faute est donc nommée. « Pétro à
 * Titi » y figure aussi bien qu'il passe déjà en flou : nommé, il devient exact
 * (distance 0) au lieu de consommer l'unique substitution tolérée, qui reste
 * ainsi disponible pour la variation suivante. « Petrofac Titi » : seconde
 * forme observée en recette terrain le 17/08 (tours 4-5) — le modèle entend un
 * nom d'entreprise pétrolière réel (Petrofac) au lieu du sigle du chantier.
 *
 * Volontairement ABSENT : « Pétro Haïti ». Haïti est un mot réel du français ;
 * en faire un alias, c'est exactement le risque que ces entrées existent pour
 * éviter.
 */
const KNOWN_MISTRANSCRIPTIONS: Record<string, string[]> = {
  climexpair: ['Clim Expert'],
  petroattiti: ['P3 à Titi', 'Pétro à Titi', 'Petrofac Titi'],
}

/** Formes fausses documentées pour un terme canonique. Vide si aucune ne l'est. */
export function knownFormsFor(canonical: string): string[] {
  return KNOWN_MISTRANSCRIPTIONS[strip(canonical).replace(/[^a-z0-9]/g, '')] ?? []
}

/** Retire un mot de type générique en tête, si ce qui reste est encore distinctif. */
function distinctiveCore(label: string): string {
  const words = label.trim().split(/\s+/)
  if (words.length < 2) return label.trim()
  if (!GENERIC_PREFIXES.has(strip(words[0]).replace(/[^a-z0-9]/g, ''))) return label.trim()
  const rest = words.slice(1).join(' ')
  return rest.replace(/[^\p{L}\p{N}]/gu, '').length >= 4 ? rest : label.trim()
}

const ENTITY_KINDS: Record<string, VocabularyTerm['kind']> = {
  company: 'company',
  person: 'person',
  acronym: 'acronym',
  expression: 'expression',
  pronunciation: 'expression',
}

/**
 * Vocabulaire fermé du chantier : nom du chantier, entreprises et contacts
 * réellement rattachés, plus les entités de mémoire sémantique et leurs alias.
 *
 * Volontairement PAS de sujets canoniques : ce sont des phrases (« Reprise des
 * enrobés côté nord »), pas des termes ; les rapprocher d'un empan de transcript
 * n'aurait aucun sens.
 *
 * Ne lève jamais : sans vocabulaire, la normalisation est simplement inopérante
 * et le transcript passe inchangé.
 */
export async function buildSiteVocabulary(siteId: string): Promise<VocabularyTerm[]> {
  try {
    const admin = createAdminClient()

    const siteRes = await admin.from('sites').select('name, organization_id').eq('id', siteId).single()
    if (siteRes.error || !siteRes.data) return []
    const organizationId = siteRes.data.organization_id as string

    const [intervenantsRes, entitiesRes] = await Promise.all([
      admin
        .from('site_intervenants')
        .select('company_id, main_contact_id')
        .eq('site_id', siteId)
        .is('effective_to', null),
      admin
        .from('site_knowledge_entities')
        .select('id, canonical_label, entity_type, site_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true),
    ])

    const terms: VocabularyTerm[] = []
    const push = (canonical: string, kind: VocabularyTerm['kind'], extraForms: ExtraForm[] = []) => {
      const label = canonical.trim()
      if (!label) return
      const forms: VocabularyForm[] = [
        { value: label, source: 'canonical_name', canonicalValue: label },
        ...extraForms
          .map((f) => ({ ...f, value: f.value.trim() }))
          .filter((f) => f.value)
          .map((f) => ({ ...f, canonicalValue: label })),
        ...knownFormsFor(label).map((value) => ({
          value,
          source: 'known_mistranscription' as const,
          canonicalValue: label,
        })),
      ]
      terms.push({ canonical: label, kind, forms })
    }

    push(distinctiveCore(siteRes.data.name as string), 'site')

    // Acteurs du chantier. `company_id` pointe vers `companies` (les entreprises),
    // PAS vers `organizations` (le locataire) : les confondre ferait entrer le nom
    // de l'organisation de l'utilisateur dans le vocabulaire du chantier.
    const rows = intervenantsRes.data ?? []
    const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean) as string[])]
    const contactIds = [...new Set(rows.map((r) => r.main_contact_id).filter(Boolean) as string[])]

    const [companiesRes, contactsRes, actorAliasRes] = await Promise.all([
      companyIds.length
        ? admin.from('companies').select('id, name, short_name').in('id', companyIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; short_name: string | null }> }),
      contactIds.length
        ? admin.from('company_contacts').select('id, full_name').in('id', contactIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
      (companyIds.length || contactIds.length)
        ? admin
            .from('actor_alias')
            .select('company_id, contact_id, alias, alias_nature')
            .eq('status', 'confirmed')
            .or([
              companyIds.length ? `company_id.in.(${companyIds.join(',')})` : null,
              contactIds.length ? `contact_id.in.(${contactIds.join(',')})` : null,
            ].filter(Boolean).join(','))
        : Promise.resolve({
            data: [] as Array<{
              company_id: string | null
              contact_id: string | null
              alias: string
              alias_nature: 'business_alias' | 'transcription_alias'
            }>,
          }),
    ])

    // Correspondances enseignées via le Copilote (P4-B.2) : les deux natures
    // (business_alias/transcription_alias) alimentent la STT indifféremment —
    // seule business_alias doit s'afficher ailleurs comme « autre nom ».
    const aliasesByCompany = new Map<string, ExtraForm[]>()
    const aliasesByContact = new Map<string, ExtraForm[]>()
    for (const a of actorAliasRes.data ?? []) {
      const form: ExtraForm = {
        value: a.alias,
        source: 'actor_alias',
        aliasNature: a.alias_nature,
        actorId: a.company_id ?? a.contact_id ?? undefined,
      }
      if (a.company_id) {
        const list = aliasesByCompany.get(a.company_id) ?? []
        list.push(form)
        aliasesByCompany.set(a.company_id, list)
      } else if (a.contact_id) {
        const list = aliasesByContact.get(a.contact_id) ?? []
        list.push(form)
        aliasesByContact.set(a.contact_id, list)
      }
    }

    for (const c of companiesRes.data ?? []) {
      const extra = aliasesByCompany.get(c.id) ?? []
      const shortForm: ExtraForm[] = c.short_name ? [{ value: c.short_name, source: 'short_name' }] : []
      if (c.name) push(c.name, 'company', [...shortForm, ...extra])
      else if (c.short_name) push(c.short_name, 'company', extra)
    }
    for (const c of contactsRes.data ?? []) {
      if (c.full_name) push(c.full_name, 'person', aliasesByContact.get(c.id) ?? [])
    }

    // Mémoire sémantique — portée chantier ou portée organisation (site_id NULL).
    const entities = (entitiesRes.data ?? []).filter((e) => e.site_id === null || e.site_id === siteId)
    if (entities.length) {
      const aliasRes = await admin
        .from('site_knowledge_entity_aliases')
        .select('entity_id, alias')
        .in('entity_id', entities.map((e) => e.id))
      const aliasesByEntity = new Map<string, ExtraForm[]>()
      for (const a of aliasRes.data ?? []) {
        const list = aliasesByEntity.get(a.entity_id as string) ?? []
        list.push({ value: a.alias as string, source: 'knowledge_alias' })
        aliasesByEntity.set(a.entity_id as string, list)
      }
      for (const e of entities) {
        push(
          e.canonical_label as string,
          ENTITY_KINDS[e.entity_type as string] ?? 'expression',
          aliasesByEntity.get(e.id as string) ?? [],
        )
      }
    }

    // Un même terme peut venir de deux sources (entreprise + entité de mémoire) :
    // on fusionne les formes plutôt que de laisser deux cibles rivales, qui
    // feraient renoncer le normaliseur pour cause d'ambiguïté.
    const dedupeForms = (forms: VocabularyForm[]): VocabularyForm[] => {
      const seen = new Set<string>()
      const out: VocabularyForm[] = []
      for (const f of forms) {
        if (seen.has(f.value)) continue
        seen.add(f.value)
        out.push(f)
      }
      return out
    }
    const merged = new Map<string, VocabularyTerm>()
    for (const t of terms) {
      const key = strip(t.canonical).replace(/[^a-z0-9]/g, '')
      if (!key) continue
      const existing = merged.get(key)
      if (existing) existing.forms = dedupeForms([...existing.forms, ...t.forms])
      else merged.set(key, { ...t, forms: dedupeForms(t.forms) })
    }
    return [...merged.values()]
  } catch {
    return []
  }
}
