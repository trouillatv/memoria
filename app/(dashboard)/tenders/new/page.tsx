import { TenderUploadForm } from './TenderUploadForm'

export default function NewTenderPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Analyser un nouvel AO</h1>
        <p className="text-sm text-muted-foreground">
          Upload le PDF du cahier des charges. L&apos;IA extrait contraintes, risques, checklist et génère une mémoire technique grounded sur la bibliothèque.
        </p>
      </div>
      <TenderUploadForm />
    </div>
  )
}
