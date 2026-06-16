// Sprint 3 — page d'un nœud de mémoire : « Que sait-on sur [label] ? »
// Affiche le contenu rattaché (déterministe, pas d'IA) + l'outil de rattachement.
// C'est la première fois que l'architecture d'adressage devient visible :
//   Organisation → Site → Scope → Contenu.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Layers } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import {
  getScope,
  listScopeActions,
  listSiteActionsForAttach,
} from '@/lib/db/memory-scopes'
import {
  ScopeContentManager,
  DetachButton,
  type ActionItem,
} from './ScopeContentManager'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  open: 'Ouverte',
  planned: 'Planifiée',
  done: 'Faite',
  cancelled: 'Annulée',
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

  const [identity, attached, siteActions] = await Promise.all([
    getSiteIdentity(id),
    listScopeActions(scopeId),
    listSiteActionsForAttach(id),
  ])

  const attachItems: ActionItem[] = siteActions.map((a) => ({
    id: a.id,
    title: a.title,
    corpsEtat: a.corpsEtat,
    status: a.status,
    scopeId: a.scopeId,
  }))

  return (
    <div className="space-y-6 w-full max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/sites/${id}?tab=memoire`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {identity?.name ?? 'Site'}
        </Link>
      </div>

      {/* Titre — la question que le scope rend posable */}
      <div>
        <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          Sous-périmètre
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          Que sait-on sur {scope.label} ?
        </h1>
        {scope.description && (
          <p className="text-sm text-muted-foreground mt-1">{scope.description}</p>
        )}
      </div>

      {/* Contenu rattaché — la mémoire de ce périmètre */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h2 className="text-sm font-medium">
            Mémoire rattachée{' '}
            <span className="text-muted-foreground">({attached.length})</span>
          </h2>
          {attached.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Rien de rattaché pour l&apos;instant. Rattachez des actions ci-dessous : elles
              constitueront la mémoire interrogeable de ce sous-périmètre.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {attached.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{a.title}</div>
                    {a.body && <div className="text-[13px] text-muted-foreground mt-0.5">{a.body}</div>}
                    <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                      <span>{STATUS_LABEL[a.status] ?? a.status}</span>
                      {a.corpsEtat && <span>· {a.corpsEtat}</span>}
                    </div>
                  </div>
                  <DetachButton siteId={id} actionId={a.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Outil de rattachement */}
      <ScopeContentManager siteId={id} scopeId={scopeId} actions={attachItems} />

      <p className="text-[12px] text-muted-foreground">
        S3 rattache les actions. Les autres contenus (anomalies, photos, événements) se
        brancheront ici à l&apos;identique.
      </p>
    </div>
  )
}
