'use client'

// Manuel MemorIA — expérience de documentation premium (style GitBook / Stripe
// Docs / Linear Handbook). Vincent 2026-05-23.
//
// Layout : sidebar chapitres (sticky, mobile collapsible) + conteneur de
// lecture aéré + hero de chapitre + navigation Précédent/Suivant. Le contenu
// vient de MODE_EMPLOI.md, découpé en chapitres côté serveur — ici on ne fait
// que l'expérience de lecture (état du chapitre actif).

import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download, ChevronLeft, ChevronRight, List, X } from 'lucide-react'

export interface ManuelChapter {
  id: string
  num: string | null
  title: string
  /** Accroche (1er paragraphe), rendu inline. Vide si le chapitre n'en a pas. */
  leadHtml: string
  html: string
}

export function ManuelBook({
  chapters,
  lastGenerated,
}: {
  chapters: ManuelChapter[]
  lastGenerated: string | null
}) {
  const [active, setActive] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  const total = chapters.length
  const current = chapters[active]

  // Remonte en haut du contenu à chaque changement de chapitre.
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [active])

  function goto(i: number) {
    if (i < 0 || i >= total) return
    setActive(i)
    setNavOpen(false)
  }

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Manuel indisponible (docs/MODE_EMPLOI.md introuvable).
      </p>
    )
  }

  return (
    <div ref={topRef} className="flex gap-8 lg:gap-12 scroll-mt-6">
      {/* ── Sidebar desktop ─────────────────────────────────────────────── */}
      <aside className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pb-8">
          <SidebarHeader lastGenerated={lastGenerated} />
          <ChapterNav chapters={chapters} active={active} onSelect={goto} />
        </div>
      </aside>

      {/* ── Contenu ──────────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1">
        {/* Barre mobile : ouvrir les chapitres */}
        <div className="lg:hidden mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setNavOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 h-10 text-sm font-medium"
          >
            {navOpen ? <X className="h-4 w-4" /> : <List className="h-4 w-4" />}
            Chapitres
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {active + 1} / {total}
          </span>
        </div>

        {/* Panneau chapitres mobile */}
        {navOpen && (
          <div className="lg:hidden mb-6 rounded-xl border bg-card p-3 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
            <ChapterNav chapters={chapters} active={active} onSelect={goto} />
          </div>
        )}

        <article className="mx-auto max-w-3xl">
          <ChapterHero index={active} total={total} chapter={current!} />

          <div
            key={active}
            className={[
              'animate-in fade-in duration-300',
              'prose prose-base lg:prose-lg max-w-none dark:prose-invert',
              'prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight',
              'prose-h3:text-lg prose-h3:mt-10 prose-h3:mb-2 prose-h3:text-foreground',
              'prose-p:leading-[1.8] prose-p:text-foreground/80',
              'prose-li:leading-[1.7] prose-li:my-1 prose-ul:my-4',
              'prose-strong:text-foreground prose-hr:my-10',
              'prose-a:text-brand-700 dark:prose-a:text-brand-300 prose-a:font-medium prose-a:no-underline hover:prose-a:underline',
              'prose-code:text-[0.8em] prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none',
              'prose-blockquote:border-l-2 prose-blockquote:border-brand-300 prose-blockquote:bg-brand-50/40 dark:prose-blockquote:bg-brand-950/20 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:text-foreground/80',
              // Tableaux — légers, espacés, sans grille lourde
              'prose-table:text-sm prose-thead:border-b-2 prose-thead:border-border prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border/60 prose-td:align-top',
            ].join(' ')}
            dangerouslySetInnerHTML={{ __html: current!.html }}
          />

          <PrevNextNav chapters={chapters} active={active} onSelect={goto} />
        </article>
      </main>
    </div>
  )
}

// ----------------------------------------------------------------------------

function SidebarHeader({ lastGenerated }: { lastGenerated: string | null }) {
  return (
    <div className="mb-4 pb-4 border-b">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-brand-600" />
        Manuel MemorIA
      </div>
      {lastGenerated && (
        <p className="text-[11px] text-muted-foreground mt-1">Mis à jour le {lastGenerated}</p>
      )}
      <a
        href="/manuel.docx"
        download="MemorIA-MODE-EMPLOI.docx"
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-700 dark:text-brand-300 hover:underline"
      >
        <Download className="h-3.5 w-3.5" />
        Télécharger (.docx)
      </a>
    </div>
  )
}

function ChapterNav({
  chapters,
  active,
  onSelect,
}: {
  chapters: ManuelChapter[]
  active: number
  onSelect: (i: number) => void
}) {
  return (
    <nav className="space-y-0.5" aria-label="Chapitres">
      {chapters.map((c, i) => {
        const isActive = i === active
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(i)}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'group flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/40 dark:text-brand-100'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            ].join(' ')}
          >
            {c.num && (
              <span
                className={[
                  'shrink-0 tabular-nums text-[11px] w-4 text-right',
                  isActive ? 'text-brand-600' : 'text-muted-foreground/60',
                ].join(' ')}
              >
                {c.num}
              </span>
            )}
            <span className="leading-snug">{c.title}</span>
          </button>
        )
      })}
    </nav>
  )
}

function ChapterHero({
  index,
  total,
  chapter,
}: {
  index: number
  total: number
  chapter: ManuelChapter
}) {
  return (
    <header className="mb-8 pb-6 border-b">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">
        Chapitre {index + 1} / {total}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight leading-tight">
        {chapter.title}
      </h1>
      {chapter.leadHtml && (
        <p
          className="mt-4 text-lg leading-relaxed text-muted-foreground [&_code]:text-sm [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_a]:text-brand-700 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: chapter.leadHtml }}
        />
      )}
    </header>
  )
}

function PrevNextNav({
  chapters,
  active,
  onSelect,
}: {
  chapters: ManuelChapter[]
  active: number
  onSelect: (i: number) => void
}) {
  const prev = active > 0 ? chapters[active - 1] : null
  const next = active < chapters.length - 1 ? chapters[active + 1] : null
  return (
    <nav className="mt-12 pt-6 border-t flex items-stretch justify-between gap-3">
      {prev ? (
        <button
          type="button"
          onClick={() => onSelect(active - 1)}
          className="group flex-1 min-w-0 rounded-xl border bg-card p-4 text-left hover:border-brand-300 hover:shadow-sm transition-all"
        >
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Précédent
          </span>
          <span className="mt-1 block text-sm font-medium truncate group-hover:text-brand-700">
            {prev.title}
          </span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => onSelect(active + 1)}
          className="group flex-1 min-w-0 rounded-xl border bg-card p-4 text-right hover:border-brand-300 hover:shadow-sm transition-all"
        >
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground justify-end w-full">
            Suivant <ChevronRight className="h-3.5 w-3.5" />
          </span>
          <span className="mt-1 block text-sm font-medium truncate group-hover:text-brand-700">
            {next.title}
          </span>
        </button>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  )
}
