// /manuel — Manuel d'utilisation MemorIA en expérience de documentation premium.
//
// Vincent 2026-05-23. Découpe docs/MODE_EMPLOI.md en CHAPITRES (par titre H2,
// le « Sommaire » étant remplacé par la sidebar de navigation), rend chaque
// chapitre en HTML (marked) et délègue l'expérience de lecture à ManuelBook
// (sidebar / hero / précédent-suivant / mobile).

import { redirect } from 'next/navigation'
import { promises as fs } from 'fs'
import { join } from 'path'
import { marked } from 'marked'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { ManuelBook, type ManuelChapter } from './ManuelBook'

export const dynamic = 'force-dynamic'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

/** Découpe le markdown en chapitres sur les titres H2 (## …). Ignore le
 * « Sommaire » (la sidebar le remplace) et tout ce qui le suit jusqu'au
 * chapitre suivant. */
function splitChapters(md: string): Array<{ num: string | null; title: string; body: string }> {
  const out: Array<{ num: string | null; title: string; bodyLines: string[] }> = []
  let current: { num: string | null; title: string; bodyLines: string[] } | null = null
  let skipping = false

  for (const line of md.split('\n')) {
    const m = /^##\s+(.*\S)\s*$/.exec(line)
    if (m) {
      const titleRaw = m[1].trim()
      if (/^sommaire$/i.test(titleRaw)) {
        current = null
        skipping = true
        continue
      }
      const nm = /^(\d+)\.\s+(.*)$/.exec(titleRaw)
      current = { num: nm ? nm[1]! : null, title: nm ? nm[2]! : titleRaw, bodyLines: [] }
      out.push(current)
      skipping = false
    } else if (current && !skipping) {
      current.bodyLines.push(line)
    }
  }

  return out.map((c) => ({ num: c.num, title: c.title, body: c.bodyLines.join('\n').trim() }))
}

export default async function ManuelPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  let lastGenerated: string | null = null
  try {
    const stat = await fs.stat(join(process.cwd(), 'public', 'manuel.docx'))
    lastGenerated = stat.mtime.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    lastGenerated = null
  }

  let mdContent = ''
  try {
    mdContent = await fs.readFile(join(process.cwd(), 'docs', 'MODE_EMPLOI.md'), 'utf-8')
  } catch {
    mdContent = ''
  }

  const parsed = splitChapters(mdContent)
  const chapters: ManuelChapter[] = await Promise.all(
    parsed.map(async (c) => ({
      id: slugify(c.title) || c.title,
      num: c.num,
      title: c.title,
      html: await marked.parse(c.body, { gfm: true, breaks: true }),
    })),
  )

  return (
    <div className="max-w-6xl mx-auto py-2">
      <ManuelBook chapters={chapters} lastGenerated={lastGenerated} />
    </div>
  )
}
