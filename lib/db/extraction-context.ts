import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Taille maximale du bloc de contexte injecté dans le prompt LLM.
const MAX_CONTEXT_CHARS = 3000
// Sujets avec aliases confirmés (formulations validées par des humains) — priorité 1
const MAX_SUBJECTS_WITH_ALIASES = 25
// Sujets sans alias — contexte secondaire, limité pour ne pas diluer le signal
const MAX_SUBJECTS_WITHOUT_ALIASES = 10

/**
 * Construit un bloc de contexte compact pour l'extraction LLM d'un PV.
 *
 * Contient : nom du chantier, acteurs connus (person/company), sujets actifs +
 * aliases confirmés par des humains. Les sujets avec alias sont prioritaires :
 * ce sont des formulations que le système a déjà apprises.
 *
 * Retourne '' si aucun contexte utile n'est disponible (pipeline inchangé).
 *
 * Doctrine : le contexte aide le LLM à nommer de façon cohérente ce qu'il extrait.
 * Il ne crée pas de vérité automatique — la résolution canonique reste le juge final.
 */
export async function buildExtractionSiteContext(siteId: string): Promise<string> {
  const supabase = createAdminClient()

  const [siteResult, subjectsResult] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).maybeSingle(),
    supabase
      .from('canonical_subject')
      .select('label, aliases')
      .eq('site_id', siteId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const siteName = (siteResult.data as { name: string } | null)?.name ?? null

  type CS = { label: string; aliases: string[] }
  const csRows = (subjectsResult.data ?? []) as CS[]

  if (!siteName && csRows.length === 0) return ''

  // Séparation : sujets avec aliases (formulations validées) vs sans
  // Les deux groupes arrivent déjà triés par created_at DESC (les plus récents en premier)
  const withAliases    = csRows.filter((s) => (s.aliases ?? []).length > 0).slice(0, MAX_SUBJECTS_WITH_ALIASES)
  const withoutAliases = csRows.filter((s) => (s.aliases ?? []).length === 0).slice(0, MAX_SUBJECTS_WITHOUT_ALIASES)

  const lines: string[] = []

  if (siteName) lines.push(`Chantier : ${siteName}`)

  // Sujets avec aliases en premier : formulations déjà validées par un humain
  if (withAliases.length > 0) {
    lines.push('')
    lines.push('Sujets suivis avec formulations alternatives connues :')
    for (const s of withAliases) {
      const aliases = s.aliases ?? []
      lines.push(`- ${s.label} [alias : "${aliases.join('", "')}"]`)
    }
  }

  // Sujets sans alias : labels connus mais sans validation de formulation alternative
  if (withoutAliases.length > 0) {
    lines.push('')
    lines.push('Autres sujets actifs :')
    for (const s of withoutAliases) {
      lines.push(`- ${s.label}`)
    }
  }

  const header = '=== Mémoire du chantier (aide à la compréhension, pas à la réécriture) ==='
  let block = header + '\n' + lines.join('\n')

  if (block.length > MAX_CONTEXT_CHARS) {
    block = block.slice(0, MAX_CONTEXT_CHARS - 4) + '\n...'
  }

  return block
}
