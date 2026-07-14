import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ListTodo, MapPin, HardHat } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listOpenSiteActions, actionHealth, type ActionHealth, type SiteActionRow } from '@/lib/db/site-actions'
import { listSites } from '@/lib/db/sites'
import { EmptyState } from '@/components/ui/empty-state'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import { QuickActionButton } from '@/components/actions/QuickActionButton'
import type { SiteActionStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

const STATUS_TABS: Array<{ key: string; label: string; statuses: SiteActionStatus[] }> = [
  { key: 'open', label: 'Ouvertes', statuses: ['open'] },
  { key: 'planned', label: 'Planifiées', statuses: ['planned'] },
  { key: 'done', label: 'Terminées', statuses: ['done'] },
  { key: 'all', label: 'Toutes', statuses: ['open', 'planned', 'done', 'cancelled'] },
]

const HEALTH_META: Record<ActionHealth, { dot: string; label: string }> = {
  critique: { dot: '🔴', label: 'Critique' },
  surveiller: { dot: '🟠', label: 'À surveiller' },
  rythme: { dot: '🟢', label: 'En rythme' },
}

export default async function ActionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; corps?: string; health?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const sp = searchParams ? await searchParams : {}
  const statusKey = STATUS_TABS.some((t) => t.key === sp.status) ? sp.status! : 'open'
  const corpsFilter = sp.corps && sp.corps.length > 0 ? sp.corps : null
  const healthFilter = (['critique', 'surveiller', 'rythme'] as const).includes(sp.health as ActionHealth)
    ? (sp.health as ActionHealth)
    : null

  const tab = STATUS_TABS.find((t) => t.key === statusKey)!
  const [all, sites] = await Promise.all([
    listOpenSiteActions({ statuses: tab.statuses }),
    listSites(),
  ])
  const siteOptions = sites.map((s) => ({ id: s.id, name: s.name }))

  // Corps d'état présents (pour les chips).
  const corpsList = [...new Set(all.map((a) => a.corps_etat).filter((v): v is string => !!v))].sort()

  // Santé par ancienneté (sur le statut courant).
  const healthCount = { critique: 0, surveiller: 0, rythme: 0 }
  for (const a of all) healthCount[actionHealth(a.created_at)]++

  const filtered = all.filter((a) => {
    if (corpsFilter && a.corps_etat !== corpsFilter) return false
    if (healthFilter && actionHealth(a.created_at) !== healthFilter) return false
    return true
  })

  // Groupé par site (puis corps d'état via l'ordre déjà appliqué + tri secondaire).
  const bySite = new Map<string, { name: string; contractName: string | null; actions: SiteActionRow[] }>()
  for (const a of filtered) {
    if (!bySite.has(a.site_id)) bySite.set(a.site_id, { name: a.site_name, contractName: a.contract_name, actions: [] })
    bySite.get(a.site_id)!.actions.push(a)
  }
  for (const g of bySite.values()) {
    g.actions.sort((x, y) => (x.corps_etat ?? '').localeCompare(y.corps_etat ?? '') || (x.created_at < y.created_at ? -1 : 1))
  }
  const siteGroups = [...bySite.entries()]

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-transform active:scale-[0.97] ${
      active
        ? 'bg-foreground text-background border-foreground'
        : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
    }`
  const qs = (next: { status?: string; corps?: string | null; health?: string | null }) => {
    const p = new URLSearchParams()
    const status = next.status ?? statusKey
    if (status && status !== 'open') p.set('status', status)
    const corps = next.corps === undefined ? corpsFilter : next.corps
    if (corps) p.set('corps', corps)
    const health = next.health === undefined ? healthFilter : next.health
    if (health) p.set('health', health)
    const s = p.toString()
    return s ? `/actions?${s}` : '/actions'
  }

  return (
    <div className="space-y-6 w-full">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
            <ListTodo className="h-6 w-6 text-muted-foreground" />
            Actions
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Ce qui reste à faire, tous chantiers confondus — actions issues des réunions ou créées à la volée.
            Une action n&apos;est pas une intervention&nbsp;: elle n&apos;entre au planning que si elle est planifiée.
          </p>
        </div>
        <div className="shrink-0">
          <QuickActionButton source="actions_list" sites={siteOptions} variant="desktop" />
        </div>
      </header>

      {/* Santé des actions ouvertes (ancienneté) — bandeau cliquable. */}
      {statusKey === 'open' && all.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(['critique', 'surveiller', 'rythme'] as ActionHealth[]).map((h) => {
            if (healthCount[h] === 0) return null
            const active = healthFilter === h
            return (
              <Link
                key={h}
                href={qs({ health: active ? null : h })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-transform active:scale-[0.97] ${
                  active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
                }`}
              >
                <span className="text-[10px] leading-none">{HEALTH_META[h].dot}</span>
                {HEALTH_META[h].label}
                <span className="tabular-nums opacity-70">{healthCount[h]}</span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Filtres */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((t) => (
            <Link key={t.key} href={qs({ status: t.key })} className={chip(statusKey === t.key)}>
              {t.label}
            </Link>
          ))}
        </div>
        {corpsList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={qs({ corps: null })} className={chip(!corpsFilter)}>Tous corps d&apos;état</Link>
            {corpsList.map((c) => (
              <Link key={c} href={qs({ corps: c })} className={chip(corpsFilter === c)}>
                <HardHat className="h-3 w-3" />{c}
              </Link>
            ))}
          </div>
        )}
      </div>

      {all.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="Aucune action"
          description="Les actions ouvertes apparaissent ici dès qu'une réunion en produit (curation des décisions)."
        />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-1 py-6 text-center">
          Aucune action ne correspond à ce filtre.
        </p>
      ) : (
        <div className="space-y-5">
          {siteGroups.map(([siteId, g]) => (
            <section key={siteId} className="space-y-2">
              <div className="flex items-center gap-1.5 px-1">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                <Link href={`/sites/${siteId}`} className="text-sm font-semibold hover:underline">
                  {g.name}
                </Link>
                {g.contractName && <span className="text-xs text-muted-foreground">· {g.contractName}</span>}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{g.actions.length}</span>
              </div>
              <OpenActionsList actions={g.actions} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
