import {
  getAIUsageByFeature,
  getRecentAICalls,
  getAIProductionSummary,
  getAIUsageHeadline,
  getAIModelsActive,
  getAIHealthSummary,
  getAIRecentErrors,
} from '@/lib/db/ai-usage-rollup'
import { usdToXpf, fmtXpf, fmtUsd } from '@/lib/currency/xpf'

// Console IA admin — refonte Vincent 2026-05-20.
//
// Objectif : en 10 secondes, un admin comprend :
//   - quelle IA est utilisée
//   - si elle marche
//   - combien elle coûte (XPF principal, USD secondaire)
//   - ce qu'elle produit
//   - où sont les erreurs
//
// Hiérarchie (du plus lisible au plus technique) :
//   1. Résumé 4 chiffres (lecture instantanée)
//   2. IA utilisées (chips providers + modèles)
//   3. Santé par catégorie (24h)
//   4. Coût (XPF principal, USD secondaire)
//   5. Production IA (résonances, docs)
//   6. Dernières erreurs (5 max + accordéon)
//   7. Activité récente (50 derniers, repliés)
//
// Doctrine : admin-only, SQL pur, zéro IA pour observer, anti-PII.

const FEATURE_LABELS: Record<string, string> = {
  embed_chunks_document:        'Embeddings documents',
  embed_chunks_library:         'Embeddings bibliothèque',
  embed_chunks_tender_history:  'Embeddings historique AO',
  embed_trace_site_note:        'Embeddings notes site',
  embed_trace_anomaly:          'Embeddings anomalies',
  embed_trace_intervention_note: 'Embeddings notes intervention',
  embed_trace_photo_caption:    'Embeddings captions photo',
  ocr_pdf:                      'OCR PDF (Vision)',
  lecteur_ao:                   'Agent — Lecteur de dossier',
  memoire_technique:            'Agent — Mémoire technique',
  conformite:                   'Agent — Conformité',
  contradicteur:                'Agent — Contradicteur',
  financier:                    'Agent — Financier',
  terrain:                      'Agent — Terrain',
  opportunity_scorer:           'Agent — Opportunité',
  engagement_extraction:        'Extraction engagements',
  // Réunions / comptes-rendus terrain (reconnaissance vocale).
  site_report_transcription:    'Réunion — transcription audio (non facturée au token)',
  site_report_analysis:         'Réunion — analyse IA',
}

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key
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

/** Affiche un nom de modèle "propre" ou — si null/unknown. */
function modelDisplay(model: string | null | undefined): string {
  if (!model || model === 'unknown') return '—'
  return model
}

/**
 * Vincent 2026-05-21 — `subtab` permet d'afficher uniquement certaines
 * sections de la console IA dans des sous-onglets séparés :
 *   'console'    → headline + IA utilisées + coût par feature + erreurs + 50 derniers
 *   'production' → santé 24h + production IA
 *   undefined    → tout (rétro-compat)
 */
