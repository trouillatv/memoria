import { documentHref } from '@/lib/knowledge/document-href'
import Link from 'next/link'
import { analysisStatusLabel } from '@/lib/documents/labels'
import type { DbDocument } from '@/types/db'

// Composant PRÉSENTATIONNEL partagé (site, contrat, …) — consommateur mince
// du système documentaire. Aucune IA, aucun recall, aucune donnée fetchée
// ici : l'appelant fournit des documents DÉJÀ filtrés par visibility_level
// (canViewDocument). Le chrome (titre, compteur, lien « Ajouter », état
// vide) reste géré par chaque page selon son idiome.

export function LinkedDocumentsList({
  documents,
  siteId,
}: {
  documents: DbDocument[]
  /** Chantier de rattachement, quand l'appelant le connaît (page site, …).
   *  Fourni : la liste ouvre l'objet du graphe `/sites/<siteId>/document/<id>`.
   *  Absent (contrat, …) : on garde la visionneuse `/documents/<id>`, qui reste
   *  de toute façon la sortie nommée depuis la fiche. */
  siteId?: string
}) {
  const linkClass = 'font-medium underline hover:text-foreground break-words'
  return (
    <ul className="divide-y">
      {documents.map((d) => (
        <li
          key={d.id}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span className="min-w-0">
            {/* Chantier connu → la liste ouvre l'objet du graphe (panneau, d'où
                scroll={false}). Sinon on garde la visionneuse globale. */}
            {siteId ? (
              <Link
                href={documentHref(d, siteId)}
                scroll={false}
                className={linkClass}
              >
                {d.filename}
              </Link>
            ) : (
              <Link
                href={`/documents/${d.id}`}
                className={linkClass}
              >
                {d.filename}
              </Link>
            )}
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
