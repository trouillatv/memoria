import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isActorKind } from '@/lib/subjects/kind'

// Taille maximale du bloc de contexte injecté dans le prompt LLM.
// Assez compact pour ne pas noyer les règles d'extraction, assez riche
// pour couvrir les acteurs et sujets fréquents d'un chantier mature.
const MAX_CONTEXT_CHARS = 3000
const MAX_ACTORS = 15
const MAX_SUBJECTS = 30

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
      .select('label, aliases, kind')
      .eq('site_id', siteId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const siteName = (siteResult.data as { name: string } | null)?.name ?? null

  type CS = { label: string; aliases: string[]; kind: string | null }
  const csRows = (subjectsResult.data ?? []) as CS[]

  if (!siteName && csRows.length === 0) return ''

  const actors = csRows.filter((s) => isActorKind(s.kind))
  const operationalSubjects = csRows.filter((s) => !isActorKind(s.kind))

  // Les sujets avec aliases confirmés par des humains en priorité
  operationalSubjects.sort((a, b) => {
    const aHas = (a.aliases ?? []).length > 0 ? 1 : 0
    const bHas = (b.aliases ?? []).length > 0 ? 1 : 0
    return bHas - aHas
  })

  const lines: string[] = []

  if (siteName) lines.push(`Chantier : ${siteName}`)

  if (actors.length > 0) {
    lines.push('')
    lines.push('Acteurs connus sur ce chantier :')
    for (const a of actors.slice(0, MAX_ACTORS)) {
      const aliases = a.aliases ?? []
      const aliasStr = aliases.length > 0 ? ` [alias : "${aliases.join('", "')}"]` : ''
      lines.push(`- ${a.label}${aliasStr}`)
    }
  }

  if (operationalSubjects.length > 0) {
    lines.push('')
    lines.push('Sujets suivis — si une formulation du PV correspond, utiliser ce label :')
    for (const s of operationalSubjects.slice(0, MAX_SUBJECTS)) {
      const aliases = s.aliases ?? []
      const aliasStr = aliases.length > 0 ? ` [alias : "${aliases.join('", "')}"]` : ''
      lines.push(`- ${s.label}${aliasStr}`)
    }
  }

  const header = '=== Contexte connu du chantier ==='
  let block = header + '\n' + lines.join('\n')

  if (block.length > MAX_CONTEXT_CHARS) {
    block = block.slice(0, MAX_CONTEXT_CHARS - 4) + '\n...'
  }

  return block
}
