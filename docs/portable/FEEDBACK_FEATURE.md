# Feedback in-app — package portable (prêt à coller)

Une bulle de feedback flottante côté utilisateur + une boîte d'admin pour traiter
les retours. **Auto-suffisant** : pas de dépendance à une lib de Dialog/Toast ni à
une charte de couleurs maison. Stack visée : **Next.js App Router + Supabase**.

> Si ton autre projet n'utilise **pas** Supabase, saute à la section 9 : seules
> les 2 routes API (persistance) et la garde admin changent ; les composants UI
> restent identiques.

Dépendances minimales : `react`, `lucide-react`, Tailwind. (Toast optionnel.)

---

## 1. Vue d'ensemble

```
 CÔTÉ UTILISATEUR (toutes pages connectées)        CÔTÉ ADMIN
 ┌───────────────────────────┐                    ┌──────────────────────────┐
 │  ...page...               │                    │  /admin/feedback         │
 │                           │                    │  ┌─ À traiter | Traité | Spam
 │              ╭─ panneau ─╮│   POST              │  │ ┌──────────────────────┐ │
 │              │ 💬+ Retour ││  /api/feedback     │  │ │ [À traiter] 12 mars  │ │
 │              │ [textarea]│├──────────────►  ┌───┤  │ │ "le bouton X ..."    │ │
 │              │  [Envoyer]││   (auth +      │ DB│  │ │ ✓Traité  🗑Spam       │ │
 │              ╰───────────╯│    rate-limit) │   │  │ └──────────────────────┘ │
 │                      (💬) │◄───────────────┘fb │  GET/PATCH/DELETE            │
 └───────────────────────────┘   table feedback   │  /api/admin/feedback        │
        bulle jaune fixe                           └──────────────────────────┘
```

- **Bulle flottante** (bottom-right, desktop) → ouvre un **panneau** avec un textarea.
- Envoi → `POST /api/feedback` (utilisateur authentifié, rate-limit 10/min).
- **Admin** : page `/admin/feedback` qui liste par statut (`open` / `done` / `spam`)
  et change le statut / supprime via `/api/admin/feedback`.
- **1 seule table** : `feedback`.

---

## 2. Les icônes

| Emplacement | Icône |
| --- | --- |
| Bulle flottante | **emoji `💬`** dans un cercle **`bg-yellow-400`** |
| En-tête du panneau | lucide **`MessageSquarePlus`** |
| Entrée de menu admin (lien texte) | **`💬 Feedback`** |
| Carte dashboard | lucide **`MessageSquare`** |
| Actions de ligne (admin) | `Check` (traité) · `Trash2` (spam/suppr) · `RotateCcw` (rouvrir) |

Import : `import { MessageSquarePlus, MessageSquare, Check, Trash2, RotateCcw } from 'lucide-react'`

---

## 3. Table SQL `feedback` (RLS service_role only)

Tout l'accès passe par les routes API (service role). RLS activée **sans aucune
policy** → anon/authenticated n'ont **aucun** accès direct ; seul le service role
(les routes API) lit/écrit.

```sql
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  message     text not null check (length(trim(message)) > 0 and length(message) <= 2000),
  page        text,
  user_agent  text,
  status      text not null default 'open' check (status in ('open','done','spam')),
  created_at  timestamptz not null default now()
);

create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);
create index if not exists feedback_user_idx           on public.feedback (user_id);

-- RLS activée, AUCUNE policy : seul le service_role (routes API) accède.
alter table public.feedback enable row level security;

comment on table public.feedback is
  'Feedback in-app. Accès uniquement via service_role (routes API). RLS sans policy = deny par défaut.';
```

