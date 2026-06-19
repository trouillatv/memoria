// /admin/analyse-ao — monitoring de fiabilité du pipeline d'analyse AO.
//
// Né d'un incident réel (un AO resté bloqué en `analyzing`, juin 2026) : on ne
// veut plus découvrir les pannes d'analyse par les utilisateurs. Répond à :
//   - combien d'AO analysés, combien échouent ?
//   - combien de temps prend une analyse ?
//   - Gemini répond-il (santé/latence) ?
//   - quelles sont les dernières erreurs, et y a-t-il un AO coincé MAINTENANT ?
//
// ≠ /admin/depenses-ia (coûts + mémoire/embeddings) · ≠ /admin/usage (usage
// terrain des briefs). Données : tables tenders, tender_analyses, ai_usage.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FileText, CheckCircle2, XCircle, Loader2, Timer, AlertTriangle, Activity } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getTenderAnalyticsSummary } from '@/lib/db/tenders'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} min ${s.toString().padStart(2, '0')}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

const ERROR_LABELS: Record<string, string> = {
  analyze_timeout: 'Délai dépassé (analyse coincée)',
  scanned_pdf_unsupported: 'PDF scanné non supporté',
}

function humanError(msg: string | null): string {
  if (!msg) return 'Erreur inconnue'
  return ERROR_LABELS[msg] ?? msg
}

export default async function AdminAnalyseAoPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin') redirect('/missions')

  const s = await getTenderAnalyticsSummary()
  const inProgress = s.byStatus.analyzing + s.byStatus.extracting

  const cards = [
    { label: 'AO créés', value: s.total, hint: 'total', icon: FileText, tone: 'text-slate-600 bg-slate-100' },
    { label: 'Prêts', value: s.byStatus.ready + s.byStatus.submitted + s.byStatus.archived, hint: 'analyse réussie', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
    { label: 'Échecs', value: s.byStatus.failed, hint: 'à relancer', icon: XCircle, tone: 'text-rose-600 bg-rose-50' },
    { label: 'En cours', value: inProgress, hint: 'analyzing / extracting', icon: Loader2, tone: 'text-sky-600 bg-sky-50' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analyse AO</h1>
        <p className="text-sm text-muted-foreground">
          Fiabilité du pipeline d&apos;analyse des appels d&apos;offres. Détecter les pannes avant les utilisateurs.
        </p>
      </div>

      {/* Alerte AO coincé MAINTENANT — le signal qui justifie cette page. */}
      {s.stuckNow > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="font-medium">
              {s.stuckNow} AO {s.stuckNow > 1 ? 'sont restés' : 'est resté'} en cours d&apos;analyse depuis plus de 10 min.
            </p>
            <p className="mt-1 text-rose-900/80">
              Le cron de sécurité (<code className="rounded bg-white/70 px-1">sweep-stuck-tenders</code>) doit les
              basculer en échec au prochain passage. S&apos;ils persistent, vérifier que le cron tourne (plan Vercel) et la santé Gemini ci-dessous.
            </p>
          </div>
        </div>
      )}

      {/* Compteurs principaux. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.label} className="rounded-xl border bg-card p-4">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${c.tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
              <div className="text-xs font-medium">{c.label}</div>
              <div className="text-[11px] text-muted-foreground">{c.hint}</div>
            </div>
          )
        })}
      </section>

      {/* Indicateurs de qualité. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" /> Taux de succès
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-semibold tabular-nums">
              {s.successRatePct === null ? '—' : `${s.successRatePct}%`}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Prêts / (prêts + échecs).</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" /> Temps moyen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-semibold tabular-nums">{fmtDuration(s.avgPipelineSeconds)}</div>
            <p className="mt-1 text-sm text-muted-foreground">Upload → analyse prête.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" /> Santé Gemini
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-4xl font-semibold tabular-nums">
              {s.gemini.avgDurationMs === null ? '—' : `${(s.gemini.avgDurationMs / 1000).toFixed(1)} s`}
            </div>
            <p className="text-sm text-muted-foreground">Latence moyenne par appel agent (30 j).</p>
            <p className="text-[11px] text-muted-foreground">
              {s.gemini.calls} appels · <span className={s.gemini.errors > 0 ? 'text-rose-600 font-medium' : ''}>{s.gemini.errors} erreurs</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dernières erreurs. */}
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <XCircle className="h-4 w-4 text-muted-foreground" /> Dernières erreurs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {s.recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Aucune analyse en échec. 🎉</p>
          ) : (
            <ul className="divide-y">
              {s.recentFailures.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/tenders/${f.id}`} className="truncate font-medium hover:underline">
                      {f.title}
                    </Link>
                    <div className="text-xs text-rose-700">{humanError(f.error_msg)}</div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtDate(f.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
