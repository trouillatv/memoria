import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { listKnowledgeItems } from '@/lib/db/knowledge'
import { TenderUploadForm } from './TenderUploadForm'
import { getOrgsForSelector } from '@/components/ui/org-selector'

export default async function NewTenderPage({ searchParams }: { searchParams: Promise<{ dossier_id?: string }> }) {
  await requireDeskUser()
  const [items, orgs] = await Promise.all([listKnowledgeItems({}), getOrgsForSelector()])
  const { dossier_id: dossierId } = await searchParams

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Analyser un nouveau dossier</h1>
        <p className="text-sm text-muted-foreground">
          Upload le PDF du cahier des charges. L&apos;IA extrait contraintes, risques, checklist et génère une mémoire technique grounded sur la bibliothèque.
        </p>
      </div>

      {items.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <p>
            <span className="font-medium text-amber-900">Bibliothèque vide :</span>{' '}
            l&apos;analyse s&apos;appuiera sur un contenu générique. Pour des résultats propres à votre entreprise,
            ajoutez des éléments dans la <Link href="/library" className="underline font-medium">Bibliothèque</Link>.
          </p>
        </div>
      )}

      <TenderUploadForm dossierId={dossierId} orgs={orgs} />
    </div>
  )
}
