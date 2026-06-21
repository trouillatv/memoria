import { listKnowledgeItems } from '@/lib/db/knowledge'
import type { KnowledgeCategory } from '@/types/db'

const CATEGORY_TITLES: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains: 'Moyens humains',
  materiel: 'Matériel',
  procedures: 'Procédures',
  qualite: 'Qualité',
  anciens_memoires: 'Anciens mémoires techniques',
}

export interface LibrarySnapshot {
  items_count: number
  total_chars: number
}

export async function buildLibraryContext(orgId?: string | null): Promise<{ markdown: string; snapshot: LibrarySnapshot }> {
  // orgId fourni (même null) → mode admin scopé (indépendant des cookies, ex.
  // analyse AO en route). Sinon → RLS via cookies (atelier en contexte requête).
  const items = orgId !== undefined ? await listKnowledgeItems({}, { orgId }) : await listKnowledgeItems({})
  if (items.length === 0) {
    return { markdown: '', snapshot: { items_count: 0, total_chars: 0 } }
  }

  const grouped: Record<string, typeof items> = {}
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = []
    grouped[it.category].push(it)
  }

  const sections: string[] = ['## Contexte de l\'entreprise (bibliothèque AGP)']
  for (const cat of Object.keys(CATEGORY_TITLES) as KnowledgeCategory[]) {
    const list = grouped[cat]
    if (!list || list.length === 0) continue
    sections.push(`### ${CATEGORY_TITLES[cat]}`)
    for (const it of list) {
      const tagsLine = it.tags && it.tags.length > 0 ? ` _(${it.tags.join(', ')})_` : ''
      sections.push(`- **${it.title}**${tagsLine}\n  ${it.content_markdown.slice(0, 600).replace(/\n/g, '\n  ')}`)
    }
  }

  const markdown = sections.join('\n\n')
  return {
    markdown,
    snapshot: { items_count: items.length, total_chars: markdown.length },
  }
}
