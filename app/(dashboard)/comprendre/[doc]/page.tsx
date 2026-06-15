// /comprendre/[doc] — Guides « Comprendre » en livre web premium (même moteur
// que /manuel). Vincent 2026-05-23.

import { redirect, notFound } from 'next/navigation'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { splitIntoChapters } from '@/lib/docs/book'
import { ManuelBook } from '../../manuel/ManuelBook'

export const dynamic = 'force-dynamic'

const GUIDES: Record<string, { md: string; docx: string; title: string }> = {
  'memoire-ia': {
    md: 'COMPRENDRE_MEMOIRE_IA.md',
    docx: 'comprendre-memoire-ia.docx',
    title: 'Comprendre la mémoire + l’IA',
  },
  architecture: {
    md: 'COMPRENDRE_ARCHITECTURE.md',
    docx: 'comprendre-architecture.docx',
    title: 'Comprendre l’architecture',
  },
}

export default async function ComprendrePage({ params }: { params: Promise<{ doc: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { doc } = await params
  const cfg = GUIDES[doc]
  if (!cfg) notFound()
  // « Comprendre l'archi » est technique et détaillé → réservé aux admins.
  if (doc === 'architecture' && user.role !== 'admin') notFound()

  let lastGenerated: string | null = null
  try {
    const stat = await fs.stat(join(process.cwd(), 'public', cfg.docx))
    lastGenerated = stat.mtime.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    lastGenerated = null
  }

  let mdContent = ''
  try {
    mdContent = await fs.readFile(join(process.cwd(), 'docs', cfg.md), 'utf-8')
  } catch {
    mdContent = ''
  }

  const chapters = await splitIntoChapters(mdContent)

  return (
    <div className="w-full py-2">
      <ManuelBook
        chapters={chapters}
        title={cfg.title}
        lastGenerated={lastGenerated}
        downloadHref={`/${cfg.docx}`}
      />
    </div>
  )
}
