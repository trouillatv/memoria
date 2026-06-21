'use client'

// Couche « Nouveau depuis hier » (Vincent) — pas une page, pas un module : une
// couche en haut du dashboard. « Tiens, il s'est passé quelque chose. » Un seul
// bouton : Tout marquer comme vu. Pas d'usine à gaz.
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Camera, Inbox, Check, Loader2 } from 'lucide-react'
import { markInboxSeenAction } from './inbox-actions'
import type { InboxFeed } from '@/lib/db/inbox-feed'

function timeAgo(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `il y a ${Math.max(1, m)} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  return `il y a ${d} j`
}

export function DashboardInbox({ feed }: { feed: InboxFeed }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (feed.items.length === 0) return null

  function markSeen() {
    start(async () => { await markInboxSeenAction(); router.refresh() })
  }

  const summary: string[] = []
  if (feed.doneCount) summary.push(`${feed.doneCount} fait${feed.doneCount > 1 ? 's' : ''}`)
  if (feed.blockedCount) summary.push(`${feed.blockedCount} blocage${feed.blockedCount > 1 ? 's' : ''}`)
  if (feed.photoCount) summary.push(`${feed.photoCount} photo${feed.photoCount > 1 ? 's' : ''}`)

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Inbox className="h-4 w-4 text-sky-600" /> Nouveau depuis votre dernier passage
          {summary.length > 0 && <span className="text-xs font-normal text-muted-foreground">· {summary.join(' · ')}</span>}
        </h2>
        <button type="button" onClick={markSeen} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Tout marquer comme vu
        </button>
      </div>

      <ul className="space-y-1.5">
        {feed.items.map((it) => {
          const Icon = it.status === 'blocked' ? AlertTriangle : CheckCircle2
          const tone = it.status === 'blocked' ? 'text-rose-600' : 'text-emerald-600'
          return (
            <li key={`${it.actionId}-${it.declaredAt}`}>
              <Link href={`/sites/${it.siteId}`} className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 hover:border-foreground/30 transition-colors">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{it.company}</span>
                    {it.status === 'blocked' ? ' signale un blocage : ' : ' a déclaré : '}
                    <span className="font-medium">{it.actionTitle}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {it.site} · {timeAgo(it.declaredAt)}
                    {it.hasPhoto && <span className="inline-flex items-center gap-0.5 ml-1 text-sky-700"><Camera className="h-3 w-3" /> photo</span>}
                  </p>
                  {it.status === 'blocked' && it.comment && (
                    <p className="text-[12px] text-rose-700/90 mt-0.5 italic">« {it.comment} »</p>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
