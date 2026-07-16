// ── LE VOCABULAIRE DE LA FICHE CHANTIER ──────────────────────────────────────
// Les mots que le conducteur lit à propos d'une visite et de sa synthèse — partagés
// par le bureau (onglet Aperçu) et le terrain (fiche mobile). Ils vivent ici, et pas
// dans un composant, pour une raison simple : si chaque surface écrit ses propres
// libellés, elles finissent par dire deux choses différentes du même fait — « Synthèse
// à jour » ici, « Synthèse OK » là. Le read model dit le SENS, ce module dit les MOTS,
// le composant ne décide que de la mise en forme.
//
// Règle : vocabulaire de conducteur, jamais de développeur. Aucun « projection »,
// « read model », « delta » ne doit sortir d'ici.

import type { SynthesisStatus } from '@/lib/knowledge/site-overview'

export interface SourceCounts { photos: number; videos: number; vocals: number; notes: number }

/** « 4 photos · 2 mémos » — la matière que la visite a rapportée. */
export function sourceLabels(sources: SourceCounts): string[] {
  const out: string[] = []
  if (sources.photos > 0) out.push(`${sources.photos} photo${sources.photos > 1 ? 's' : ''}`)
  if (sources.videos > 0) out.push(`${sources.videos} vidéo${sources.videos > 1 ? 's' : ''}`)
  if (sources.vocals > 0) out.push(`${sources.vocals} mémo${sources.vocals > 1 ? 's' : ''}`)
  if (sources.notes > 0) out.push(`${sources.notes} note${sources.notes > 1 ? 's' : ''}`)
  return out
}

/** « +1 note · +2 photos » — ce que la synthèse n'a pas encore pris en compte. */
export function pendingLabel(pending: SourceCounts): string {
  const parts: string[] = []
  if (pending.photos > 0) parts.push(`+${pending.photos} photo${pending.photos > 1 ? 's' : ''}`)
  if (pending.videos > 0) parts.push(`+${pending.videos} vidéo${pending.videos > 1 ? 's' : ''}`)
  if (pending.vocals > 0) parts.push(`+${pending.vocals} mémo${pending.vocals > 1 ? 's' : ''}`)
  if (pending.notes > 0) parts.push(`+${pending.notes} note${pending.notes > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/** « Aujourd'hui », « Hier », sinon la date — on parle comme un conducteur. */
export function visitDateLabel(iso: string | null): string {
  if (!iso) return 'Date inconnue'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date inconnue'
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return "Aujourd'hui"
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

/** L'état de la synthèse dit en clair. `tone` porte le sens, jamais une couleur. */
export function synthesisLabel(status: SynthesisStatus, pending: SourceCounts): {
  label: string
  tone: 'ok' | 'stale' | 'working' | 'none'
} {
  if (status === 'up_to_date') return { label: 'Synthèse à jour', tone: 'ok' }
  if (status === 'outdated') {
    const detail = pendingLabel(pending)
    return { label: detail ? `Synthèse à mettre à jour · ${detail}` : 'Synthèse à mettre à jour', tone: 'stale' }
  }
  if (status === 'generating') return { label: 'Synthèse en cours', tone: 'working' }
  return { label: 'Pas encore de synthèse', tone: 'none' }
}
