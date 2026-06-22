// /admin/personnes/[id] — « Analyse d'usage » d'une personne.
//
// Observation PRODUIT (où l'on clique, où l'on hésite, quels menus restent
// morts) pour décider quoi simplifier à partir de FAITS, pas d'intuitions.
// Ce n'est PAS un outil RH : aucune note, aucun « temps passé » mis en avant,
// aucune mise en regard d'autres comptes.
//
// Garde-fous (board 2026-06-23) :
//   - admin uniquement (gate hérité de app/admin/layout.tsx) ;
//   - la consultation est elle-même tracée (tripwire ci-dessous) ;
//   - 100 % déterministe (lib/db/user-journey), aucun LLM ;
//   - couvert par tests/doctrine/usage-analysis-no-rh.test.ts.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Layers, AlertTriangle, MousePointerClick, Smartphone, Monitor } from 'lucide-react'
import { getCurrentUserWithProfile, listUsersForAdmin } from '@/lib/db/users'
import { getUserJourney, type JourneySession } from '@/lib/db/user-journey'
import { insertActivityLog } from '@/lib/db/activity-logs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { UserRole } from '@/types/db'

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  chef_equipe: "Chef d'équipe",
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Pacific/Noumea',
  })
}
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Noumea',
  })
}

export default async function PersonneUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [me, users] = await Promise.all([getCurrentUserWithProfile(), listUsersForAdmin()])
  const person = users.find((u) => u.id === id)
  if (!person) notFound()

  // Tripwire : on trace QUI a ouvert l'analyse d'usage de QUI (best-effort).
  if (me) {
    insertActivityLog({
      userId: me.id,
      entityType: 'user',
      entityId: id,
      action: 'usage_analysis_viewed',
      metadata: { kind: 'usage_analysis_viewed', target_user_id: id, viewer_role: me.role },
    }).catch(() => {})
  }

  const journey = await getUserJourney(id, { role: person.role, days: 21 })
  const name = person.full_name || person.email

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/personnes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Personnes
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{name}</h1>
          <span className="text-sm text-muted-foreground">{ROLE_LABEL[person.role]} · {person.email}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Analyse d&apos;usage — 21 derniers jours. Ces données décrivent l&apos;usage de
          l&apos;outil, pas la personne : aucun jugement, aucune mise en regard d&apos;autres comptes.
        </p>
      </div>

      {journey.totalEvents === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucune navigation tracée sur la période. (La collecte ne couvre que les écrans bureau.)
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Friction (en tête : c'est le signal le plus actionnable) ── */}
          {journey.frictions.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Points de friction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm text-amber-900">
                {journey.frictions.map((f, i) => (
                  <p key={i}>
                    <strong>{f.label}</strong> ouverte {f.repeats}× en moins de {f.windowMinutes} min
                    <span className="text-amber-700"> — navigation en boucle, écran probablement peu clair.</span>
                  </p>
                ))}
                <p className="pt-1 text-xs text-amber-700">
                  Indice à confirmer en observant l&apos;écran concerné, pas un constat sur la personne.
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Heatmap : utilisé vs jamais ouvert ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-muted-foreground" /> Pages les plus ouvertes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {journey.heatmapUsed.slice(0, 8).map((h) => (
                  <div key={h.label} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 truncate text-sm">{h.label}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(3, h.pct)}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {h.pct}% · {h.count}
                    </span>
                  </div>
                ))}
              </div>
              {journey.neverOpened.length > 0 && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Menus cœur jamais ouverts</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {journey.neverOpened.map((m) => (
                      <span key={m} className="rounded-full border border-dashed bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">{m}</span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Soit la personne n&apos;en a pas besoin, soit elle ne les trouve pas — à départager.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Parcours par session (L1 + L2) ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MousePointerClick className="h-4 w-4 text-muted-foreground" /> Parcours par session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {journey.sessions.slice(0, 12).map((s, i) => (
                <SessionBlock key={i} session={s} />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function SessionBlock({ session }: { session: JourneySession }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium capitalize">{fmtDay(session.startAt)}</span>
        <span className="text-xs text-muted-foreground">
          {fmtClock(session.startAt)} → {fmtClock(session.endAt)} · {session.events.length} écran{session.events.length > 1 ? 's' : ''}
        </span>
      </div>
      <ol className="space-y-0.5 border-l-2 border-border pl-3">
        {session.events.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtClock(e.at)}</span>
            {e.kind === 'action'
              ? <span className="text-foreground/80 italic">{e.label}</span>
              : <span className={e.isReturn ? 'text-muted-foreground' : ''}>{e.label}</span>}
            {e.isReturn && <span className="text-xs text-muted-foreground" title="retour sur une page déjà vue">↩</span>}
            {e.device === 'ios' || e.device === 'android'
              ? <Smartphone className="h-3 w-3 text-muted-foreground/50" />
              : e.device === 'desktop'
                ? <Monitor className="h-3 w-3 text-muted-foreground/40" />
                : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
