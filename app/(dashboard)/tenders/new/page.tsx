import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { listKnowledgeItems } from '@/lib/db/knowledge'
import { TenderUploadForm } from './TenderUploadForm'

export default async function NewTenderPage() {
  const items = await listKnowledgeItems({})

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Analyser un nouvel AO</h1>
        <p className="text-sm text-muted-foreground">
          Upload le PDF du cahier des charges. L&apos;IA extrait contraintes, risques, checklist et génère une mémoire technique grounded sur la bibliothèque.
        </p>
      </div>

      {items.length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-900">Bibliothèque vide</p>
              <p className="text-sm text-amber-800">
                L&apos;analyse IA s&apos;appuiera sur un contenu générique. Pour des résultats spécifiques à votre entreprise,
                ajoutez d&apos;abord des éléments dans la <Link href="/library" className="underline font-medium">Bibliothèque AGP</Link>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <TenderUploadForm />
    </div>
  )
}
