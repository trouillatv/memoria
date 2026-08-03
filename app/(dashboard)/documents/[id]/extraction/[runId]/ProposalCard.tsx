'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { acceptProposalAction, editProposalAction, rejectProposalAction, resetProposalAction, updatePersonAttendanceAction } from './review-actions'
import type { DbDocumentExtractionProposal, DbDocumentExtractionEvidence, DocumentEvidenceRelationType } from '@/types/db'

// ─── Labels ──────────────────────────────────────────────────────────────────

const FAMILY_LABEL: Record<string, string> = {
  reservation: 'Réserve', action: 'Action', decision: 'Décision',
  observation: 'Observation', deadline: 'Échéance', knowledge_fact: 'Mémoire',
  person: 'Personne', company: 'Entreprise',
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'À examiner', className: 'bg-muted text-muted-foreground' },
  accepted: { label: 'Acceptée', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  edited: { label: 'Modifiée', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  rejected: { label: 'Refusée', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  materialized: { label: 'Matérialisée', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  failed: { label: 'Échouée', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
}

const RELATION_LABEL: Record<string, string> = {
  supports: 'Preuve', illustrates: 'Illustration', source: 'Source', candidate: 'À confirmer',
}

const FAMILY_OPTIONS = [
  { value: 'reservation', label: 'Réserve' },
  { value: 'action', label: 'Action' },
  { value: 'decision', label: 'Décision' },
  { value: 'observation', label: 'Observation' },
  { value: 'deadline', label: 'Échéance' },
  { value: 'knowledge_fact', label: 'Élément de mémoire' },
]

const ATTENDANCE_OPTIONS: Array<{ value: string; label: string; className: string }> = [
  { value: 'présent',             label: 'Présent',           className: 'border-green-400 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30' },
  { value: 'absent excusé',       label: 'Absent excusé',     className: 'border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30' },
  { value: 'absent non excusé',   label: 'Absent non excusé', className: 'border-red-400 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30' },
  { value: 'invité',              label: 'Invité',             className: 'border-blue-400 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30' },
  { value: 'diffusion uniquement',label: 'Diffusion',          className: 'border-slate-400 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-950/30' },
  { value: 'non déterminé',       label: 'Non déterminé',      className: 'border-muted-foreground/40 text-muted-foreground hover:bg-muted/60' },
]

const ATTENDANCE_ACTIVE: Record<string, string> = {
  'présent':             'bg-green-100 border-green-500 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'absent excusé':       'bg-amber-100 border-amber-500 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'absent non excusé':   'bg-red-100 border-red-500 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'invité':              'bg-blue-100 border-blue-500 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'diffusion uniquement':'bg-slate-100 border-slate-500 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  'non déterminé':       'bg-muted border-muted-foreground/40 text-muted-foreground',
}

// ─── Preuve individuelle ─────────────────────────────────────────────────────

function EvidenceItem({
  evidence,
  relationType,
  signedUrls,
}: {
  evidence: DbDocumentExtractionEvidence
  relationType: DocumentEvidenceRelationType
  signedUrls: Record<string, string>
}) {
  const isCandidate = relationType === 'candidate'
  const imgUrl = signedUrls[evidence.id]
  const excerptText = (evidence.metadata as { text?: string } | null)?.text

  return (
    <div className={`rounded border p-2 text-xs space-y-1 ${isCandidate ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20' : 'bg-muted/40'}`}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-muted-foreground">Page {evidence.source_page}</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] ${isCandidate ? 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100' : 'bg-muted text-muted-foreground'}`}>
          {isCandidate ? 'Association à confirmer' : (RELATION_LABEL[relationType] ?? relationType)}
        </span>
      </div>
      {evidence.caption && evidence.caption.length >= 15 && evidence.caption.includes(' ') && (
        <p className="text-muted-foreground italic">{evidence.caption}</p>
      )}
      {excerptText && (
        <blockquote className="border-l-2 border-muted pl-2 text-muted-foreground line-clamp-3">
          {excerptText}
        </blockquote>
      )}
      {evidence.nearby_text && (
        <p className="text-muted-foreground line-clamp-2">{evidence.nearby_text}</p>
      )}
      {imgUrl && (
        <a href={imgUrl} target="_blank" rel="noopener noreferrer" className="block mt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={evidence.caption ?? `Page ${evidence.source_page}`}
            className="max-h-32 rounded border object-contain"
          />
        </a>
      )}
    </div>
  )
}

// ─── ProposalCard ────────────────────────────────────────────────────────────

type ConfirmedPhoto = {
  evidenceId: string
  caption: string | null
  isPinned: boolean
  isPinPending: boolean
}

export function ProposalCard({
  proposal,
  evidence,
  signedUrls,
  documentId,
  siteSubjects,
  confirmedPhotos = [],
  onPinToggle,
}: {
  proposal: DbDocumentExtractionProposal
  evidence: Array<{ evidence: DbDocumentExtractionEvidence; relationType: DocumentEvidenceRelationType; confidence: number | null }>
  signedUrls: Record<string, string>
  documentId: string
  siteSubjects?: Array<{ id: string; name: string }>
  confirmedPhotos?: ConfirmedPhoto[]
  onPinToggle?: (evidenceId: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [mode, setMode] = useState<'view' | 'editing'>('view')

  // Statut local optimiste — synchronisé depuis les props RSC après router.refresh()
  const [localStatus, setLocalStatus] = useState(proposal.review_status)
  useEffect(() => { setLocalStatus(proposal.review_status) }, [proposal.review_status])
  // Sujet canonique choisi pour cette décision (optionnel, decision uniquement)
  const [localSubjectId, setLocalSubjectId] = useState<string | null>(null)
  const [subjectSearch, setSubjectSearch] = useState('')
  // Valeurs affichées (mises à jour après edit réussi)
  const [displayLabel, setDisplayLabel] = useState(proposal.reviewed_label ?? proposal.label)
  const [displayDescription, setDisplayDescription] = useState(proposal.reviewed_description ?? proposal.description)
  const [displayFamily, setDisplayFamily] = useState(proposal.reviewed_family ?? proposal.proposal_family)

  // Champs du formulaire d'édition
  const [editLabel, setEditLabel] = useState(displayLabel)
  const [editDescription, setEditDescription] = useState(displayDescription ?? '')
  const [editFamily, setEditFamily] = useState(displayFamily)

  const statusBadge = STATUS_BADGE[localStatus] ?? STATUS_BADGE.pending
  const isMaterialized = localStatus === 'materialized'

  function startEditing() {
    setEditLabel(displayLabel)
    setEditDescription(displayDescription ?? '')
    setEditFamily(displayFamily)
    setMode('editing')
    setMsg(null)
  }

  function handleAction(action: () => Promise<{ ok: boolean; error?: string }>, onSuccess: () => void) {
    setMsg(null)
    startTransition(async () => {
      const r = await action()
      if (r.ok) {
        onSuccess()
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? 'Échec' })
      }
    })
  }

  function onAccept() {
    const fd = new FormData()
    fd.set('proposal_id', proposal.id)
    fd.set('document_id', documentId)
    if (localSubjectId) fd.set('subject_id', localSubjectId)
    handleAction(() => acceptProposalAction(fd), () => {
      setLocalStatus('accepted')
      setMsg({ ok: true, text: localSubjectId ? 'Acceptée et liée au sujet' : 'Acceptée' })
    })
  }

  function onReject() {
    const fd = new FormData()
    fd.set('proposal_id', proposal.id)
    fd.set('document_id', documentId)
    handleAction(() => rejectProposalAction(fd), () => {
      setLocalStatus('rejected')
      setMsg({ ok: true, text: 'Refusée' })
    })
  }

  function onReset() {
    const fd = new FormData()
    fd.set('proposal_id', proposal.id)
    fd.set('document_id', documentId)
    handleAction(() => resetProposalAction(fd), () => {
      setLocalStatus('pending')
      setMsg({ ok: true, text: 'Remise à examiner' })
    })
  }

  function onSave() {
    if (!editLabel.trim()) return
    const fd = new FormData()
    fd.set('proposal_id', proposal.id)
    fd.set('document_id', documentId)
    fd.set('label', editLabel.trim())
    fd.set('description', editDescription)
    fd.set('family', editFamily)
    handleAction(() => editProposalAction(fd), () => {
      setDisplayLabel(editLabel.trim())
      setDisplayDescription(editDescription || null)
      setDisplayFamily(editFamily)
      setLocalStatus('edited')
      setMode('view')
      setMsg({ ok: true, text: 'Modifications enregistrées' })
    })
  }

  const sourcePayload = proposal.source_payload as {
    statusAtDocumentDate?: string
    linkedCompanyName?: string | null
    dueDate?: string
    responsibleParty?: string
    relevanceScore?: 'strong' | 'medium' | 'weak'
    relevanceReason?: string
  } | null
  const relevanceScore = sourcePayload?.relevanceScore ?? null

  const isPerson = proposal.proposal_family === 'person'
  const [localAttendance, setLocalAttendance] = useState<string>(
    sourcePayload?.statusAtDocumentDate?.toLowerCase() ?? 'non déterminé'
  )
  const isAttendanceConfirmed = localStatus === 'edited' || localStatus === 'accepted' || localStatus === 'materialized'

  function onUpdateAttendance(status: string) {
    const fd = new FormData()
    fd.set('proposal_id', proposal.id)
    fd.set('document_id', documentId)
    fd.set('attendance_status', status)
    handleAction(() => updatePersonAttendanceAction(fd), () => {
      setLocalAttendance(status)
      setLocalStatus('edited')
    })
  }

  return (
    <article className="rounded-[18px] border bg-card p-4 space-y-3 shadow-sm">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {FAMILY_LABEL[displayFamily] ?? displayFamily}
          </span>
          {proposal.source_page && (
            <span className="text-xs text-muted-foreground">Page {proposal.source_page}</span>
          )}
          {relevanceScore === 'strong' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" title={sourcePayload?.relevanceReason ?? undefined}>
              Prioritaire
            </span>
          )}
          {relevanceScore === 'weak' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground/60 border border-dashed" title={sourcePayload?.relevanceReason ?? undefined}>
              Faible
            </span>
          )}
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge.className}`}>
          {statusBadge.label}
        </span>
      </div>

      {/* Contenu extrait vs corrigé */}
      {mode === 'view' ? (
        <div className="space-y-1">
          <p className="font-semibold leading-snug">{displayLabel}</p>
          {displayDescription && (
            <p className="text-sm text-muted-foreground">{displayDescription}</p>
          )}
          {localStatus === 'edited' && (proposal.reviewed_label !== proposal.label || proposal.reviewed_family !== proposal.proposal_family) && (
            <details className="mt-1">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
                Voir le contenu extrait original
              </summary>
              <div className="mt-1 pl-3 border-l-2 border-muted text-xs text-muted-foreground space-y-0.5">
                <p>Libellé : {proposal.label}</p>
                {proposal.description && <p>Description : {proposal.description}</p>}
                <p>Famille : {FAMILY_LABEL[proposal.proposal_family] ?? proposal.proposal_family}</p>
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Famille</label>
            <select
              value={editFamily}
              onChange={(e) => setEditFamily(e.target.value)}
              disabled={pending}
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            >
              {FAMILY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Libellé</label>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              disabled={pending}
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Libellé de la proposition"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={pending}
              rows={2}
              className="w-full rounded border bg-background px-2 py-1.5 text-sm resize-none"
              placeholder="Description (optionnelle)"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Contenu extrait conservé en base — seule la version retenue change.
          </p>
        </div>
      )}

      {/* Statut de présence — section dédiée pour les personnes */}
      {isPerson && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">Statut de présence</span>
            {!isAttendanceConfirmed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                IA · à confirmer
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${ATTENDANCE_ACTIVE[localAttendance] ?? ATTENDANCE_ACTIVE['non déterminé']}`}>
              {ATTENDANCE_OPTIONS.find((o) => o.value === localAttendance)?.label ?? localAttendance}
            </span>
          </div>
          {!isMaterialized && (
            <div className="flex flex-wrap gap-1.5">
              {ATTENDANCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onUpdateAttendance(opt.value)}
                  disabled={pending}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                    localAttendance === opt.value
                      ? ATTENDANCE_ACTIVE[opt.value] ?? ''
                      : `bg-transparent ${opt.className}`
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source */}
      {(proposal.source_excerpt || (sourcePayload && !isPerson)) && (
        <details>
          <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
            Source documentaire
          </summary>
          <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-muted">
            {proposal.source_excerpt && (
              <blockquote className="text-xs text-muted-foreground italic">
                « {proposal.source_excerpt} »
              </blockquote>
            )}
            {sourcePayload?.dueDate && (
              <p className="text-xs text-muted-foreground">
                Échéance : <span className="font-medium">{sourcePayload.dueDate}</span>
              </p>
            )}
            {sourcePayload?.responsibleParty && (
              <p className="text-xs text-muted-foreground">
                Responsable : <span className="font-medium">{sourcePayload.responsibleParty}</span>
              </p>
            )}
          </div>
        </details>
      )}

      {/* Preuves */}
      {evidence.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{evidence.length} preuve{evidence.length > 1 ? 's' : ''}</p>
          <div className="space-y-1.5">
            {evidence.map((ev) => (
              <EvidenceItem
                key={ev.evidence.id}
                evidence={ev.evidence}
                relationType={ev.relationType}
                signedUrls={signedUrls}
              />
            ))}
          </div>
        </div>
      )}

      {/* Photos illustrant cette proposition */}
      {confirmedPhotos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            📷 {confirmedPhotos.length} photo{confirmedPhotos.length > 1 ? 's' : ''} illustr{confirmedPhotos.length > 1 ? 'ent' : 'e'} cette observation
          </p>
          <div className="flex flex-wrap gap-2">
            {confirmedPhotos.map((photo) => {
              const url = signedUrls[photo.evidenceId]
              return (
                <div key={photo.evidenceId} className="space-y-0.5">
                  <div className="relative group">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={photo.caption ?? 'Photo'}
                          className="h-20 w-20 rounded border object-cover"
                        />
                      </a>
                    ) : (
                      <div className="h-20 w-20 rounded border bg-muted/40 flex items-center justify-center text-muted-foreground text-xs">
                        📷
                      </div>
                    )}
                  </div>
                  {onPinToggle && (
                    <button
                      type="button"
                      onClick={() => onPinToggle(photo.evidenceId)}
                      disabled={photo.isPinPending}
                      className={`w-full rounded px-1 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                        photo.isPinned
                          ? 'bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-300'
                          : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
                      }`}
                    >
                      {photo.isPinPending ? '…' : photo.isPinned ? 'Incluse' : 'Inclure'}
                    </button>
                  )}
                  {photo.caption && photo.caption.length >= 15 && photo.caption.includes(' ') && (
                    <p className="text-[10px] text-muted-foreground max-w-[80px] truncate" title={`IA · ${photo.caption}`}>
                      <span className="opacity-60">IA ·</span> {photo.caption}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sujet canonique — uniquement pour les décisions, avant matérialisation */}
      {!isMaterialized && displayFamily === 'decision' && siteSubjects && siteSubjects.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Sujet concerné (optionnel)</p>
          {localSubjectId ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground/90">
                {siteSubjects.find((s) => s.id === localSubjectId)?.name ?? localSubjectId}
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => { setLocalSubjectId(null); setSubjectSearch('') }}
              >
                Changer
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <input
                type="text"
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                placeholder="Rechercher un sujet…"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {subjectSearch.trim().length > 0 && (() => {
                const filtered = siteSubjects.filter((s) => s.name.toLowerCase().includes(subjectSearch.toLowerCase())).slice(0, 8)
                if (filtered.length === 0) return <p className="text-xs text-muted-foreground px-1">Aucun sujet trouvé.</p>
                return (
                  <ul className="rounded-md border border-border bg-background shadow-sm divide-y divide-border max-h-40 overflow-y-auto">
                    {filtered.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                          onClick={() => { setLocalSubjectId(s.id); setSubjectSearch('') }}
                        >
                          {s.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* Boutons d'action */}
      {!isMaterialized && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {mode === 'editing' ? (
            <>
              <Button type="button" size="sm" onClick={onSave} disabled={pending || !editLabel.trim()}>
                {pending ? '…' : 'Enregistrer'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode('view')} disabled={pending}>
                Annuler
              </Button>
            </>
          ) : localStatus === 'rejected' ? (
            <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={pending}>
              {pending ? '…' : 'Réexaminer'}
            </Button>
          ) : (
            <>
              {localStatus !== 'accepted' && (
                <Button type="button" size="sm" onClick={onAccept} disabled={pending}>
                  {pending ? '…' : 'Accepter'}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={startEditing} disabled={pending}>
                Modifier
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                {pending ? '…' : 'Refuser'}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Feedback */}
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
          {msg.text}
        </p>
      )}
    </article>
  )
}
