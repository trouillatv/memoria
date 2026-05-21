// /manuel — Mode d'emploi téléchargeable pour Guillaume (et tout manager).
//
// Vincent 2026-05-22. Sert public/manuel.docx (régénéré via `npm run docs:emploi`
// à chaque MAJ de docs/MODE_EMPLOI.md) + offre un rendu lisible côté web.
//
// Doctrine : le manuel n'est pas une feature secondaire — c'est ce qui permet
// à Guillaume de se débrouiller seul. Accessible directement depuis le compte
// utilisateur + lien dans la nav.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  Download,
  BookOpen,
  ExternalLink,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'

export const dynamic = 'force-dynamic'

export default async function ManuelPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Chef d'équipe redirigé vers /m (le manuel est destiné aux managers)
  if (user.role === 'chef_equipe') redirect('/m')

  // Date de dernière régénération
  let lastGenerated: string | null = null
  try {
    const stat = await fs.stat(join(process.cwd(), 'public', 'manuel.docx'))
    lastGenerated = stat.mtime.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    lastGenerated = null
  }

  // Charger les sections du markdown pour rendu web minimal
  let mdContent = ''
  try {
    mdContent = await fs.readFile(
      join(process.cwd(), 'docs', 'MODE_EMPLOI.md'),
      'utf-8',
    )
  } catch {
    mdContent = ''
  }

  // Extraire sommaire (lignes de la section Sommaire)
  const tocMatch = mdContent.match(/## Sommaire\n\n([\s\S]*?)\n---/)
  const tocLines = tocMatch
    ? tocMatch[1]
        .split('\n')
        .filter((l) => l.trim().match(/^\d+\./))
        .map((l) => l.trim())
    : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-brand-600" />
          Manuel d&apos;utilisation MemorIA
        </h1>
        <p className="text-sm text-muted-foreground">
          Le mode d&apos;emploi complet de l&apos;application pour managers et admin.
          {lastGenerated && (
            <> Dernière mise à jour : <span className="font-medium">{lastGenerated}</span>.</>
          )}
        </p>
      </header>

      {/* Bouton télécharger Word */}
      <div className="rounded-lg border-2 border-brand-200 bg-brand-50/30 dark:bg-brand-950/20 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold mb-1">Télécharger le manuel (Word)</h2>
            <p className="text-sm text-muted-foreground">
              Format .docx (~55 Ko). Lisible hors-ligne, partageable par email
              ou imprimable. La version Web ci-dessous est synchronisée.
            </p>
          </div>
          <a
            href="/manuel.docx"
            download="MemorIA-MODE-EMPLOI.docx"
            className="shrink-0 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            Télécharger (.docx)
          </a>
        </div>
      </div>

      {/* Sommaire */}
      {tocLines.length > 0 && (
        <section className="rounded-lg border bg-card p-5 space-y-3">
          <h2 className="text-base font-medium">Sommaire</h2>
          <ol className="space-y-1 text-sm">
            {tocLines.map((line, i) => {
              // Extraire le numéro et le label
              const m = line.match(/^(\d+)\.\s+\[(.+?)\]\((#[^)]+)\)/)
              if (!m) return <li key={i} className="text-muted-foreground">{line}</li>
              const [, num, label, anchor] = m
              return (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="text-muted-foreground tabular-nums shrink-0 w-6 text-right">
                    {num}.
                  </span>
                  <span>{label.replace(/\*\*/g, '')}</span>
                </li>
              )
            })}
          </ol>
          <p className="text-[11px] text-muted-foreground italic">
            Pour consulter chaque section en détail, télécharge le .docx
            ci-dessus — il contient les 21 sections complètes (~830 lignes).
          </p>
        </section>
      )}

      {/* Liens contextuels */}
      <section className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-base font-medium">À consulter aussi</h2>
        <ul className="space-y-2 text-sm">
          <li>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Tableau de bord — point d&apos;entrée quotidien
            </Link>
          </li>
          <li>
            <Link
              href="/handovers"
              className="inline-flex items-center gap-1.5 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Passages de témoin — section 15 du manuel
            </Link>
          </li>
          <li>
            <Link
              href="/equipes"
              className="inline-flex items-center gap-1.5 hover:text-brand-700 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Équipes (fiche enrichie) — section 9 du manuel
            </Link>
          </li>
        </ul>
      </section>

      {/* Doctrine */}
      <section className="rounded-lg border border-amber-300 bg-amber-50/40 dark:bg-amber-950/20 p-5 space-y-2">
        <h2 className="text-base font-medium text-amber-900 dark:text-amber-200">
          Doctrine de mise à jour
        </h2>
        <p className="text-sm">
          Chaque nouvelle fonctionnalité user-facing doit être ajoutée au manuel
          <strong> dans le même commit</strong> qui la livre. Le fichier .docx est
          régénéré via <code className="text-xs px-1 py-0.5 rounded bg-background border">npm run docs:emploi</code>.
        </p>
      </section>
    </div>
  )
}
