import {
  getAIUsageByFeature,
  getRecentAICalls,
  getAIProductionSummary,
} from '@/lib/db/ai-usage-rollup'

// Console mémoire IA — réflexion Vincent 2026-05-20 :
//   Rendre l'IA observable, explicable et gouvernable.
//
// 3 blocs verticaux, du plus alarmant au plus contextuel :
//   1. Volume + coût (7 derniers jours) — combien on dépense et où
//   2. Production récente — résonances B1/B2, documents analysés
//   3. Activité IA récente (50 derniers appels) — drill-down par appel
//
// Doctrine :
//   - Page admin uniquement (notFound côté parent si pas admin)
//   - Aucune IA pour observer l'IA (SQL pur)
//   - Aucun PII : pas de chunk_text, pas de prompt, pas d'output texte
//   - Pas de scoring qualité, juste des comptes descriptifs

const FEATURE_LABELS: Record<string, string> = {
  embed_chunks_document:        'Embeddings documents',
  embed_chunks_library:         'Embeddings bibliothèque',
  embed_chunks_tender_history:  'Embeddings historique AO',
  embed_trace_site_note:        'Embeddings notes terrain',
  embed_trace_anomaly:          'Embeddings anomalies',
  embed_trace_intervention_note: 'Embeddings notes intervention',
  embed_trace_photo_caption:    'Embeddings captions photo',
  ocr_pdf:                      'OCR PDF (Gemini Vision)',
  lecteur_ao:                   'Agent Lecteur AO',
  memoire_technique:            'Agent Mémoire Technique',
  conformite:                   'Agent Conformité',
  contradicteur:                'Agent Contradicteur',
  financier:                    'Agent Financier',
  terrain:                      'Agent Terrain',
  opportunity_scorer:           'Agent Opportunité',
}

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key
}

function fmtCost(usd: number): string {
  if (usd === 0) return '—'
  if (usd < 0.01) return `< $0.01`
  return `$${usd.toFixed(2)}`
}

function fmtTokens(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)} k`
  return `${(n / 1_000_000).toFixed(2)} M`
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `il y a ${sec} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  return `il y a ${d} j`
}

export async function AIMemorySection() {
  const DAYS = 7
  const [byFeature, recent, production] = await Promise.all([
    getAIUsageByFeature(DAYS),
    getRecentAICalls(50),
    getAIProductionSummary(DAYS),
  ])

  const totalCost = byFeature.reduce((s, r) => s + r.costUsd, 0)
  const totalCalls = byFeature.reduce((s, r) => s + r.calls, 0)
  const totalErrors = byFeature.reduce((s, r) => s + r.errors, 0)
  const projectedMonthly = totalCost * (30 / DAYS)

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Mémoire IA — 7 derniers jours
        </h2>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Ce que l'IA a fait, combien elle a coûté, ce qu'elle a produit. SQL pur, aucun appel IA pour observer.
        </p>
      </div>

      {/* Bloc 1 — Volume + coût par feature */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Volume + coût par feature
          </h3>
          <div className="text-xs text-muted-foreground tabular-nums">
            {totalCalls} appels · {fmtCost(totalCost)} sur 7 j
            {totalErrors > 0 && <span className="text-rose-600"> · {totalErrors} erreurs</span>}
            <span className="text-muted-foreground/70"> · projection mensuelle ~{fmtCost(projectedMonthly)}</span>
          </div>
        </div>
        {byFeature.length === 0 ? (
          <p className="text-sm text-muted-foreground italic rounded border p-4">
            Aucun appel IA tracé sur 7 jours. Soit aucune activité, soit le tracking n'est pas branché sur ce
            chemin (vérifier <code className="text-xs">withAITracking</code> / <code className="text-xs">logAIUsageDirect</code>).
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Feature</th>
                  <th className="text-left px-4 py-2">Modèle</th>
                  <th className="text-right px-4 py-2">Appels</th>
                  <th className="text-right px-4 py-2">Tokens in</th>
                  <th className="text-right px-4 py-2">Tokens out</th>
                  <th className="text-right px-4 py-2">Coût est.</th>
                  <th className="text-right px-4 py-2">Erreurs</th>
                  <th className="text-right px-4 py-2">Dernier</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byFeature.map((r) => (
                  <tr key={r.feature} className={r.errors > 0 ? 'bg-rose-50/30' : ''}>
                    <td className="px-4 py-2 font-medium">{featureLabel(r.feature)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                      {r.lastModel ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.calls}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.inputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.outputTokens)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtCost(r.costUsd)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${r.errors > 0 ? 'text-rose-600 font-medium' : 'text-muted-foreground'}`}>
                      {r.errors > 0 ? r.errors : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                      {fmtRelative(r.lastCallAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bloc 2 — Production récente (sources DB pures, pas ai_usage) */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Production IA — 7 derniers jours
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <ProductionCard label="Résonances B1 actives" value={production.resonancesActiveB1} />
          <ProductionCard label="Résonances B2 actives" value={production.resonancesActiveB2} />
          <ProductionCard label="Résonances staled" value={production.resonancesStaledRecent} muted />
          <ProductionCard label="Résonances dismissed" value={production.resonancesDismissedRecent} muted />
          <ProductionCard label="Documents analysés (ready)" value={production.documentsReadyRecent} />
          <ProductionCard
            label="Documents échec analyse"
            value={production.documentsFailedRecent}
            alert={production.documentsFailedRecent > 0}
          />
        </div>
      </div>

      {/* Bloc 3 — 50 derniers appels */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Activité récente (50 derniers appels)
        </h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground italic rounded border p-4">
            Aucun appel IA tracé.
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Quand</th>
                  <th className="text-left px-3 py-2">Feature</th>
                  <th className="text-left px-3 py-2">Modèle</th>
                  <th className="text-right px-3 py-2">Tokens in/out</th>
                  <th className="text-right px-3 py-2">Coût</th>
                  <th className="text-right px-3 py-2">Durée</th>
                  <th className="text-left px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.map((c) => (
                  <tr key={c.id} className={c.status === 'error' ? 'bg-rose-50/30' : ''}>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                      {fmtRelative(c.createdAt)}
                    </td>
                    <td className="px-3 py-1.5 font-medium">{featureLabel(c.feature)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{c.model ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmtTokens(c.inputTokens)} / {fmtTokens(c.outputTokens)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtCost(c.costUsd ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtDuration(c.durationMs)}
                    </td>
                    <td className="px-3 py-1.5">
                      {c.status === 'error' ? (
                        <span
                          className="text-rose-700"
                          title={c.errorMsg ?? undefined}
                        >
                          ✗ {c.errorMsg ? c.errorMsg.slice(0, 50) : 'erreur'}
                        </span>
                      ) : (
                        <span className="text-emerald-700">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function ProductionCard({
  label,
  value,
  muted = false,
  alert = false,
}: {
  label: string
  value: number
  muted?: boolean
  alert?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        alert ? 'border-rose-200 bg-rose-50/30' : muted ? 'bg-muted/20' : 'bg-card'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${alert ? 'text-rose-700' : ''}`}>
        {value}
      </div>
    </div>
  )
}
