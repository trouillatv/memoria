// /manuel — Manuel d'utilisation MemorIA en expérience de documentation premium.
//
// Vincent 2026-05-23. Découpe docs/MODE_EMPLOI.md en CHAPITRES (titres H2), avec :
//   - une ACCROCHE (lead) automatique = 1er paragraphe du chapitre ;
//   - des CALLOUTS éditoriaux via admonitions `> [!TYPE] Titre` (GitBook-style).
// L'expérience de lecture (sidebar / hero / précédent-suivant) est dans ManuelBook.

import { redirect } from 'next/navigation'
import { promises as fs } from 'fs'
import { join } from 'path'
import { marked } from 'marked'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { ManuelBook, type ManuelChapter } from './ManuelBook'

export const dynamic = 'force-dynamic'

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ----------------------------------------------------------------------------
// Callouts éditoriaux — admonitions `> [!TYPE] Titre optionnel`
// ----------------------------------------------------------------------------

const CALLOUT: Record<string, { label: string; box: string; label_cls: string }> = {
  NOTE: { label: 'À retenir', box: 'border-l-sky-400 bg-sky-50/60 dark:bg-sky-950/20', label_cls: 'text-sky-700 dark:text-sky-300' },
  INFO: { label: 'À retenir', box: 'border-l-sky-400 bg-sky-50/60 dark:bg-sky-950/20', label_cls: 'text-sky-700 dark:text-sky-300' },
  TIP: { label: 'Bon réflexe', box: 'border-l-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/20', label_cls: 'text-emerald-700 dark:text-emerald-300' },
  SUCCESS: { label: 'La promesse', box: 'border-l-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/20', label_cls: 'text-emerald-700 dark:text-emerald-300' },
  IMPORTANT: { label: 'Important', box: 'border-l-brand-400 bg-brand-50/60 dark:bg-brand-950/20', label_cls: 'text-brand-700 dark:text-brand-300' },
  WARNING: { label: 'Attention', box: 'border-l-amber-400 bg-amber-50/60 dark:bg-amber-950/20', label_cls: 'text-amber-700 dark:text-amber-300' },
  DANGER: { label: 'À éviter', box: 'border-l-red-400 bg-red-50/60 dark:bg-red-950/20', label_cls: 'text-red-700 dark:text-red-300' },
  CAUTION: { label: 'À éviter', box: 'border-l-red-400 bg-red-50/60 dark:bg-red-950/20', label_cls: 'text-red-700 dark:text-red-300' },
}

/** Transforme les blockquotes `> [!TYPE] Titre` en blocs éditoriaux typés. */
function decorateCallouts(html: string): string {
  return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (full, inner: string) => {
    const m = /^\s*<p>\s*\[!(\w+)\]([^<\n]*)/.exec(inner)
    if (!m) return full
    const meta = CALLOUT[m[1]!.toUpperCase()]
    if (!meta) return full
    const label = (m[2] ?? '').trim() || meta.label
    const content = inner.replace(/^\s*<p>\s*\[!\w+\][^<\n]*\s*(?:<br\s*\/?>)?\s*/, '<p>')
    return (
      `<div class="my-6 rounded-r-lg border-l-4 ${meta.box} px-4 py-3">` +
      `<p class="text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${meta.label_cls}">${escapeHtml(label)}</p>` +
      `<div class="text-sm leading-relaxed text-foreground/80 [&>p]:my-1.5 [&>ul]:my-1.5 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">${content}</div>` +
      `</div>`
    )
  })
}

// ----------------------------------------------------------------------------
// Découpe en chapitres + extraction du lead
// ----------------------------------------------------------------------------

/** Sépare le 1er paragraphe (accroche) du reste du corps. Pas d'accroche si le
 * chapitre commence par une structure (titre, liste, tableau, citation). */
function extractLead(body: string): { lead: string; rest: string } {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++
  if (i >= lines.length || /^[#\-*|>]/.test(lines[i]!.trim())) return { lead: '', rest: body }
  const leadLines: string[] = []
  let j = i
  while (j < lines.length && lines[j]!.trim() !== '') {
    leadLines.push(lines[j]!)
    j++
  }
  return { lead: leadLines.join(' ').trim(), rest: lines.slice(j).join('\n').trim() }
}

function splitChapters(md: string): Array<{ num: string | null; title: string; body: string }> {
  const out: Array<{ num: string | null; title: string; bodyLines: string[] }> = []
  let current: { num: string | null; title: string; bodyLines: string[] } | null = null
  let skipping = false

  for (const line of md.split('\n')) {
    const m = /^##\s+(.*\S)\s*$/.exec(line)
    if (m) {
      const titleRaw = m[1]!.trim()
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
    parsed.map(async (c) => {
      const { lead, rest } = extractLead(c.body)
      const html = decorateCallouts(await marked.parse(rest, { gfm: true, breaks: true }))
      const leadHtml = lead ? await marked.parseInline(lead, { gfm: true }) : ''
      return { id: slugify(c.title) || c.title, num: c.num, title: c.title, leadHtml, html }
    }),
  )

  return (
    <div className="max-w-6xl mx-auto py-2">
      <ManuelBook chapters={chapters} lastGenerated={lastGenerated} />
    </div>
  )
}
