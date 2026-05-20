// /admin/feedback — Liste des feedbacks utilisateurs.
//
// Vincent 2026-05-21 : la table `feedback` (migration 075) reçoit les
// messages via le bouton flottant. Cette page les affiche par statut
// (À traiter / Traité / Spam / Tous). Admin uniquement (cf. RLS).
//
// Pas de pagination pour le pilote (cap 500). On suppose qu'on ne dépassera
// pas ce volume rapidement. Si on dépasse, on ajoute la pagination.

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { FeedbackRow } from './FeedbackRow'

export const dynamic = 'force-dynamic'

type FeedbackStatus = 'open' | 'done' | 'spam'
const VALID_STATUSES: FeedbackStatus[] = ['open', 'done', 'spam']

interface FeedbackEntry {
  id: string
  user_id: string
  message: string
  page: string | null
  user_agent: string | null
  status: FeedbackStatus
  created_at: string
  /** Nom complet ou email de l'auteur (chargé via join). */
  author_label: string
  author_role: string
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: rawStatus } = await searchParams
  const filter: FeedbackStatus | 'all' =
    rawStatus === 'open' || rawStatus === 'done' || rawStatus === 'spam'
      ? rawStatus
      : 'open'

  const admin = createAdminClient()

  // Compteurs par statut (en parallèle pour les onglets)
  const [openRes, doneRes, spamRes, listRes] = await Promise.all([
    admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'done'),
    admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'spam'),
    (filter === 'all'
      ? admin
          .from('feedback')
          .select('id, user_id, message, page, user_agent, status, created_at, author:users(full_name, email, role)')
      : admin
          .from('feedback')
          .select('id, user_id, message, page, user_agent, status, created_at, author:users(full_name, email, role)')
          .eq('status', filter)
    )
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  const counts = {
    open: openRes.count ?? 0,
    done: doneRes.count ?? 0,
    spam: spamRes.count ?? 0,
    all: (openRes.count ?? 0) + (doneRes.count ?? 0) + (spamRes.count ?? 0),
  }

  type Row = {
    id: string
    user_id: string
    message: string
    page: string | null
    user_agent: string | null
    status: FeedbackStatus
    created_at: string
    author: { full_name: string | null; email: string; role: string } | Array<{ full_name: string | null; email: string; role: string }> | null
  }
  const pickOne = <T,>(v: T | T[] | null | undefined): T | null => {
    if (v === null || v === undefined) return null
    return Array.isArray(v) ? (v[0] as T) ?? null : v
  }

  const entries: FeedbackEntry[] = ((listRes.data ?? []) as Row[]).map((r) => {
    const author = pickOne(r.author) as { full_name: string | null; email: string; role: string } | null
    return {
      id: r.id,
      user_id: r.user_id,
      message: r.message,
      page: r.page,
      user_agent: r.user_agent,
      status: r.status,
      created_at: r.created_at,
      author_label: author?.full_name ?? author?.email ?? 'Utilisateur inconnu',
      author_role: author?.role ?? '—',
    }
  })

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-brand-600" />
          Feedback ({counts.all})
        </h1>
        <p className="text-sm text-muted-foreground">
          Retours envoyés via le bouton flottant. Traite, marque comme spam ou rouvre.
        </p>
      </header>

      {/* Onglets de filtre */}
      <nav className="flex items-center gap-2 border-b">
        <TabLink href="/admin/feedback?status=open" active={filter === 'open'} label="À traiter" count={counts.open} />
        <TabLink href="/admin/feedback?status=done" active={filter === 'done'} label="Traité" count={counts.done} />
        <TabLink href="/admin/feedback?status=spam" active={filter === 'spam'} label="Spam" count={counts.spam} />
      </nav>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground italic">
          {filter === 'open' ? 'Aucun feedback à traiter pour le moment.' : `Aucun feedback ${filter === 'done' ? 'traité' : 'marqué spam'}.`}
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <FeedbackRow entry={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TabLink({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-brand-600 text-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}{' '}
      <span className="ml-1 text-xs tabular-nums text-muted-foreground">
        ({count})
      </span>
    </Link>
  )
}

// Re-export status type for child component
export type { FeedbackStatus }
