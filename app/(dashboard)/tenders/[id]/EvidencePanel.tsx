import Link from 'next/link'
import { Sparkles, FileCheck, Image as ImageIcon, AlertTriangle, MapPin } from 'lucide-react'
import { findSimilarEngagementsForMemo, getEvidenceForEngagements } from '@/lib/db/engagements'
import type { DbEngagement, EngagementEvidence } from '@/types/db'
import { InsertEvidenceButton } from './InsertEvidenceButton'

interface EvidencePanelProps {
  tenderId: string
  memoireText: string | null
  matchThreshold?: number // default 0.25
  maxMatches?: number // default 8
}

function formatDuration(days: number | null): string | null {
  if (!days) return null
  if (days < 30) return `${days} jours`
  if (days < 365) return `${Math.round(days / 30)} mois`
  const years = Math.floor(days / 365)
  const months = Math.round((days % 365) / 30)
  if (months === 0) return `${years} an${years > 1 ? 's' : ''}`
  return `${years} an${years > 1 ? 's' : ''} ${months} mois`
}

export async function EvidencePanel({
  tenderId,
  memoireText,
  matchThreshold = 0.25,
  maxMatches = 8,
}: EvidencePanelProps) {
  // No memoire to match against → empty state
  if (!memoireText || memoireText.trim().length < 50) {
    return (
      <aside className="rounded-lg border bg-card p-4">
        <header className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">Évidence disponible</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          Une fois la mémoire technique générée, les engagements similaires de vos
          contrats passés apparaîtront ici.
        </p>
      </aside>
    )
  }

  // Find similar engagements (chunked memo → max similarity per engagement)
  const matches = await findSimilarEngagementsForMemo({
    memo: memoireText,
    excludeTenderId: tenderId,
    threshold: matchThreshold,
    limit: maxMatches,
  })

  if (matches.length === 0) {
    return (
      <aside className="rounded-lg border bg-card p-4">
        <header className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">Évidence disponible</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          Aucun engagement similaire trouvé dans vos contrats passés. Plus vous
          accumulerez de contrats, plus cette section deviendra riche.
        </p>
      </aside>
    )
  }

  // Get evidence stats for matched engagements (batch query)
  const evidenceMap = await getEvidenceForEngagements(matches.map((m) => m.engagement.id))

  // Filter: keep only matches WITH actual evidence (executed interventions > 0)
  // This avoids showing "0 photos, 0 interventions" matches which would be misleading
  const richMatches = matches.filter((m) => {
    const ev = evidenceMap.get(m.engagement.id)
    return ev && ev.interventionsExecuted > 0
  })

  // Detect engagements already inserted in the memoire via marker scan
  const alreadyInsertedSet = new Set<string>()
  if (memoireText) {
    const markerRegex = /<!-- ref: engagement:([0-9a-f-]+) -->/gi
    let match: RegExpExecArray | null
    while ((match = markerRegex.exec(memoireText)) !== null) {
      alreadyInsertedSet.add(match[1])
    }
  }

  if (richMatches.length === 0) {
    return (
      <aside className="rounded-lg border bg-card p-4">
        <header className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">Évidence disponible</h2>
        </header>
        <p className="text-xs text-muted-foreground">
          Des engagements similaires existent dans vos contrats passés, mais sans
          preuves d&apos;exécution suffisantes encore.
        </p>
      </aside>
    )
  }

  return (
    <aside className="space-y-3">
      <header className="flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold">Évidence disponible</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {richMatches.length}
        </span>
      </header>
      <p className="text-xs text-muted-foreground italic px-1">
        Engagements similaires détectés dans vos contrats passés.
      </p>

      <ul className="space-y-3">
        {richMatches.map((m) => (
          <EvidenceCard
            key={m.engagement.id}
            engagement={m.engagement}
            similarity={m.similarity}
            evidence={evidenceMap.get(m.engagement.id)!}
            tenderId={tenderId}
            alreadyInsertedSet={alreadyInsertedSet}
          />
        ))}
      </ul>
    </aside>
  )
}

function EvidenceCard({
  engagement,
  similarity,
  evidence,
  tenderId,
  alreadyInsertedSet,
}: {
  engagement: DbEngagement
  similarity: number
  evidence: EngagementEvidence
  tenderId: string
  alreadyInsertedSet: Set<string>
}) {
  const durationLabel = formatDuration(evidence.durationDays)
  const similarityPercent = Math.round(similarity * 100)
  const anomaliesTotal = evidence.anomaliesResolved + evidence.anomaliesOpen

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="min-w-0 mb-2">
        <div className="text-sm font-semibold mb-0.5 line-clamp-2">
          {engagement.short_label}
        </div>
        <div className="text-[11px] text-muted-foreground italic line-clamp-2">
          « {engagement.source_excerpt} »
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs my-3">
        <div className="flex items-center gap-1.5">
          <FileCheck className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium tabular-nums">{evidence.interventionsExecuted}</span>
          <span className="text-muted-foreground">
            intervention{evidence.interventionsExecuted > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium tabular-nums">{evidence.photosCount}</span>
          <span className="text-muted-foreground">
            photo{evidence.photosCount > 1 ? 's' : ''}
          </span>
        </div>
        {anomaliesTotal > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium tabular-nums">{anomaliesTotal}</span>
            <span className="text-muted-foreground">
              anomalie{anomaliesTotal > 1 ? 's' : ''}
            </span>
          </div>
        )}
        {durationLabel && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">⏱</span>
            <span className="text-muted-foreground">{durationLabel}</span>
          </div>
        )}
      </dl>

      {evidence.contractNames.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground mb-3">
          <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="line-clamp-2">{evidence.contractNames.join(' · ')}</span>
        </div>
      )}

      {/* Insert button — Slice 4.3 : server action + backlink */}
      <div className="flex items-center gap-2">
        <InsertEvidenceButton
          tenderId={tenderId}
          engagementId={engagement.id}
          alreadyInserted={alreadyInsertedSet.has(engagement.id)}
        />
        {evidence.contractIds[0] && (
          <Link
            href={`/contracts/${evidence.contractIds[0]}`}
            className="inline-flex items-center px-2 py-1.5 rounded border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50"
            title="Voir le contrat source"
          >
            Source →
          </Link>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground italic mt-2">
        Proximité avec votre mémoire : {similarityPercent}%
      </div>
    </li>
  )
}
