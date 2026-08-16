'use client'

import { useEffect, useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { fetchInteractionDetail, setInteractionCauseDiagnostic, setInteractionAnswerQuality } from './actions'
import type { CopilotInteractionDetail } from '@/lib/db/copilot-interactions-read'
import type { CopilotCauseDiagnostic, CopilotAnswerQuality } from '@/lib/db/copilot-telemetry'

const CAUSE_OPTIONS: { value: CopilotCauseDiagnostic; label: string }[] = [
  { value: 'stt_error', label: 'Erreur STT' },
  { value: 'normalization_error', label: 'Erreur de normalisation' },
  { value: 'routing_error', label: 'Mauvais routage' },
  { value: 'retrieval_gap', label: 'Donnée non récupérée (retrieval)' },
  { value: 'missing_relation', label: 'Relation manquante' },
  { value: 'missing_entity', label: 'Entité absente' },
  { value: 'missing_data', label: 'Donnée absente' },
  { value: 'conflicting_data', label: 'Donnée contradictoire' },
  { value: 'answer_generation_error', label: 'Erreur de génération' },
  { value: 'other', label: 'Autre' },
]

const ANSWER_QUALITY_OPTIONS: { value: CopilotAnswerQuality; label: string; color: string }[] = [
  { value: 'correct', label: 'Correcte', color: 'bg-green-100 text-green-800' },
  { value: 'incomplete', label: 'Incomplète', color: 'bg-amber-100 text-amber-800' },
  { value: 'incorrect', label: 'Incorrecte', color: 'bg-red-100 text-red-800' },
]

interface Props {
  interactionId: string | null
  onClose: () => void
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

function answerStatusColor(s: string | null) {
  if (s === 'answered') return 'bg-green-100 text-green-800'
  if (s === 'not_found') return 'bg-red-100 text-red-800'
  if (s === 'ambiguous') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

function answerModeColor(m: string | null) {
  if (m === 'llm') return 'bg-violet-100 text-violet-800'
  if (m === 'deterministic_fallback') return 'bg-sky-100 text-sky-800'
  if (m === 'clarification') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm border-b last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? <span className="italic text-muted-foreground/60">—</span>}</span>
    </div>
  )
}

export function InteractionDrawer({ interactionId, onClose }: Props) {
  const [detail, setDetail] = useState<CopilotInteractionDetail | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isSavingCause, startCauseTransition] = useTransition()
  const [isSavingQuality, startQualityTransition] = useTransition()
  const [commentDraft, setCommentDraft] = useState('')

  useEffect(() => {
    if (!interactionId) { setDetail(null); return }
    startTransition(async () => {
      const d = await fetchInteractionDetail(interactionId)
      setDetail(d)
      setCommentDraft(d?.feedbackComment ?? '')
    })
  }, [interactionId])

  function saveCause(cause: CopilotCauseDiagnostic) {
    if (!interactionId) return
    startCauseTransition(async () => {
      await setInteractionCauseDiagnostic(interactionId, cause)
      setDetail((prev) => (prev ? { ...prev, causeDiagnostic: cause } : prev))
    })
  }

  function saveQuality(quality: CopilotAnswerQuality) {
    if (!interactionId) return
    startQualityTransition(async () => {
      await setInteractionAnswerQuality(interactionId, quality, commentDraft || null)
      setDetail((prev) => (prev ? { ...prev, answerQuality: quality, feedbackComment: commentDraft || null } : prev))
    })
  }

  function saveCommentOnly() {
    if (!interactionId || !d?.answerQuality) return
    startQualityTransition(async () => {
      await setInteractionAnswerQuality(interactionId, d.answerQuality as CopilotAnswerQuality, commentDraft || null)
      setDetail((prev) => (prev ? { ...prev, feedbackComment: commentDraft || null } : prev))
    })
  }

  const d = detail

  return (
    <Sheet open={!!interactionId} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base">Détail de l&apos;interaction</SheetTitle>
        </SheetHeader>

        {isPending && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Chargement…</div>
        )}

        {!isPending && !d && interactionId && (
          <div className="py-8 text-center text-sm text-muted-foreground italic">Interaction introuvable.</div>
        )}

        {!isPending && d && (
          <div className="space-y-6 text-sm">
            {/* Question */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Question</p>
              <p className="rounded bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">{d.question}</p>
            </section>

            {/* Réponse */}
            {d.answerText && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Réponse</p>
                <p className="rounded bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">{d.answerText}</p>
              </section>
            )}

            {/* Transcription vocale (audit STT) */}
            {(d.transcriptionRaw || d.sttRoute) && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Transcription brute (STT)</p>
                {d.sttRoute && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge label={d.sttRoute} color="bg-slate-100 text-slate-700" />
                    {d.transcriptionAbstentions != null && d.transcriptionAbstentions > 0 && (
                      <Badge label={`${d.transcriptionAbstentions} abstention(s)`} color="bg-amber-100 text-amber-800" />
                    )}
                  </div>
                )}
                {d.transcriptionRaw && (
                  <p className="rounded bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap italic text-muted-foreground">{d.transcriptionRaw}</p>
                )}
                {d.transcriptionCorrections.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.transcriptionCorrections.map((c, i) => (
                      <span key={i} className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        {c.from} → {c.to}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Retour humain — marque qualité + correction/note (brique 2) */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Retour humain</p>
              <div className="flex gap-1.5 mb-2">
                {ANSWER_QUALITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    disabled={isSavingQuality}
                    onClick={() => saveQuality(o.value)}
                    className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${
                      d.answerQuality === o.value ? o.color : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full rounded border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                rows={2}
                placeholder="Correction ou note libre…"
                value={commentDraft}
                disabled={isSavingQuality}
                onChange={(e) => setCommentDraft(e.target.value)}
                onBlur={saveCommentOnly}
              />
            </section>

            {/* Cause — classification manuelle (brique 2) */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Cause diagnostiquée</p>
              <select
                className="w-full rounded border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                value={d.causeDiagnostic ?? ''}
                disabled={isSavingCause}
                onChange={(e) => saveCause(e.target.value as CopilotCauseDiagnostic)}
              >
                <option value="" disabled>— non classée —</option>
                {CAUSE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </section>

            {/* Métadonnées */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Métadonnées</p>
              <div className="rounded border divide-y text-sm">
                <Row label="Date" value={new Date(d.createdAt).toLocaleString('fr-FR')} />
                <Row label="Site" value={d.siteName ?? d.siteId} />
                <Row label="Utilisateur" value={d.userEmail ?? d.userId} />
                <Row label="Conversation" value={d.conversationId} />
                <Row label="Mode" value={
                  <Badge label={d.conversationMode === 'guided' ? 'Guidé' : 'Libre'} color="bg-slate-100 text-slate-700" />
                } />
                {d.guidedIntent && <Row label="Intent guidé" value={d.guidedIntent} />}
                <Row label="Intent principal" value={d.primaryIntent} />
                {d.secondaryIntents.length > 0 && (
                  <Row label="Intents secondaires" value={d.secondaryIntents.join(', ')} />
                )}
                <Row label="Scope" value={d.scope} />
                <Row label="Mode réponse" value={
                  d.answerMode ? <Badge label={d.answerMode} color={answerModeColor(d.answerMode)} /> : null
                } />
                <Row label="Statut réponse" value={
                  d.answerStatus ? <Badge label={d.answerStatus} color={answerStatusColor(d.answerStatus)} /> : null
                } />
                <Row label="Fallback" value={d.usedFallback ? 'Oui' : 'Non'} />
                <Row label="Références citées" value={d.citedReferenceCount} />
                <Row label="Clics références" value={d.referenceClicks} />
                <Row label="Latence" value={d.latencyMs != null ? `${d.latencyMs} ms` : null} />
              </div>
            </section>

            {/* Sources */}
            {d.sourcesUsed.length > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Sources chargées</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.sourcesUsed.map((s) => (
                    <span key={s} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{s}</span>
                  ))}
                </div>
              </section>
            )}

            {/* Sujets résolus */}
            {d.resolvedSubjectIds.length > 0 && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Sujets résolus</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.resolvedSubjectIds.map((id) => (
                    <span key={id} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{id.slice(0, 8)}…</span>
                  ))}
                </div>
              </section>
            )}

            {/* Proposition */}
            {d.proposalKind && (
              <section>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Proposition</p>
                <div className="rounded border divide-y text-sm">
                  <Row label="Type" value={d.proposalKind} />
                  <Row label="Statut" value={d.proposalStatus} />
                  <Row label="ID proposition" value={
                    d.proposalId ? <span className="font-mono text-xs">{d.proposalId}</span> : null
                  } />
                </div>
              </section>
            )}

            {/* Technique */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Technique</p>
              <div className="rounded border divide-y text-sm">
                <Row label="Modèle" value={d.model} />
                <Row label="Version prompt" value={d.promptVersion} />
                <Row label="Tokens entrée" value={d.inputTokens ? d.inputTokens.toLocaleString('fr-FR') : null} />
                <Row label="Tokens sortie" value={d.outputTokens ? d.outputTokens.toLocaleString('fr-FR') : null} />
                <Row label="Coût estimé" value={
                  d.estimatedCostEur
                    ? `${(d.estimatedCostEur * 119.33).toFixed(4)} XPF`
                    : null
                } />
                {d.routingDiag && (
                  <>
                    <Row label="Détection (det)" value={d.routingDiag.det} />
                    <Row label="Intent fusionné" value={d.routingDiag.merged} />
                    <Row label="Famille" value={d.routingDiag.family} />
                    <Row label="Appliqué" value={d.routingDiag.applied} />
                    <Row label="Contexte (car.)" value={d.routingDiag.contextChars} />
                    <Row label="Finish reason" value={d.routingDiag.finishReason} />
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
