import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { buildLiveDebrief, type LiveDebriefItem } from '@/lib/knowledge/live-debrief'
import { MarkSeenButton } from './MarkSeenButton'

// Page de debug D3. Contrairement à dev/field, accessible en production :
// recette mobile demandée par Vincent (2026-08-31), pas d'accès localhost
// depuis le téléphone. buildLiveDebrief passe par le client admin (RLS
// contournées) — le scoping organisation est donc fait ici explicitement,
// pas délégué à Postgres. Le layout (dashboard) redirige déjà chef_equipe
// avant d'atteindre cette page ; seuls admin/manager la voient.
// Sert uniquement à exercer la chaîne réelle buildLiveDebrief → CTA
// Action/Échéance/Réserve → markLiveDebriefSignalSeen, hors des 6 blocs UI
// définitifs (D3 §8 — pas de refonte ici).

function ObjectItemRow({ item }: { item: Extract<LiveDebriefItem, { kind: 'action' | 'deadline' | 'reserve' }> }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <a href={item.href} className="font-medium text-primary hover:underline">
          {item.title}
        </a>
        <div className="text-xs text-muted-foreground">
          {item.kind} · statut={item.status} · disposition={item.disposition} · date={item.date ?? '—'}
        </div>
      </div>
    </li>
  )
}

function InformationalItemRow({ item, siteId }: { item: Extract<LiveDebriefItem, { kind: 'informational_signal' }>; siteId: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <a href={item.href} className="font-medium text-primary hover:underline">
          {item.title}
        </a>
        <div className="text-xs text-muted-foreground">
          signal · disposition={item.disposition} · ack={item.ack} · {item.reasons.join(' / ')}
        </div>
      </div>
      {item.ack === 'unseen' ? (
        <MarkSeenButton item={item} siteId={siteId} />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">vu</span>
      )}
    </li>
  )
}

function ItemRow({ item, siteId }: { item: LiveDebriefItem; siteId: string }) {
  if (item.kind === 'informational_signal') return <InformationalItemRow item={item} siteId={siteId} />
  return <ObjectItemRow item={item} />
}

function Block({ title, items, siteId }: { title: string; items: LiveDebriefItem[]; siteId: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">vide</p>
      ) : (
        <ul className="rounded-lg border bg-card divide-y">
          {items.map((item) => (
            <ItemRow key={`${item.kind}-${item.kind === 'informational_signal' ? item.signalKey : item.id}`} item={item} siteId={siteId} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default async function DevLiveDebriefPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>
}) {
  const { site: siteId } = await searchParams
  const user = await getCurrentUserWithProfile()
  if (!user) notFound()
  const orgIds = await getOrgIdsOfUser()

  if (!siteId) {
    const admin = createAdminClient()
    const { data: sites } = await admin
      .from('sites')
      .select('id, name')
      .is('deleted_at', null)
      .in('organization_id', orgIds)
      .order('name')
      .limit(50)

    return (
      <div className="space-y-6 w-full">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Page debug D3 — Débrief vivant. Choisis un chantier pour exercer la chaîne réelle
          (Action/Échéance/Réserve cliquables, signal informationnel + bouton Vu).
        </div>
        <ul className="rounded-lg border bg-card divide-y">
          {(sites ?? []).map((s) => (
            <li key={s.id as string}>
              <a href={`/dev/live-debrief?site=${s.id}`} className="block px-3 py-2 text-sm hover:bg-muted/40">
                {s.name as string}
              </a>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // buildLiveDebrief passe par le client admin : vérifier explicitement que
  // le chantier appartient à une organisation de l'utilisateur avant de lire
  // quoi que ce soit (RLS non appliquée côté admin client).
  const admin = createAdminClient()
  const { data: site } = await admin.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  if (!site || !orgIds.includes(site.organization_id as string)) notFound()

  const debrief = await buildLiveDebrief(siteId, user.id)

  return (
    <div className="space-y-6 w-full">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Page debug D3 — chantier {siteId}. Utilisateur = {user.email}.{' '}
        <a href="/dev/live-debrief" className="underline">
          changer de chantier
        </a>
      </div>

      <Block title="À traiter" items={debrief.toHandle} siteId={siteId} />
      <Block title="À surveiller" items={debrief.toWatch} siteId={siteId} />
      <Block title="Traité récemment" items={debrief.recentlyHandled} siteId={siteId} />
    </div>
  )
}
