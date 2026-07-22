// Sprint 3 — page d'un nœud de mémoire : « Que sait-on sur [label] ? »
// Affiche le contenu rattaché (actions + anomalies, déterministe, pas d'IA) +
// les outils de rattachement. L'architecture d'adressage devient visible :
//   Organisation → Site → Scope → Contenu.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Layers, ListTodo, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listOrgCatalog } from '@/lib/db/org-catalog'
import {
  getScope,
  listScopeActions,
  listScopeAnomalies,
  listSiteActionsForAttach,
  listSiteAnomaliesForAttach,
} from '@/lib/db/memory-scopes'
import {
  ScopeContentManager,
  DetachButton,
  type AttachItem,
} from './ScopeContentManager'

export const dynamic = 'force-dynamic'

const ACTION_STATUS: Record<string, string> = {
  open: 'Ouverte', planned: 'Planifiée', done: 'Faite', cancelled: 'Annulée',
}
const ANOMALY_STATUS: Record<string, string> = {
  open: 'Ouverte', resolved: 'Résolue', ignored: 'Ignorée',
}

export default async function ScopePage({
  params,
}: {
  params: Promise<{ id: string; scopeId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  const orgId = user.organization_id
  if (!orgId) redirect('/sites')

  const { id, scopeId } = await params
  const scope = await getScope(scopeId, orgId)
  if (!scope || scope.siteId !== id) notFound()

  // P0 IDOR : cette page affichait `identity?.name ?? 'Site'` et RENDAIT les
  // données du scope même quand l'identité était refusée. `getSiteIdentity`
  // rend désormais `null` pour un non-membre — on transforme ce refus en
  // notFound plutôt que de servir le scope sous le libellé « Site ».
  const identityGuard = await getSiteIdentity(id)
  if (!identityGuard) notFound()

  const [identity, actions, anomalies, siteActions, siteAnomalies, anomalyCat] = await Promise.all([
    getSiteIdentity(id),
    listScopeActions(scopeId),
    listScopeAnomalies(scopeId),
    listSiteActionsForAttach(id),
    listSiteAnomaliesForAttach(id, orgId),
    listOrgCatalog(orgId, 'anomaly_category'),
  ])

  const catLabel = (key: string, other: string | null) =>
    anomalyCat.find((c) => c.key === key)?.label ?? other ?? key
  const anomalyTitle = (a: { category: string; categoryOther: string | null; description: string | null }) =>
    a.description?.trim() || catLabel(a.category, a.categoryOther)

  const total = actions.length + anomalies.length

  const actionItems: AttachItem[] = siteActions.map((a) => ({
    id: a.id, label: a.title, sub: a.corpsEtat, scopeId: a.scopeId,
  }))
  const anomalyItems: AttachItem[] = siteAnomalies.map((a) => ({
    id: a.id, label: anomalyTitle(a), sub: catLabel(a.category, a.categoryOther), scopeId: a.scopeId,
  }))

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/sites/${id}?tab=memoire`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {identity?.name ?? 'Site'}
        </Link>
      </div>

      <div>
        <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          Sous-périmètre
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          Que sait-on sur {scope.label} ?
        </h1>
        {scope.description && <p className="text-sm text-muted-foreground mt-1">{scope.description}</p>}
      </div>

      {/* Mémoire rattachée — actions + anomalies */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <h2 className="text-sm font-medium">
            Mémoire rattachée <span className="text-muted-foreground">({total})</span>
          </h2>

          {total === 0 && (
            <p className="text-sm text-muted-foreground italic">
              Rien de rattaché pour l&apos;instant. Rattachez des actions et des anomalies ci-dessous :
              elles constitueront la mémoire interrogeable de ce sous-périmètre.
            </p>
          )}

          {actions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
                <ListTodo className="h-3.5 w-3.5" /> Actions ({actions.length})
              </div>
              <ul className="space-y-1.5">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{a.title}</div>
                      {a.body && <div className="text-[13px] text-muted-foreground mt-0.5">{a.body}</div>}
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                        <span>{ACTION_STATUS[a.status] ?? a.status}</span>
                        {a.corpsEtat && <span>· {a.corpsEtat}</span>}
                      </div>
                    </div>
                    <DetachButton siteId={id} itemId={a.id} kind="action" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {anomalies.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Anomalies ({anomalies.length})
              </div>
              <ul className="space-y-1.5">
                {anomalies.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{anomalyTitle(a)}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                        <span>{catLabel(a.category, a.categoryOther)}</span>
                        <span>· {ANOMALY_STATUS[a.status] ?? a.status}</span>
                      </div>
                    </div>
                    <DetachButton siteId={id} itemId={a.id} kind="anomaly" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Outils de rattachement */}
      <div className="space-y-2">
        <ScopeContentManager siteId={id} scopeId={scopeId} kind="action" items={actionItems} />
        <ScopeContentManager siteId={id} scopeId={scopeId} kind="anomaly" items={anomalyItems} />
      </div>

      <p className="text-[12px] text-muted-foreground">
        Les photos et événements se brancheront ici à l&apos;identique (prochaine étape).
      </p>
    </div>
  )
}
