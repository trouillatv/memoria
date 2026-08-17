'use client'

import { useState } from 'react'
import { Loader2, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { createCopilotAction, addCopilotToBriefing, createCopilotScheduledEvent, createCopilotObservation, createCopilotActorAlias } from '@/app/(dashboard)/sites/[id]/copilot-write-action'
import { trackCopilotProposalCancelled } from '@/app/(dashboard)/sites/[id]/copilot-event-action'
import type { CopilotProposal } from '@/lib/visits/copilot-proposal'
import { cn } from '@/lib/utils'

// ── Badges confiance ──────────────────────────────────────────────────────────

const CONFIDENCE_LABELS: Record<CopilotProposal['confidence'], string> = {
  strong:     'Je recommande fortement',
  medium:     'Je recommande',
  suggestion: 'Suggestion',
}
const CONFIDENCE_CLASSES: Record<CopilotProposal['confidence'], string> = {
  strong:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  medium:     'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  suggestion: 'bg-muted text-muted-foreground',
}

// ── ProposalCard — action / visit_item ────────────────────────────────────────

export function ProposalCard({
  siteId,
  proposal,
  interactionId,
  onDone,
  onPlanChange,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  onDone: (successText: string) => void
  onPlanChange?: () => void
}) {
  const [title, setTitle]       = useState(proposal.title)
  const [body, setBody]         = useState(proposal.body ?? '')
  const [whyOpen, setWhyOpen]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
  }

  async function confirm() {
    if (saving || !title.trim()) return
    setSaving(true)
    try {
      if (proposal.kind === 'action') {
        const res = await createCopilotAction({
          siteId,
          title: title.trim(),
          body: body.trim() || null,
          canonicalSubjectId: proposal.canonicalSubjectId,
          copilotProposalId: proposal.proposalId,
          llmModel: proposal.llmModel,
          promptVersion: proposal.promptVersion,
          interactionId,
        })
        onDone(res.ok ? 'Action créée.' : `Erreur : ${res.error}`)
      } else {
        const res = await addCopilotToBriefing({
          siteId,
          label: title.trim(),
          canonicalSubjectId: proposal.canonicalSubjectId,
          copilotProposalId: proposal.proposalId,
          interactionId,
          reason: proposal.whyText,
        })
        if (res.ok) {
          onDone('Ajouté au plan de prochaine visite.')
          onPlanChange?.()
        } else {
          onDone(`Erreur : ${res.error}`)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const kindLabel = proposal.kind === 'action' ? 'Action' : 'Point de visite'

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CONFIDENCE_CLASSES[proposal.confidence])}>
          {CONFIDENCE_LABELS[proposal.confidence]}
        </span>
        <span className="text-[11px] text-muted-foreground">{kindLabel}</span>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      {proposal.kind === 'action' && (
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Détail (optionnel)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Précisions, contexte…"
            className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        {proposal.canonicalSubjectLabel && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Sujet suivi</span>
            <span className="font-medium">{proposal.canonicalSubjectLabel}</span>
          </div>
        )}
        {proposal.kind === 'action' && (
          <>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-28 shrink-0 text-muted-foreground">Responsable</span>
              <span className="italic text-muted-foreground">Non attribué</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-28 shrink-0 text-muted-foreground">Échéance</span>
              <span className="italic text-muted-foreground">Non définie</span>
            </div>
          </>
        )}
        {proposal.kind === 'visit_item' && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Priorité</span>
            <span className="italic text-muted-foreground">Normale</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Pourquoi cette proposition ?
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !title.trim()}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── ObservationProposalCard — constat terrain (P4-A) ──────────────────────────
//
// canonicalSubjectId est toujours résolu quand cette carte est affichée
// (copilot-free-prepare.ts ne construit ce brouillon qu'après résolution
// certaine — canonical_subject_occurrence.canonical_subject_id est NOT NULL
// en base). Le sujet n'est donc pas éditable ici : le corriger revient à
// annuler et reformuler la phrase avec le bon nom de sujet.

export function ObservationProposalCard({
  siteId,
  proposal,
  interactionId,
  onDone,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  onDone: (successText: string) => void
}) {
  const [title, setTitle]         = useState(proposal.title)
  const [body, setBody]           = useState(proposal.body ?? '')
  const [whyOpen, setWhyOpen]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
  }

  const canConfirm = !!title.trim() && !!body.trim() && !!proposal.canonicalSubjectId

  async function confirm() {
    if (saving || !canConfirm || !proposal.canonicalSubjectId) return
    setSaving(true)
    try {
      const res = await createCopilotObservation({
        siteId,
        canonicalSubjectId: proposal.canonicalSubjectId,
        label: title.trim(),
        body: body.trim() || null,
        copilotProposalId: proposal.proposalId,
        interactionId,
      })
      onDone(res.ok ? 'Constat enregistré.' : `Erreur : ${res.error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CONFIDENCE_CLASSES[proposal.confidence])}>
          {CONFIDENCE_LABELS[proposal.confidence]}
        </span>
        <span className="text-[11px] text-muted-foreground">Constat</span>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Constat</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={2000}
          className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        {proposal.canonicalSubjectLabel && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Sujet suivi</span>
            <span className="font-medium">{proposal.canonicalSubjectLabel}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-muted-foreground">Daté</span>
          <span className="italic text-muted-foreground">Aujourd'hui</span>
        </div>
        {proposal.observationTemporality && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Temporalité</span>
            <span className="font-medium">{proposal.observationTemporality}</span>
          </div>
        )}
        {proposal.observationActorLabel && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Acteur/objet</span>
            <span className="font-medium">{proposal.observationActorLabel}</span>
          </div>
        )}
      </div>

      {!proposal.canonicalSubjectId && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Aucun sujet résolu — reformulez en précisant l'élément concerné avant de valider.
        </p>
      )}

      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Pourquoi cette proposition ?
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !canConfirm}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── ScheduleProposalCard — schedule_visit / schedule_meeting ──────────────────

export function ScheduleProposalCard({
  siteId,
  proposal,
  interactionId,
  planItemCount,
  onDone,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  planItemCount: number
  onDone: (successText: string) => void
}) {
  const [title, setTitle]         = useState(proposal.title)
  const [date, setDate]           = useState(proposal.scheduledDate ?? '')
  const [time, setTime]           = useState(proposal.scheduledTime ?? '')
  const [objective, setObjective] = useState(proposal.scheduledObjective ?? '')
  const [whyOpen, setWhyOpen]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
  }

  const isVisit        = proposal.kind === 'schedule_visit'
  const typeLabel      = isVisit ? 'Visite' : 'Réunion'
  const objectiveLabel = isVisit ? 'Objectif' : 'Ordre du jour'
  const canConfirm     = !!title.trim() && !!date && !!time

  async function confirm() {
    if (saving || !canConfirm) return
    setSaving(true)
    try {
      const res = await createCopilotScheduledEvent({
        siteId,
        type: isVisit ? 'visit' : 'meeting',
        title: title.trim(),
        scheduledDate: date,
        scheduledTime: time,
        objective: objective.trim() || null,
        copilotProposalId: proposal.proposalId,
        interactionId,
      })
      onDone(res.ok ? `${typeLabel} planifiée.` : `Erreur : ${res.error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 px-2 py-0.5 text-[11px] font-medium">
          Planification
        </span>
        <span className="text-[11px] text-muted-foreground">{typeLabel}</span>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Titre</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-0.5">Heure (Nouméa)</label>
          <div className="flex items-center gap-1">
            <select
              value={time ? time.slice(0, 2) : ''}
              onChange={(e) => {
                const h = e.target.value
                const m = time ? time.slice(3, 5) : '00'
                setTime(h ? `${h}:${m}` : '')
              }}
              className="flex-1 rounded-lg border border-border bg-background px-1.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
            >
              <option value="">--</option>
              {Array.from({ length: 24 }, (_, i) => {
                const h = String(i).padStart(2, '0')
                return <option key={h} value={h}>{h}</option>
              })}
            </select>
            <span className="text-[13px] font-medium text-muted-foreground">h</span>
            <select
              value={time ? time.slice(3, 5) : ''}
              onChange={(e) => {
                const m = e.target.value
                const h = time ? time.slice(0, 2) : ''
                if (h && m) setTime(`${h}:${m}`)
              }}
              className="w-14 rounded-lg border border-border bg-background px-1.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
            >
              <option value="">--</option>
              {['00', '15', '30', '45'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">{objectiveLabel} (optionnel)</label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        {isVisit && planItemCount > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-muted-foreground">Plan de visite</span>
            <span className="font-medium">{planItemCount} point{planItemCount > 1 ? 's' : ''} prêt{planItemCount > 1 ? 's' : ''}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-muted-foreground">Fuseau</span>
          <span className="italic text-muted-foreground">Pacific/Nouméa (UTC+11)</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Détails
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !canConfirm}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── ActorAliasProposalCard — correspondance d'identité d'acteur (P4-B.2) ──────
//
// La cible (company/contact) est toujours déjà résolue avec certitude quand
// cette carte est affichée (copilot-free-prepare.ts ne construit ce brouillon
// qu'après resolveActorTarget → 'resolved') : elle n'est donc pas éditable.
// Seule `aliasNature` reste une proposition initiale modifiable par
// l'utilisateur avant confirmation.

const ALIAS_NATURE_LABELS: Record<'business_alias' | 'transcription_alias', string> = {
  business_alias: 'Autre nom métier (ex. surnom, nom d’usage)',
  transcription_alias: 'Variante de prononciation / transcription',
}

export function ActorAliasProposalCard({
  siteId,
  proposal,
  interactionId,
  onDone,
}: {
  siteId: string
  proposal: CopilotProposal
  interactionId: string | null
  onDone: (successText: string) => void
}) {
  const [nature, setNature]       = useState<'business_alias' | 'transcription_alias'>(proposal.aliasNature ?? 'business_alias')
  const [whyOpen, setWhyOpen]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [cancelled, setCancelled] = useState(false)

  if (cancelled) {
    return <p className="text-[12px] text-muted-foreground italic">Proposition annulée.</p>
  }

  const canConfirm = !!proposal.aliasText && !!proposal.aliasTargetKind && !!proposal.aliasTargetId

  async function confirm() {
    if (saving || !canConfirm || !proposal.aliasText || !proposal.aliasTargetKind || !proposal.aliasTargetId) return
    setSaving(true)
    try {
      const res = await createCopilotActorAlias({
        siteId,
        alias: proposal.aliasText,
        targetKind: proposal.aliasTargetKind,
        targetId: proposal.aliasTargetId,
        aliasNature: nature,
        copilotProposalId: proposal.proposalId,
        interactionId,
      })
      onDone(res.ok ? 'Correspondance mémorisée.' : `Erreur : ${res.error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', CONFIDENCE_CLASSES[proposal.confidence])}>
          {CONFIDENCE_LABELS[proposal.confidence]}
        </span>
        <span className="text-[11px] text-muted-foreground">Correspondance d'identité</span>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border text-[12px]">
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-muted-foreground">Nom utilisé</span>
          <span className="font-medium">{proposal.aliasText}</span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-muted-foreground">Désigne</span>
          <span className="font-medium">{proposal.aliasTargetLabel}</span>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-muted-foreground mb-0.5">Nature</label>
        <select
          value={nature}
          onChange={(e) => setNature(e.target.value as 'business_alias' | 'transcription_alias')}
          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-violet-400/40"
        >
          <option value="business_alias">{ALIAS_NATURE_LABELS.business_alias}</option>
          <option value="transcription_alias">{ALIAS_NATURE_LABELS.transcription_alias}</option>
        </select>
      </div>

      <button
        type="button"
        onClick={() => setWhyOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {whyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Pourquoi cette proposition ?
      </button>
      {whyOpen && (
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 border-l border-border">
          {proposal.whyText}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={confirm}
          disabled={saving || !canConfirm}
          className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-violet-600 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Valider
        </button>
        <button
          type="button"
          onClick={() => {
            setCancelled(true)
            if (interactionId) void trackCopilotProposalCancelled({ interactionId, siteId })
          }}
          disabled={saving}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}
