import { checkEmbeddingApiHealth } from '@/lib/ai/check-api-health'
import { createAdminClient } from '@/lib/supabase/admin'

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Gemini (gemini-embedding-2)',
  openai: 'OpenAI (text-embedding-3-small)',
  voyage: 'Voyage AI (voyage-3)',
}

function StatusBadge({ status }: { status: 'ok' | 'no_key' | 'error' }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Opérationnelle
      </span>
    )
  }
  if (status === 'no_key') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Clé manquante
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs text-rose-700 font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
      Erreur API
    </span>
  )
}

export async function AIHealthSection() {
  const [health, embeddingCount] = await Promise.all([
    checkEmbeddingApiHealth(),
    getEmbeddingCount(),
  ])

  const providerLabel = health.provider
    ? (PROVIDER_LABEL[health.provider] ?? health.provider)
    : 'Aucun provider configuré'

  const checkedTime = new Date(health.checkedAt).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        APIs IA — Mémoire
      </h2>

      {/* Bannière d'alerte si problème */}
      {health.status !== 'ok' && (
        <div
          className={`rounded-lg border p-4 ${
            health.status === 'no_key'
              ? 'border-amber-200 bg-amber-50/50'
              : 'border-rose-200 bg-rose-50/50'
          }`}
        >
          <div
            className={`text-sm font-semibold mb-1 ${
              health.status === 'no_key' ? 'text-amber-800' : 'text-rose-800'
            }`}
          >
            {health.status === 'no_key'
              ? 'Aucune clé API d\'embeddings configurée'
              : `Erreur API ${health.provider ?? ''} — la mémoire sémantique est inactive`}
          </div>
          <div
            className={`text-sm ${
              health.status === 'no_key' ? 'text-amber-700' : 'text-rose-700'
            }`}
          >
            {health.status === 'no_key'
              ? 'Les résonances, persistances et le matching AO fonctionnent en mode V1 (token overlap uniquement). Définissez GOOGLE_GENAI_API_KEY dans les variables d\'environnement pour activer les embeddings.'
              : health.errorMsg}
          </div>
        </div>
      )}

      {/* Tableau d'état */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Composant</th>
              <th className="text-left px-4 py-2">Provider</th>
              <th className="text-left px-4 py-2">Statut</th>
              <th className="text-right px-4 py-2">Traces embeddées</th>
              <th className="text-right px-4 py-2">Vérifié à</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className={health.status === 'error' ? 'bg-rose-50/20' : ''}>
              <td className="px-4 py-2.5 font-medium text-sm">Embeddings</td>
              <td className="px-4 py-2.5 text-sm text-muted-foreground">{providerLabel}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={health.status} />
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-sm">
                {embeddingCount ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                {checkedTime}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

async function getEmbeddingCount(): Promise<number | null> {
  try {
    const supabase = createAdminClient()
    const { count } = await supabase
      .from('trace_embeddings')
      .select('*', { count: 'exact', head: true })
    return count ?? null
  } catch {
    return null
  }
}
