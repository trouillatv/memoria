'use client'

// ── P0-4B — rapprocher une Action à un Engagement de référence ──────────────
// « Engagement = ce qui doit être vrai. Action = quelque chose qu'il faut
// traiter. » Ce composant ne fait QUE poser/retirer ce lien déclaratif —
// jamais de conformité, d'écart, ni de mutation de l'Engagement lui-même.
// Même patron que ActionAssignmentPanel : FormData + Server Action + refresh.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import { createEngagementLinkAction, removeEngagementLinkAction, qualifyEngagementLinkAction } from '@/app/(dashboard)/actions/actions'
import { QUALIFICATION_OPTIONS, QUALIFICATION_LABEL } from '@/lib/engagements/qualification-labels'
import type { DbEngagement, EngagementLinkQualification } from '@/types/db'
import type { SiteActionEngagementLinkView } from '@/lib/db/site-action-engagement-links'

const STATUS_LABEL: Record<string, string> = {
  extracted: 'Extrait',
  curated: 'Curé',
  active: 'Actif',
  completed: 'Terminé',
  archived: 'Archivé',
}

function formatQualifiedAt(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date} à ${time}`
}

export function ActionFicheEngagementCta({
  actionId,
  siteId,
  links,
  candidates,
}: {
  actionId: string
  siteId: string
  links: SiteActionEngagementLinkView[]
  candidates: DbEngagement[]
}) {
  const router = useRouter()
  const [linking, setLinking] = useState(false)
  const [selected, setSelected] = useState('')
  const [pending, startTransition] = useTransition()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [qualifyingLinkId, setQualifyingLinkId] = useState<string | null>(null)
  const [qualificationChoice, setQualificationChoice] = useState<EngagementLinkQualification | ''>('')
  const [note, setNote] = useState('')

  const linkedIds = new Set(links.map((l) => l.engagement.id))
  const available = candidates.filter((c) => !linkedIds.has(c.id))

  function submitLink() {
    if (!selected) return
    const fd = new FormData()
    fd.set('actionId', actionId)
    fd.set('engagementId', selected)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await createEngagementLinkAction(fd)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Engagement rapproché')
      setLinking(false)
      setSelected('')
      router.refresh()
    })
  }

  function submitRemove(linkId: string) {
    setRemovingId(linkId)
    const fd = new FormData()
    fd.set('linkId', linkId)
    fd.set('actionId', actionId)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await removeEngagementLinkAction(fd)
      setRemovingId(null)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Rapprochement retiré')
      router.refresh()
    })
  }

  function startQualify(linkId: string, current: EngagementLinkQualification | '' = '') {
    setQualifyingLinkId(linkId)
    setQualificationChoice(current)
    setNote('')
  }

  function submitQualify(linkId: string) {
    if (!qualificationChoice) return
    const fd = new FormData()
    fd.set('linkId', linkId)
    fd.set('qualification', qualificationChoice)
    fd.set('note', note)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await qualifyEngagementLinkAction(fd)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Qualification enregistrée')
      setQualifyingLinkId(null)
      setQualificationChoice('')
      setNote('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      {links.length === 0 && !linking && (
        <p className="text-[13px] text-muted-foreground">Aucun engagement rapproché</p>
      )}

      {links.map(({ link, engagement, currentQualification, qualificationHistory }) => (
        <div key={link.id} className="space-y-1 rounded-md border bg-muted/30 px-2.5 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{engagement.short_label}</p>
              <p className="text-[11px] text-muted-foreground">{STATUS_LABEL[engagement.status] ?? engagement.status}</p>
            </div>
            <button
              type="button"
              onClick={() => submitRemove(link.id)}
              disabled={pending && removingId === link.id}
              className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground hover:text-red-600 disabled:opacity-50"
            >
              {pending && removingId === link.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Retirer le rapprochement
            </button>
          </div>

          {qualifyingLinkId === link.id ? (
            <div className="space-y-1.5 rounded border bg-background px-2 py-1.5">
              <select
                value={qualificationChoice}
                onChange={(e) => setQualificationChoice(e.target.value as EngagementLinkQualification)}
                disabled={pending}
                className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Choisir une qualification —</option>
                {QUALIFICATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={pending}
                maxLength={1000}
                placeholder="Note (facultatif)"
                rows={2}
                className="w-full resize-none rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => submitQualify(link.id)}
                  disabled={pending || !qualificationChoice}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {pending && <Loader2 className="h-3 w-3 animate-spin" />}Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setQualifyingLinkId(null)}
                  disabled={pending}
                  className="shrink-0 rounded-md border px-2 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {currentQualification ? (
                <>
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                    {QUALIFICATION_LABEL[currentQualification.qualification] ?? currentQualification.qualification}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Qualifié le {formatQualifiedAt(currentQualification.created_at)}
                  </span>
                  {currentQualification.note && (
                    <span className="basis-full text-[11.5px] text-muted-foreground">{currentQualification.note}</span>
                  )}
                </>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Non qualifié</span>
              )}
              <button
                type="button"
                onClick={() => startQualify(link.id, currentQualification?.qualification ?? '')}
                className="text-[11.5px] font-medium text-sky-700 hover:underline"
              >
                {currentQualification ? 'Modifier la qualification' : 'Qualifier'}
              </button>
            </div>
          )}

          {qualificationHistory.length > 1 && (
            <p className="truncate text-[10.5px] text-muted-foreground">
              Historique — {qualificationHistory
                .slice(0, -1)
                .map((ev) => `${new Date(ev.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} : ${QUALIFICATION_LABEL[ev.qualification] ?? ev.qualification}`)
                .join(' / ')}
            </p>
          )}
        </div>
      ))}

      {linking ? (
        <div className="flex items-center gap-1.5">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={pending}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Choisir un engagement —</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.short_label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={submitLink}
            disabled={pending || !selected}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}OK
          </button>
          <button
            type="button"
            onClick={() => { setLinking(false); setSelected('') }}
            disabled={pending}
            className="shrink-0 rounded-md border px-2 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        available.length > 0 && (
          <button
            type="button"
            onClick={() => setLinking(true)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />Rapprocher à un engagement
          </button>
        )
      )}
    </div>
  )
}
