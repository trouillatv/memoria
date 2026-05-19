import Link from 'next/link'
import { analysisStatusLabel } from '@/lib/documents/labels'
import type { DbDocument } from '@/types/db'

// Composant PRÉSENTATIONNEL partagé (site, contrat, …) — consommateur mince
// du système documentaire. Aucune IA, aucun recall, aucune donnée fetchée
// ici : l'appelant fournit des documents DÉJÀ filtrés par visibility_level
// (canViewDocument). Le chrome (titre, compteur, lien « Ajouter », état
// vide) reste géré par chaque page selon son idiome.

export function LinkedDocumentsList({ documents }: { documents: DbDocument[] }) {
  return (
    <ul className="divide-y">
      {documents.map((d) => (
        <li
          key={d.id}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span className="min-w-0">
            <Link
              href={`/documents/${d.id}`}
              className="font-medium underline hover:text-foreground break-words"
            >
              {d.filename}
            </Link>
            <span className="text-xs text-muted-foreground">
              {' '}· {d.document_type}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {analysisStatusLabel(d.analysis_status)}
          </span>
        </li>
      ))}
    </ul>
  )
}
