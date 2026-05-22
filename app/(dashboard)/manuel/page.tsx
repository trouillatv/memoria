// /manuel — Manuel d'utilisation MemorIA, en LIGNE (livre web) + téléchargeable.
//
// Vincent 2026-05-22. Rend l'INTÉGRALITÉ de docs/MODE_EMPLOI.md comme un livre
// en ligne : toutes les sections avec leur texte, et un sommaire qui navigue
// vers chaque point (ancres). Le .docx reste téléchargeable (hors-ligne).
//
// Rendu serveur (contenu de confiance = notre propre doc) via `marked`, avec
// injection d'ids d'ancrage style GitHub pour que les liens du Sommaire sautent.

import { redirect } from 'next/navigation'
import { promises as fs } from 'fs'
import { join } from 'path'
import { marked } from 'marked'
import { Download, BookOpen } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export const dynamic = 'force-dynamic'

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&hellip;/g, '…')
}

/** Slug style GitHub (minuscules, accents conservés, ponctuation retirée). */
function slugify(text: string): string {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
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

  const rawHtml = mdContent ? await marked.parse(mdContent, { gfm: true }) : ''
  // Injecte un id d'ancrage sur chaque titre (pour la navigation du Sommaire).
  const html = rawHtml.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '')
    return `<h${lvl} id="${slugify(text)}">${inner}</h${lvl}>`
  })

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-brand-600" />
          Manuel d&apos;utilisation MemorIA
        </h1>
        <p className="text-sm text-muted-foreground">
          Le mode d&apos;emploi complet, en ligne. Clique une entrée du sommaire pour sauter à la section.
          {lastGenerated && (
            <> Dernière mise à jour : <span className="font-medium">{lastGenerated}</span>.</>
          )}
        </p>
      </header>

      {/* Téléchargement Word (hors-ligne / partage) */}
      <div className="rounded-lg border border-brand-200 bg-brand-50/30 dark:bg-brand-950/20 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Version <strong>.docx</strong> (~55 Ko) — lisible hors-ligne, partageable par email, imprimable.
          </p>
          <a
            href="/manuel.docx"
            download="MemorIA-MODE-EMPLOI.docx"
            className="shrink-0 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            Télécharger (.docx)
          </a>
        </div>
      </div>

      {/* Livre en ligne — contenu intégral du manuel */}
      {html ? (
        <article
          className="rounded-lg border bg-card p-5 sm:p-8 prose prose-sm sm:prose-base max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h2:border-b prose-h2:pb-1 prose-h2:mt-10 prose-a:text-brand-700 dark:prose-a:text-brand-300 prose-a:no-underline hover:prose-a:underline prose-code:text-xs prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Manuel indisponible (docs/MODE_EMPLOI.md introuvable).
        </p>
      )}
    </div>
  )
}
