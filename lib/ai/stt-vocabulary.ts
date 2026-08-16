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
import type { VocabularyTerm } from '@/lib/ai/transcript-normalizer'

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
    const push = (canonical: string, kind: VocabularyTerm['kind'], forms: string[] = []) => {
      const label = canonical.trim()
      if (!label) return
      terms.push({ canonical: label, kind, forms: [label, ...forms.map((f) => f.trim()).filter(Boolean)] })
    }

    push(distinctiveCore(siteRes.data.name as string), 'site')

    // Acteurs du chantier. `company_id` pointe vers `companies` (les entreprises),
    // PAS vers `organizations` (le locataire) : les confondre ferait entrer le nom
    // de l'organisation de l'utilisateur dans le vocabulaire du chantier.
    const rows = intervenantsRes.data ?? []
    const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean) as string[])]
    const contactIds = [...new Set(rows.map((r) => r.main_contact_id).filter(Boolean) as string[])]

    const [companiesRes, contactsRes] = await Promise.all([
      companyIds.length
        ? admin.from('companies').select('name, short_name').in('id', companyIds)
        : Promise.resolve({ data: [] as Array<{ name: string | null; short_name: string | null }> }),
      contactIds.length
        ? admin.from('company_contacts').select('full_name').in('id', contactIds)
        : Promise.resolve({ data: [] as Array<{ full_name: string | null }> }),
    ])

    for (const c of companiesRes.data ?? []) {
      if (c.name) push(c.name, 'company', c.short_name ? [c.short_name] : [])
      else if (c.short_name) push(c.short_name, 'company')
    }
    for (const c of contactsRes.data ?? []) {
      if (c.full_name) push(c.full_name, 'person')
    }

    // Mémoire sémantique — portée chantier ou portée organisation (site_id NULL).
    const entities = (entitiesRes.data ?? []).filter((e) => e.site_id === null || e.site_id === siteId)
    if (entities.length) {
      const aliasRes = await admin
        .from('site_knowledge_entity_aliases')
        .select('entity_id, alias')
        .in('entity_id', entities.map((e) => e.id))
      const aliasesByEntity = new Map<string, string[]>()
      for (const a of aliasRes.data ?? []) {
        const list = aliasesByEntity.get(a.entity_id as string) ?? []
        list.push(a.alias as string)
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
    const merged = new Map<string, VocabularyTerm>()
    for (const t of terms) {
      const key = strip(t.canonical).replace(/[^a-z0-9]/g, '')
      if (!key) continue
      const existing = merged.get(key)
      if (existing) existing.forms = [...new Set([...existing.forms, ...t.forms])]
      else merged.set(key, { ...t, forms: [...new Set(t.forms)] })
    }
    return [...merged.values()]
  } catch {
    return []
  }
}