export async function AIMemorySection({
  subtab,
}: {
  subtab?: 'console' | 'production'
} = {}) {
  const DAYS = 7
  const [headline, models, health, byFeature, production, recent, recentErrors] = await Promise.all([
    getAIUsageHeadline(DAYS),
    getAIModelsActive(DAYS),
    getAIHealthSummary(),
    getAIUsageByFeature(DAYS),
    getAIProductionSummary(DAYS),
    getRecentAICalls(50),
    getAIRecentErrors(5),
  ])

  const totalCostXpf = usdToXpf(headline.totalCostUsd)
  const projectedMonthlyUsd = headline.totalCostUsd * (30 / DAYS)
  const projectedMonthlyXpf = usdToXpf(projectedMonthlyUsd)
  const productionTotal =
    production.documentsReadyRecent + production.resonancesActiveB1 + production.resonancesActiveB2

  // Helpers : rendre une section seulement si le subtab le demande (ou
  // si pas de subtab = tout afficher en rétro-compat).
  const showConsole = !subtab || subtab === 'console'
  const showProduction = !subtab || subtab === 'production'

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {subtab === 'production' ? 'Production IA — 7 derniers jours' : 'Console IA — 7 derniers jours'}
        </h2>
      </header>


      {showConsole && (
      <>
      {/* ============================================================ */}
      {/* 1. RÉSUMÉ — chiffres en grand, lecture en 5 secondes.
           Vincent 2026-05-21 : tokens ajoutés en headline (ils étaient cachés
           dans le `<details>` collapsé en bas). */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeadlineCard
          label="Appels IA"
          value={headline.totalCalls.toString()}
          sub={`${DAYS} derniers jours`}
        />
        <HeadlineCard
          label="Erreurs"
          value={headline.totalErrors.toString()}
          sub={headline.totalErrors > 0 ? 'à investiguer' : 'aucune'}
          alert={headline.totalErrors > 0}
        />
        <HeadlineCard
          label="Coût IA"
          value={fmtXpf(totalCostXpf)}
          sub={fmtUsd(headline.totalCostUsd)}
        />
        <HeadlineCard
          label="Projection mois"
          value={fmtXpf(projectedMonthlyXpf)}
          sub={fmtUsd(projectedMonthlyUsd)}
        />
        <HeadlineCard
          label="Tokens entrée"
          value={fmtTokens(headline.totalInputTokens)}
          sub={`${DAYS} derniers jours`}
        />
        <HeadlineCard
          label="Tokens sortie"
          value={fmtTokens(headline.totalOutputTokens)}
          sub={`${DAYS} derniers jours`}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        Total <span className="font-semibold tabular-nums">{fmtTokens(headline.totalInputTokens + headline.totalOutputTokens)}</span> tokens consommés sur les {DAYS} derniers jours · production : {productionTotal} docs + résonances.
      </div>

      {/* ============================================================ */}
      {/* 2. IA UTILISÉES — chips providers + modèles */}
      {/* ============================================================ */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          IA utilisées
        </h3>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucun modèle utilisé sur 7 jours.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <span
                key={`${m.provider}:${m.model}`}
                className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs"
                title={`${m.calls} appels · dernier ${fmtRelative(m.lastCallAt)}`}
              >
                <span className="font-medium">{m.model}</span>
                <span className="text-muted-foreground">{m.provider}</span>
                <span className="text-muted-foreground tabular-nums">· {m.calls}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      </>
      )}

      {showProduction && (
      <>
      {/* ============================================================ */}
      {/* 3. SANTÉ — 3 lignes (24h) */}
      {/* ============================================================ */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Santé IA — 24 dernières heures
        </h3>
        <div className="rounded-lg border divide-y">
          <HealthRow
            label="Embeddings"
            status={health.embeddings}
            counts={health.counts.embeddings}
          />
          <HealthRow
            label="OCR documents"
            status={health.ocr}
            counts={health.counts.ocr}
          />
          <HealthRow
            label="Agents dossiers"
            status={health.agentsAO}
            counts={health.counts.agentsAO}
          />
        </div>
      </div>

      {/* ============================================================ */}
      {/* 4. PRODUCTION IA (déplacée ici pour grouper avec Santé) */}
      {/* ============================================================ */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Production IA — 7 derniers jours
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <ProductionCard label="Documents analysés" value={production.documentsReadyRecent} />
          <ProductionCard
            label="Échecs analyse"
            value={production.documentsFailedRecent}
            alert={production.documentsFailedRecent > 0}
          />
          <ProductionCard label="Résonances B1 actives" value={production.resonancesActiveB1} />
          <ProductionCard label="Résonances B2 actives" value={production.resonancesActiveB2} />
          <ProductionCard label="Staled" value={production.resonancesStaledRecent} muted />
          <ProductionCard label="Dismissed" value={production.resonancesDismissedRecent} muted />
        </div>
      </div>

      </>
      )}

      {showConsole && (
      <>
      {/* ============================================================ */}
      {/* 5. COÛT — XPF principal, USD secondaire */}
      {/* ============================================================ */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Coût par feature
        </h3>
        <div className="text-xs text-muted-foreground">
          {fmtXpf(totalCostXpf)} sur 7 jours · projection mensuelle
          <span className="font-semibold text-foreground"> {fmtXpf(projectedMonthlyXpf)}</span>
          <span className="text-muted-foreground/60"> ({fmtUsd(projectedMonthlyUsd)})</span>
        </div>
        {byFeature.length === 0 ? (
          <p className="text-sm text-muted-foreground italic rounded border p-4">
            Aucun appel IA tracé.
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Feature</th>
                  <th className="text-right px-4 py-2">Appels</th>
                  <th className="text-right px-4 py-2">Coût</th>
                  <th className="text-right px-4 py-2">USD</th>
                  <th className="text-right px-4 py-2">Erreurs</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byFeature.map((r) => {
                  const xpf = usdToXpf(r.costUsd)
                  return (
                    <tr key={r.feature} className={r.errors > 0 ? 'bg-rose-50/30' : ''}>
                      <td className="px-4 py-2 font-medium">{featureLabel(r.feature)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.calls}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtXpf(xpf)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground/70">
                        {fmtUsd(r.costUsd)}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${r.errors > 0 ? 'text-rose-600 font-medium' : 'text-muted-foreground'}`}>
                        {r.errors > 0 ? r.errors : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* 6. DERNIÈRES ERREURS — 5 max, le reste replié */}
      {/* ============================================================ */}
      {headline.totalErrors > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Dernières erreurs ({recentErrors.length} affichées, {headline.totalErrors} total)
          </h3>
          <div className="rounded-lg border divide-y bg-rose-50/10">
            {recentErrors.map((e) => (
              <div key={e.id} className="px-4 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{featureLabel(e.feature)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {fmtRelative(e.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-rose-700/80 mt-0.5">
                  {e.errorMsg ? e.errorMsg.slice(0, 200) : 'erreur sans message'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {modelDisplay(e.model)} · {fmtDuration(e.durationMs)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 7. ACTIVITÉ RÉCENTE — repliée par défaut */}
      {/* ============================================================ */}
      <details className="rounded-lg border" open>
        <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/30">
          Voir les {recent.length} derniers appels IA
        </summary>
        {recent.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground italic">
            Aucun appel récent.
          </p>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Quand</th>
                  <th className="text-left px-3 py-2">Feature</th>
                  <th className="text-left px-3 py-2">Modèle</th>
                  <th className="text-right px-3 py-2">in/out</th>
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
                    <td className="px-3 py-1.5 text-muted-foreground">{modelDisplay(c.model)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmtTokens(c.inputTokens)} / {fmtTokens(c.outputTokens)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmtXpf(usdToXpf(c.costUsd))}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {fmtDuration(c.durationMs)}
                    </td>
                    <td className="px-3 py-1.5">
                      {c.status === 'error' ? (
                        <span className="text-rose-700" title={c.errorMsg ?? undefined}>
                          ✗
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
      </details>
      </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Sous-composants — sobres, pas de graphique
// ---------------------------------------------------------------------------

function HeadlineCard({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string
  value: string
  sub?: string
  alert?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${alert ? 'border-rose-200 bg-rose-50/30' : 'bg-card'}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${alert ? 'text-rose-700' : ''}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  )
}

function HealthRow({
  label,
  status,
  counts,
}: {
  label: string
  status: 'ok' | 'error' | 'inactif'
  counts: { calls: number; errors: number }
}) {
  const statusLabel =
    status === 'ok' ? 'Opérationnel'
    : status === 'error' ? 'Erreur'
    : 'Inactif'
  const cls =
    status === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : status === 'error' ? 'text-rose-700 bg-rose-50 border-rose-200'
    : 'text-muted-foreground bg-muted/30 border-muted'
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {counts.calls} appels{counts.errors > 0 ? ` · ${counts.errors} erreurs` : ''}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${cls}`}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-rose-500' : 'bg-muted-foreground/50'
            }`}
          />
          {statusLabel}
        </span>
      </div>
    </div>
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
