'use client'

// Liste d'actions ouvertes (site_actions) — réutilisée sur la fiche site,
// le mobile site, le briefing, /actions et /m/actions.
// Clôture AVEC trace : commentaire (requis) + photo optionnelle → journal du site.
// Pas de planification ici (geste séparé).

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, MapPin, Mic, HardHat, User, Loader2, Clock, Camera, X } from 'lucide-react'
import { toast } from 'sonner'
import { closeActionAction } from '@/app/(dashboard)/actions/actions'
import { actionHealth } from '@/lib/actions/health'
import type { SiteActionRow } from '@/lib/db/site-actions'

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}
function ageLabel(iso: string): string {
  const d = ageDays(iso)
  if (d === 0) return "aujourd'hui"
  if (d === 1) return 'depuis 1 jour'
  return `depuis ${d} jours`
}

export function OpenActionsList({
  actions,
  showSite = false,
  compact = false,
}: {
  actions: SiteActionRow[]
  showSite?: boolean
  compact?: boolean
}) {
  const router = useRouter()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [closingId, setClosingId] = useState<string | null>(null)

  const visible = actions.filter((a) => !closed.has(a.id))
  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground italic px-1 py-2">Aucune action ouverte.</p>
  }

  return (
    <ul className="space-y-2">
      {visible.map((a) => {
        const health = actionHealth(a.created_at)
        const borderCls =
          health === 'critique' ? 'border-red-300' : health === 'surveiller' ? 'border-amber-200' : 'border-border'
        const ageCls =
          health === 'critique' ? 'text-red-700 font-medium' : health === 'surveiller' ? 'text-amber-700 font-medium' : ''
        const isClosing = closingId === a.id
        return (
          <li
            key={a.id}
            className={`rounded-lg border bg-card ${compact ? 'p-2.5' : 'p-3'} ${borderCls}`}
          >
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => setClosingId(isClosing ? null : a.id)}
                aria-label="Clôturer l'action"
                aria-expanded={isClosing}
                className={`mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors active:scale-95 ${
                  isClosing ? 'border-emerald-500 bg-emerald-50' : 'border-foreground/30 hover:border-emerald-500 hover:bg-emerald-50'
                }`}
              >
                <Check className={`h-3.5 w-3.5 ${isClosing ? 'text-emerald-600' : 'text-transparent hover:text-emerald-600'}`} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug">{a.title}</div>

                <div className="mt-1 flex items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground flex-wrap">
                  {a.corps_etat && (
                    <span className="inline-flex items-center gap-1 text-foreground/70">
                      <HardHat className="h-3 w-3" />{a.corps_etat}
                    </span>
                  )}
                  {showSite && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{a.site_name}
                      {a.contract_name ? <span className="text-muted-foreground/60"> · {a.contract_name}</span> : null}
                    </span>
                  )}
                  {a.assigned_to && (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />{a.assigned_to}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 ${ageCls}`}>
                    <Clock className="h-3 w-3" />Ouvert {ageLabel(a.created_at)}
                  </span>
                </div>

                {/* Formulaire de clôture (commentaire requis + photo optionnelle) */}
                {isClosing ? (
                  <CloseForm
                    action={a}
                    onCancel={() => setClosingId(null)}
                    onClosed={() => {
                      setClosed((prev) => new Set(prev).add(a.id))
                      setClosingId(null)
                      router.refresh()
                    }}
                  />
                ) : (
                  <div className={`mt-1.5 items-center gap-3 text-[11px] ${compact ? 'hidden' : 'flex'}`}>
                    <Link href={`/sites/${a.site_id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <MapPin className="h-3 w-3" />Voir le site
                    </Link>
                    {a.report_id && (
                      <Link href={`/meetings/${a.report_id}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                        <Mic className="h-3 w-3" />Réunion source
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function CloseForm({
  action,
  onCancel,
  onClosed,
}: {
  action: SiteActionRow
  onCancel: () => void
  onClosed: () => void
}) {
  const [comment, setComment] = useState('')
  const [photoName, setPhotoName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!comment.trim()) {
      toast.error('Ajoutez un commentaire de clôture.')
      return
    }
    const fd = new FormData()
    fd.set('id', action.id)
    fd.set('site_id', action.site_id)
    fd.set('comment', comment.trim())
    const f = fileRef.current?.files?.[0]
    if (f) fd.set('file', f)
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success('Action clôturée')
        onClosed()
      }
    })
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <p className="text-[11px] font-medium text-foreground/80">Clôturer l&apos;action</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        autoFocus
        maxLength={1000}
        placeholder="Ex : SudÉlec relancé, intervention prévue jeudi matin."
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
          <Camera className="h-3.5 w-3.5" />
          {photoName ? 'Photo ajoutée' : 'Photo (optionnel)'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancel} disabled={pending} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !comment.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border-2 border-emerald-600 bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98]"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Clôturer
          </button>
        </div>
      </div>
    </div>
  )
}
