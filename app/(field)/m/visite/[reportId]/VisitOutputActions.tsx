'use client'

// Sorties d'une visite (fin de visite + récap). Le terrain doit savoir OÙ
// retrouver le résultat : voir la visite, produire un CR partageable (PDF), ou
// reprendre au bureau sur ordinateur. Bloc réutilisé sur l'écran de fin et sur
// la page récap.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Eye, FileText, Monitor, Check, Copy, ArrowRight, Images, Loader2, X, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { getCrPhotoPlanAction } from './debrief-actions'

export function VisitOutputActions({
  reportId,
  siteId,
  /** Afficher le CTA « Voir la visite » (masqué quand on EST déjà sur la récap). */
  showViewVisit = true,
  /** Ouvre le tri pour ajuster les tags (dispo au débrief, pas sur la récap). */
  onModify,
}: {
  reportId: string
  siteId: string
  showViewVisit?: boolean
  onModify?: () => void
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
        <GenerateCr reportId={reportId} onModify={onModify} />
        <OpenOnDesktop siteId={siteId} reportId={reportId} />
      </div>
    </div>
  )
}

/**
 * « CR / PDF » — mais on ne génère pas à l'aveugle : MemorIA annonce d'abord
 * combien de photos entreront (les autres restent dans MemorIA), puis « Générer »
 * ou « Modifier les tags ». On ne fait pas décider l'humain photo par photo ;
 * MemorIA propose, l'humain valide. Cf. sélection par tag + photo clé.
 */
function GenerateCr({ reportId, onModify }: { reportId: string; onModify?: () => void }) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<{ included: number; total: number } | null>(null)
  const [, start] = useTransition()

  function openDialog() {
    setOpen(true)
    setPlan(null)
    start(async () => {
      const p = await getCrPhotoPlanAction(reportId)
      setPlan(p)
    })
  }

  function generate() {
    window.open(`/m/visite/${reportId}/pdf`, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium"
      >
        <FileText className="h-4 w-4" /> CR / PDF
      </button>
      {open && (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-background/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-2xl border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold"><Images className="h-4 w-4" /> Compte-rendu</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            {plan === null ? (
              <p className="inline-flex items-center gap-1.5 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Sélection des photos…</p>
            ) : (
              <p className="text-sm leading-relaxed">
                <strong>{plan.included} photo{plan.included > 1 ? 's' : ''}</strong> ser{plan.included > 1 ? 'ont' : 'a'} incluse{plan.included > 1 ? 's' : ''} dans le compte-rendu
                {plan.total > plan.included && (
                  <span className="text-muted-foreground"> — les {plan.total} restent dans MemorIA.</span>
                )}
                <span className="mt-1 block text-[12px] text-muted-foreground">
                  MemorIA retient les photos taguées Réserve / Action / À surveiller et les photos clés (⭐, dont les annotées).
                </span>
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              {onModify && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); onModify() }}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium text-muted-foreground"
                >
                  <Pencil className="h-4 w-4" /> Modifier
                </button>
              )}
              <button
                type="button"
                onClick={generate}
                disabled={plan === null}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                <FileText className="h-4 w-4" /> Générer le CR
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
