'use client'

import { useActionState } from 'react'
import { runBackfillAction, type BackfillResult } from './actions'

type State =
  | null
  | { ok: false; error: string }
  | { ok: true; result: BackfillResult }

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Gemini (gemini-embedding-2)',
  openai: 'OpenAI (text-embedding-3-small)',
  voyage: 'Voyage AI (voyage-3)',
}

function ResultRow({ label, count, errors }: { label: string; count: number; errors: number }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-sm font-medium">{label}</td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        <span className="text-emerald-700 font-semibold">{count}</span>
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {errors > 0
          ? <span className="text-rose-700 font-semibold">{errors}</span>
          : <span className="text-muted-foreground">0</span>}
      </td>
    </tr>
  )
}

export default function BackfillPage() {
  const [state, action, isPending] = useActionState<State, FormData>(runBackfillAction, null)

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backfill mémoire IA</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Génère les chunks sémantiques pour les items bibliothèque et les dossiers gagnés/perdus
          existants. À lancer une seule fois après l'activation des embeddings.
          Les nouveaux items sont embeddés automatiquement à la création.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Ce que ça fait
        </h2>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="text-emerald-600 font-bold">→</span>
            Lit tous les items de la bibliothèque AGP (procédures, certifications, références…)
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-600 font-bold">→</span>
            Découpe chaque item en sections (~900 car.) et génère un vecteur d'embedding par section
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-600 font-bold">→</span>
            Fait la même chose pour tous les dossiers marqués gagné ou perdu qui ont un document PDF extrait
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-600 font-bold">→</span>
            Stocke les chunks dans{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">knowledge_chunks</code>{' '}
            — l'Atelier IA peut ensuite les citer comme preuves documentaires
          </li>
        </ul>
      </div>

      <form action={action}>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? (
            <>
              <span className="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Backfill en cours…
            </>
          ) : (
            'Lancer le backfill'
          )}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Durée estimée : 1–3 secondes par item (appel API embedding). Peut prendre plusieurs minutes si la bibliothèque est volumineuse.
        </p>
      </form>

      {state !== null && (
        <div className="space-y-4">
          {!state.ok ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 text-sm text-rose-800">
              {state.error}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2">Source</th>
                      <th className="text-right px-4 py-2">Embeddés</th>
                      <th className="text-right px-4 py-2">Erreurs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <ResultRow
                      label="Bibliothèque AGP"
                      count={state.result.library.processed}
                      errors={state.result.library.errors}
                    />
                    <ResultRow
                      label="Dossiers gagnés / perdus"
                      count={state.result.tenders.processed}
                      errors={state.result.tenders.errors}
                    />
                  </tbody>
                  <tfoot className="bg-muted/20 border-t">
                    <tr>
                      <td colSpan={3} className="px-4 py-2 text-xs text-muted-foreground">
                        Provider : {PROVIDER_LABEL[state.result.provider] ?? state.result.provider}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {(state.result.library.errors > 0 || state.result.tenders.errors > 0) && (
                <p className="text-sm text-rose-700">
                  Des erreurs sont survenues — voir les logs serveur pour le détail.
                  Vous pouvez relancer le backfill : les items déjà embeddés seront reconstruits proprement.
                </p>
              )}

              {state.result.library.processed === 0 && state.result.tenders.processed === 0 && (
                <p className="text-sm text-amber-700">
                  Aucun item traité — vérifiez que des items bibliothèque existent et que des dossiers sont marqués gagné ou perdu.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
