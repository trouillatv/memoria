import type { ReactNode } from 'react'
import type { Clock } from 'lucide-react'
import Link from 'next/link'

// Petits blocs visuels partagés par les sous-vues Planning (Vue d'ensemble,
// Travaux, Agenda, Échéances) — évite de dupliquer le même titre de section
// et le même état vide dans chaque fichier.

export function SectionTitle({ icon: Icon, title, detail }: { icon: typeof Clock; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">{children}</p>
}

/**
 * Preuve textuelle > lien source (doctrine V1-D.3). L'extrait exact du
 * document est la preuve de premier niveau ; le document complet (nom en
 * petit, cliquable) reste une provenance secondaire — jamais un CTA « Voir
 * la source » mis en avant. N'invente jamais de texte : si `excerpt` est
 * absent, seul le nom de fichier est affiché.
 */
export function SourceExcerpt({ documentId, filename, excerpt }: { documentId: string; filename: string; excerpt: string | null }) {
  return (
    <div className="text-[12px]">
      {excerpt && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Extrait source</p>
          <p className="italic text-muted-foreground">« {excerpt} »</p>
        </>
      )}
      <Link href={`/documents/${documentId}`} className="text-[11px] text-muted-foreground/70 underline decoration-dotted underline-offset-2 hover:text-foreground">
        {filename}
      </Link>
    </div>
  )
}
