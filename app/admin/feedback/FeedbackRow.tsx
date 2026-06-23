'use client'

// Ligne feedback — affichage + boutons changement de statut.
// Vincent 2026-05-21 : admin marque ✓ Traité / Spam / Rouvrir.
//
// L'update du statut passe par le client Supabase (RLS admin déjà en place
// via migration 075). Refresh server après mutation.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, RotateCcw, Smartphone, Monitor, Building2, Reply, Send } from 'lucide-react'
import { toast } from 'sonner'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { FeedbackStatus } from './page'
import { replyToFeedbackAction } from './actions'

interface Entry {
  id: string
  user_id: string
  message: string
  page: string | null
  user_agent: string | null
  status: FeedbackStatus
  created_at: string
  author_label: string
  author_role: string
  attachment_paths: string[]
  attachment_urls: string[]
  author_org: string | null
  admin_reply: string | null
  admin_reply_at: string | null
}

function formatDateFr(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isMobileUA(ua: string | null): boolean {
  if (!ua) return false
  return /Mobi|Android|iPhone|iPad/i.test(ua)
}

function roleLabelFr(role: string): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'manager':
      return 'Manager'
    case 'chef_equipe':
      return "Chef d'équipe"
    default:
      return role
  }
}

function statusBadge(status: FeedbackStatus) {
  switch (status) {
    case 'open':
      return { label: 'À traiter', className: 'bg-amber-50 text-amber-900 border-amber-200' }
    case 'done':
      return { label: 'Traité', className: 'bg-emerald-50 text-emerald-900 border-emerald-200' }
    case 'spam':
      return { label: 'Spam', className: 'bg-slate-100 text-slate-700 border-slate-300' }
  }
}

export function FeedbackRow({ entry }: { entry: Entry }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const supabase = createBrowserClient()
  const [composing, setComposing] = useState(false)
  const [reply, setReply] = useState(entry.admin_reply ?? '')

  function sendReply() {
    const text = reply.trim()
    if (!text) return
    startTransition(async () => {
      const res = await replyToFeedbackAction({ feedbackId: entry.id, reply: text })
      if (!res.ok) {
        toast.error(res.error ?? 'Erreur lors de l’envoi de la réponse.')
        return
      }
      toast.success('Réponse envoyée à l’auteur')
      setComposing(false)
      router.refresh()
    })
  }

  function updateStatus(newStatus: FeedbackStatus) {
    startTransition(async () => {
      const { error } = await supabase
        .from('feedback')
        .update({ status: newStatus })
        .eq('id', entry.id)
      if (error) {
        toast.error('Erreur mise à jour du statut.')
        return
      }
      const label =
        newStatus === 'done'
          ? 'Marqué comme traité'
          : newStatus === 'spam'
            ? 'Marqué comme spam'
            : 'Rouvert'
      toast.success(label)
      router.refresh()
    })
  }

  const badge = statusBadge(entry.status)
  const isMobile = isMobileUA(entry.user_agent)

  return (
    <article className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${badge.className}`}>
            {badge.label}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDateFr(entry.created_at)}
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs font-medium">{entry.author_label}</span>
          <Badge variant="outline" className="text-[10px]">
            {roleLabelFr(entry.author_role)}
          </Badge>
          {entry.author_org && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {entry.author_org}
              </span>
            </>
          )}
          {entry.page && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <code className="text-[11px] font-mono text-muted-foreground">{entry.page}</code>
            </>
          )}
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            {isMobile ? (
              <>
                <Smartphone className="h-3 w-3" />
                Mobile
              </>
            ) : (
              <>
                <Monitor className="h-3 w-3" />
                Desktop
              </>
            )}
          </span>
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
        {entry.message}
      </p>

      {/* Pièces jointes (captures d'écran / photos) */}
      {entry.attachment_urls.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {entry.attachment_urls.map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="Voir en taille réelle"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Capture ${i + 1}`}
                className="w-20 h-20 object-cover rounded border border-border hover:opacity-80 transition-opacity"
              />
            </a>
          ))}
        </div>
      )}

      {/* Réponse de l'équipe (visible par l'auteur dans son bouton feedback) */}
      {entry.admin_reply && !composing && (
        <div className="rounded-md border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900/40 dark:bg-brand-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            Réponse envoyée à l&apos;auteur
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap break-words leading-relaxed">{entry.admin_reply}</p>
          {entry.admin_reply_at && (
            <p className="mt-1 text-[11px] text-muted-foreground">{formatDateFr(entry.admin_reply_at)}</p>
          )}
        </div>
      )}

      {composing && (
        <div className="space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, 4000))}
            rows={3}
            disabled={pending}
            autoFocus
            placeholder="Votre réponse — elle apparaîtra à l'auteur dans son bouton feedback…"
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={sendReply} disabled={pending || !reply.trim()}>
              <Send className="mr-1 h-3.5 w-3.5" />
              Envoyer la réponse
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setComposing(false); setReply(entry.admin_reply ?? '') }}
              disabled={pending}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {!composing && (
          <Button size="sm" variant="outline" onClick={() => setComposing(true)} disabled={pending}>
            <Reply className="mr-1 h-3.5 w-3.5" />
            {entry.admin_reply ? 'Modifier la réponse' : 'Répondre'}
          </Button>
        )}
        {entry.status === 'open' && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatus('done')}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Traité
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatus('spam')}
              disabled={pending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Spam
            </Button>
          </>
        )}
        {entry.status !== 'open' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateStatus('open')}
            disabled={pending}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Rouvrir
          </Button>
        )}
      </div>
    </article>
  )
}
