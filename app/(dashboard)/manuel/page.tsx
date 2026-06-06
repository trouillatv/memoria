// /manuel — Manuel d'utilisation MemorIA en livre web premium.
// Vincent 2026-05-23. Le moteur de découpe/rendu est partagé (lib/docs/book).

import { redirect } from 'next/navigation'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { splitIntoChapters } from '@/lib/docs/book'
import { ManuelBook } from './ManuelBook'

export const dynamic = 'force-dynamic'

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

  const chapters = await splitIntoChapters(mdContent)

  return (
    <div className="w-full py-2">
      <ManuelBook
        chapters={chapters}
        title="Manuel MemorIA"
        lastGenerated={lastGenerated}
        downloadHref="/manuel.docx"
      />
    </div>
  )
}
