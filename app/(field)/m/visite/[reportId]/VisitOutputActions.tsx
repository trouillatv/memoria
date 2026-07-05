'use client'

// Sorties d'une visite (fin de visite + récap). Le terrain doit savoir OÙ
// retrouver le résultat : voir la visite, produire un CR partageable (PDF), ou
// reprendre au bureau sur ordinateur. Bloc réutilisé sur l'écran de fin et sur
// la page récap.

import { useState } from 'react'
import Link from 'next/link'
import { Eye, FileText, Monitor, Check, Copy, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

export function VisitOutputActions({
  reportId,
  siteId,
  /** Afficher le CTA « Voir la visite » (masqué quand on EST déjà sur la récap). */
  showViewVisit = true,
}: {
  reportId: string
  siteId: string
  showViewVisit?: boolean
}) {
  return (
    <div className="space-y-2">
      {showViewVisit && (
        <Link
          href={`/m/visite/${reportId}/recap`}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background"
        >
          <Eye className="h-4 w-4" /> Voir la visite <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/m/visite/${reportId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium"
        >
          <FileText className="h-4 w-4" /> CR / PDF
        </a>
        <OpenOnDesktop siteId={siteId} reportId={reportId} />
      </div>
    </div>
  )
}

/**
 * « Ouvrir sur ordinateur » — le Débrief complet vit au bureau (rôle desktop).
 * Sur mobile on ne redirige pas (le terrain serait rejeté vers /m) : on donne le
 * lien absolu à copier / envoyer, pour reprendre depuis un ordinateur.
 */
function OpenOnDesktop({ siteId, reportId }: { siteId: string; reportId: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const path = `/sites/${siteId}/visites/${reportId}`

  function absoluteUrl(): string {
    if (typeof window === 'undefined') return path
    return `${window.location.origin}${path}`
  }

  function copy() {
    const url = absoluteUrl()
    navigator.clipboard.writeText(url).then(
      () => { setCopied(true); toast.success('Lien copié', { duration: 1500 }); setTimeout(() => setCopied(false), 2000) },
      () => toast.error('Copie impossible'),
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium"
      >
        <Monitor className="h-4 w-4" /> Sur ordinateur
      </button>
      {open && (
        <div className="col-span-2 space-y-2 rounded-xl border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Le débrief complet se fait au bureau. Copiez le lien et ouvrez-le sur votre ordinateur.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {path}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