> Si tu préfères que le client insère directement (sans passer par l'API), ajoute :
> `create policy "self insert" on public.feedback for insert with check (auth.uid() = user_id);`

---

## 4. Composant `FloatingFeedback.tsx`

Auto-suffisant (aucune dépendance Dialog/Button/Toast). Tailwind standard
(`yellow-400`, `neutral-*`). À monter **une fois** dans le layout des pages
connectées.

```tsx
'use client'

import { useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X } from 'lucide-react'

const MAX = 2000

export function FloatingFeedback() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    const trimmed = message.trim()
    if (!trimmed) return
    setNote(null)
    start(async () => {
      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, page: pathname }),
        })
        const data = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null
        if (!data?.ok) {
          const map: Record<string, string> = {
            rate_limited: 'Trop de retours envoyés. Réessaie dans un moment.',
            unauthenticated: 'Session expirée. Reconnecte-toi.',
            message_too_long: `Message trop long (max ${MAX}).`,
            empty_message: 'Le message est vide.',
          }
          setNote({ ok: false, text: map[data?.reason ?? ''] ?? 'Erreur lors de l’envoi.' })
          return
        }
        setNote({ ok: true, text: 'Merci — retour bien reçu.' })
        setMessage('')
        setTimeout(() => { setOpen(false); setNote(null) }, 1200)
      } catch {
        setNote({ ok: false, text: 'Erreur réseau. Réessaie.' })
      }
    })
  }

  return (
    <>
      {/* Bulle flottante — 💬 dans un cercle jaune */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Envoyer un retour"
        title="Envoyer un retour"
        className="hidden md:flex fixed bottom-6 right-6 z-40 h-12 w-12 items-center justify-center rounded-full bg-yellow-400 text-xl shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500"
      >
        <span aria-hidden>💬</span>
      </button>

      {/* Panneau */}
      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-[340px] max-w-[calc(100vw-3rem)] rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              <MessageSquarePlus className="h-4 w-4 text-yellow-500" />
              Envoyer un retour
            </h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2 p-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
              placeholder="Un bug, une suggestion, une frustration ? On lit tout."
              rows={5}
              disabled={pending}
              autoFocus
              className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-yellow-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span className="truncate font-mono">{pathname}</span>
              <span className="tabular-nums">{message.length} / {MAX}</span>
            </div>
            {note && (
              <p className={`text-xs ${note.ok ? 'text-emerald-600' : 'text-red-600'}`}>{note.text}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Annuler
            </button>
            <button type="button" onClick={submit} disabled={pending || !message.trim()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900">
              {pending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
```

Montage (layout des pages connectées) :

```tsx
import { FloatingFeedback } from '@/components/FloatingFeedback'
// ... dans le JSX du layout :
<FloatingFeedback />
```

---

## 5. API d'envoi `/api/feedback` (POST)

`app/api/feedback/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server' // ← ton helper SSR (cookies)
import { createAdminClient } from '@/lib/supabase/admin'    // ← ton helper service-role

const MAX = 2000
const RL_WINDOW_S = 60
const RL_MAX = 10

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { message?: string; page?: string } | null
    const trimmed = body?.message?.trim() ?? ''
    if (!trimmed) return NextResponse.json({ ok: false, reason: 'empty_message' }, { status: 400 })
    if (trimmed.length > MAX) return NextResponse.json({ ok: false, reason: 'message_too_long' }, { status: 400 })

    // Auth obligatoire (cookies SSR)
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })

    const admin = createAdminClient()

    // Rate-limit : 10 / 60s / user
    const since = new Date(Date.now() - RL_WINDOW_S * 1000).toISOString()
    const { count } = await admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since)
    if ((count ?? 0) >= RL_MAX) return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })

    const { error } = await admin.from('feedback').insert({
      user_id: user.id,
      message: trimmed,
      page: body?.page ?? null,
      user_agent: req.headers.get('user-agent') ?? null,
    })
    if (error) return NextResponse.json({ ok: false, reason: 'insert_failed' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
}
```

---

## 6. API admin `/api/admin/feedback` (GET / PATCH / DELETE) + garde admin

`app/api/admin/feedback/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Garde admin réutilisable : retourne null si OK, sinon une réponse 401/403.
async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
  // Rôle lu depuis ta table users (adapte le nom de colonne si besoin)
  const admin = createAdminClient()
  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })
  return null
}

const VALID = ['open', 'done', 'spam'] as const

// GET /api/admin/feedback?status=open|done|spam (défaut: open)
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(); if (denied) return denied
  const status = req.nextUrl.searchParams.get('status') ?? 'open'
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('feedback')
    .select('id, user_id, message, page, user_agent, status, created_at, author:users(full_name, email, role)')
    .eq('status', VALID.includes(status as never) ? status : 'open')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, items: data ?? [] })
}

// PATCH /api/admin/feedback  { id, status }
export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(); if (denied) return denied
  const { id, status } = (await req.json().catch(() => ({}))) as { id?: string; status?: string }
  if (!id || !VALID.includes(status as never)) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('feedback').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/feedback?id=...
export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin(); if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, reason: 'missing_id' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('feedback').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

---

## 7. Page admin `/admin/feedback`

`app/admin/feedback/page.tsx` — server component (lit via service role), onglets par statut.

```tsx
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { FeedbackRow } from './FeedbackRow'
// ⚠️ Protège aussi cette page (layout /admin ou un guard) côté serveur.

export const dynamic = 'force-dynamic'

const VALID = ['open', 'done', 'spam'] as const
type Status = (typeof VALID)[number]

export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  const filter: Status = VALID.includes(status as never) ? (status as Status) : 'open'
  const admin = createAdminClient()

  const [open, done, spam, list] = await Promise.all([
    admin.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    admin.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'done'),
    admin.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'spam'),
    admin.from('feedback')
      .select('id, message, page, user_agent, status, created_at, author:users(full_name, email, role)')
      .eq('status', filter).order('created_at', { ascending: false }).limit(500),
  ])
  const counts = { open: open.count ?? 0, done: done.count ?? 0, spam: spam.count ?? 0 }
  const pick = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const items = (list.data ?? []).map((r: any) => ({
    id: r.id, message: r.message, page: r.page, user_agent: r.user_agent, status: r.status, created_at: r.created_at,
    author_label: pick(r.author)?.full_name ?? pick(r.author)?.email ?? 'Inconnu',
    author_role: pick(r.author)?.role ?? '—',
  }))

  const Tab = ({ s, label }: { s: Status; label: string }) => (
    <Link href={`/admin/feedback?status=${s}`}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${filter === s ? 'border-yellow-500 font-medium text-neutral-900 dark:text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}>
      {label} <span className="ml-1 text-xs tabular-nums text-neutral-400">({counts[s]})</span>
    </Link>
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="inline-flex items-center gap-2 text-2xl font-semibold">
        <MessageSquare className="h-6 w-6 text-yellow-500" /> Feedback
      </h1>
      <nav className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-700">
        <Tab s="open" label="À traiter" /><Tab s="done" label="Traité" /><Tab s="spam" label="Spam" />
      </nav>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center text-sm italic text-neutral-500">
          Aucun feedback ici.
        </div>
      ) : (
        <ul className="space-y-3">{items.map((e) => <li key={e.id}><FeedbackRow entry={e} /></li>)}</ul>
      )}
    </div>
  )
}
```

`app/admin/feedback/FeedbackRow.tsx` — client, actions via l'API admin.

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, RotateCcw } from 'lucide-react'

interface Entry {
  id: string; message: string; page: string | null; user_agent: string | null
  status: 'open' | 'done' | 'spam'; created_at: string; author_label: string; author_role: string
}

const BADGE: Record<Entry['status'], { label: string; cls: string }> = {
  open: { label: 'À traiter', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  done: { label: 'Traité', cls: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
  spam: { label: 'Spam', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
}

export function FeedbackRow({ entry }: { entry: Entry }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function call(method: 'PATCH' | 'DELETE', body?: object, query?: string) {
    start(async () => {
      setErr(null)
      const res = await fetch(`/api/admin/feedback${query ?? ''}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok) { setErr('Échec'); return }
      router.refresh()
    })
  }
  const setStatus = (status: Entry['status']) => call('PATCH', { id: entry.id, status })
  const remove = () => { if (confirm('Supprimer définitivement ce feedback ?')) call('DELETE', undefined, `?id=${entry.id}`) }

  const badge = BADGE[entry.status]
  return (
    <article className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span className={`rounded border px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
        <span className="tabular-nums">{new Date(entry.created_at).toLocaleString('fr-FR')}</span>
        <span>·</span><span className="font-medium text-neutral-700 dark:text-neutral-200">{entry.author_label}</span>
        <span className="rounded border border-neutral-300 px-1 text-[10px]">{entry.author_role}</span>
        {entry.page && <code className="font-mono text-[11px]">{entry.page}</code>}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-900 dark:text-neutral-100">{entry.message}</p>
      <div className="flex items-center gap-2">
        {entry.status === 'open' ? (
          <>
            <button onClick={() => setStatus('done')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Traité</button>
            <button onClick={() => setStatus('spam')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Spam</button>
          </>
        ) : (
          <button onClick={() => setStatus('open')} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Rouvrir</button>
        )}
        <button onClick={remove} disabled={pending} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Supprimer</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </article>
  )
}
```

---

## 8. Les 2 entrées de menu

**a) Lien texte (nav admin)** — `💬 Feedback` :

```tsx
<Link href="/admin/feedback" className="inline-flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
  <span aria-hidden>💬</span> Feedback
</Link>
```

Si ta nav est pilotée par un tableau d'items :
```ts
{ href: '/admin/feedback', label: '💬 Feedback', roles: ['admin'] }
```

**b) Carte dashboard** — icône lucide `MessageSquare` :

