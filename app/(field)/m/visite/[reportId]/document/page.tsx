import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getVisit } from '@/lib/db/visits'

export const dynamic = 'force-dynamic'

/**
 * Visionneuse PDF IN-APP du compte-rendu. On n'ouvre plus le PDF « nu » dans le
 * lecteur système (où le bouton d'enregistrement est introuvable) : on l'affiche
 * dans un cadre qui NOUS appartient, avec une barre en haut — retour à gauche,
 * « Enregistrer » à droite, toujours accessible. Le PDF s'affiche dans un iframe ;
 * si l'appareil ne sait pas le rendre en ligne, le bouton « Enregistrer » et le
 * lien « plein écran » fonctionnent quand même (rien n'est perdu).
 */
export default async function VisitPdfViewerPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const pdfHref = `/m/visite/${reportId}/pdf`
  const downloadHref = `${pdfHref}?download=1`

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-muted">
      {/* Barre : retour · titre · Enregistrer (le bouton demandé, en haut à droite). */}
      <header className="flex items-center gap-2 border-b bg-background px-3 py-2.5 safe-top">
        <Link
          href={`/m/visite/${reportId}/cr`}
          aria-label="Retour à l’aperçu"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Compte-rendu de visite</span>
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background active:brightness-95"
        >
          <Download className="h-4 w-4" /> Enregistrer
        </a>
      </header>

      {/* Le PDF en grand. L'iframe rend le PDF via la visionneuse de l'appareil ;
          le fallback dessous reste visible si le rendu inline échoue. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-muted-foreground">
            Si le compte-rendu ne s’affiche pas ici,{' '}
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="pointer-events-auto font-medium text-foreground underline underline-offset-2">
              ouvrez-le en plein écran
            </a>{' '}
            ou appuyez sur <span className="font-medium text-foreground">Enregistrer</span>.
          </p>
        </div>
        <iframe
          src={pdfHref}
          title="Compte-rendu de visite (PDF)"
          className="relative h-full w-full border-0 bg-transparent"
        />
      </div>
    </div>
  )
}
