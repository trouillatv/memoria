import Link from 'next/link'
import { ArrowRight, Mic } from 'lucide-react'
import type {
  TenderMemoryEntry as Entry,
} from '@/lib/db/tenders'
import type { TenderOutcome, TenderOutcomeTag } from '@/types/db'

const OUTCOME_LABELS: Record<Exclude<TenderOutcome, 'pending'>, string> = {
  won: 'Gagné',
  lost: 'Perdu',
  withdrawn: 'Retiré',
  not_responded: 'Sans réponse',
}

const OUTCOME_STYLES: Record<Exclude<TenderOutcome, 'pending'>, string> = {
  won:           'bg-emerald-50 border-emerald-200 text-emerald-800',
  lost:          'bg-amber-50   border-amber-200   text-amber-800',
  withdrawn:     'bg-slate-50   border-slate-200   text-slate-700',
  not_responded: 'bg-slate-50   border-slate-200   text-slate-600',
}

const TAG_LABELS: Record<TenderOutcomeTag, string> = {
  prix: 'prix',
  qualite: 'qualité',
  relation: 'relation',
  timing: 'timing',
  autre: 'autre',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatVoiceNoteDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}min`
  return `${m}min${s.toString().padStart(2, '0')}`
}

/**
 * Une ligne du journal /tenders/memoire.
 * Doctrine V5 verrou V1 + V4 : descriptif passive uniquement.
 * Aucune formulation d'injonction, de jugement, de comparaison.
 */
export function TenderMemoryEntry({ entry }: { entry: Entry }) {
  // L'enum DB autorise 'pending' mais le helper le filtre — on guarde quand même.
  const outcome = entry.outcome === 'pending' ? null : entry.outcome
  if (!outcome) return null

  const showTag = outcome === 'lost' && entry.outcome_tag

  return (
    <li>
      <Link
        href={`/tenders/${entry.id}`}
        className="flex items-start gap-3 px-6 py-3 hover:bg-muted/30 transition-colors group"
        data-testid="tender-memory-entry"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${OUTCOME_STYLES[outcome]}`}
              data-testid="tender-memory-outcome"
            >
              {OUTCOME_LABELS[outcome]}
            </span>
            {showTag && entry.outcome_tag && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 border text-muted-foreground"
                data-testid="tender-memory-tag"
              >
                {TAG_LABELS[entry.outcome_tag]}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDate(entry.outcome_at)}
            </span>
            {entry.voice_note_path && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                data-testid="tender-memory-voice-note"
              >
                <Mic className="h-3 w-3" aria-hidden="true" />
                Note vocale
                {entry.voice_note_duration_seconds
                  ? ` · ${formatVoiceNoteDuration(entry.voice_note_duration_seconds)}`
                  : ''}
              </span>
            )}
          </div>
          <div className="text-sm font-medium mb-0.5">{entry.title}</div>
          {entry.client_name && (
            <div className="text-xs text-muted-foreground mb-1">
              {entry.client_name}
            </div>
          )}
          {entry.outcome_reason && (
            <div
              className="text-xs text-muted-foreground italic mt-1.5 line-clamp-2"
              data-testid="tender-memory-reason"
            >
              «&nbsp;{entry.outcome_reason}&nbsp;»
            </div>
          )}
        </div>
        <ArrowRight
          className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground shrink-0 mt-1"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