```tsx
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'

export function FeedbackDashboardCard() {
  return (
    <Link href="/admin/feedback"
      className="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
        <MessageSquare className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">Feedback</span>
        <span className="block text-xs text-neutral-500">Retours envoyés par les utilisateurs</span>
      </span>
    </Link>
  )
}
```

---

## 9. Dépendances / à adapter

| Élément | Ce qu'il faut dans le projet cible |
| --- | --- |
| **lucide-react** | `npm i lucide-react` (icônes `MessageSquarePlus`, `MessageSquare`, `Check`, `Trash2`, `RotateCcw`, `X`). |
| **Tailwind** | Classes standard (`yellow-400`, `neutral-*`, `amber/emerald/slate`). Aucune charte maison requise. |
| **Helpers Supabase** | `createServerClient()` (auth via cookies SSR) + `createAdminClient()` (clé **service_role**, côté serveur uniquement). Adapte les imports aux tiens. |
| **Table `users` + rôles** | Les routes/page supposent une table `public.users(id, role, full_name, email)` avec `role = 'admin'`. Adapte si ton modèle diffère (autre table de profils, autre nom de colonne). |
| **Garde admin** | `requireAdmin()` (section 6) ; ou réutilise le guard du layout `/admin` de ton projet. La page (section 7) **doit** aussi être protégée côté serveur. |
| **Toast (optionnel)** | Ici les retours sont affichés en ligne (pas de lib). Branche `sonner`/ton système si tu veux des toasts. |
| **Montage** | `<FloatingFeedback />` dans le layout des pages **connectées** (caché en mobile : `hidden md:flex`). |
| **Charte couleurs** | La bulle est `bg-yellow-400`. Remplace par ta couleur d'accent si besoin (1 classe). |

### Si l'autre projet n'utilise PAS Supabase
Seules **2 choses** changent — l'UI (sections 4, 7, 8) reste identique :
1. **Persistance** : remplace les appels `admin.from('feedback')...` par ton ORM/SQL
   (Prisma, Drizzle, fetch vers ton back…). Garde la table `feedback` (section 3) telle quelle.
2. **Auth + garde admin** : remplace `supabase.auth.getUser()` et `requireAdmin()` par
   ton mécanisme de session/rôle.

Dis-moi quel back tu utilises (Prisma/Drizzle, Express, Firebase, Rails…) et je te
réécris les sections 5 et 6 pour ce back.
