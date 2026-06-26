// lib/db/site-memory-digest.ts
// Digest STRUCTURÉ d'un chantier pour l'agent « Atelier mémoire » (Q&A scopé site).
// On ne donne PAS tout brut au LLM : on assemble un condensé à partir de briques
// DÉJÀ existantes (gatherSiteHistory, signaux déterministes, présence, sujets).
// Pas de RAG vectoriel ici — c'est le 1er étage (cf. ordre de dev Vincent).

import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { gatherSiteHistory } from '@/lib/db/visits'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { getSiteAttendanceStats } from '@/lib/db/site-reports'
import { listSiteContacts } from '@/lib/db/site-intervenants'
import { getSiteRecentEnrichments } from '@/lib/db/meeting-enrichments'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

function frShort(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export interface SiteMemoryDigest {
  siteName: string
  text: string
}

/** Assemble le contexte métier condensé du chantier (réunions/visites, actions &
 *  réserves ouvertes, décisions, obligations, sujets, signaux, intervenants
 *  fréquents). Lecture seule, déterministe. */
export async function getSiteMemoryDigest(siteId: string): Promise<SiteMemoryDigest | null> {
  const identity = await getSiteIdentity(siteId)
  if (!identity) return null

  const [history, signals, attendance, contacts, enrichments] = await Promise.all([
    gatherSiteHistory(siteId, ZERO_UUID),
    buildSiteMemorySignals(siteId).catch(() => []),
    getSiteAttendanceStats(siteId, ZERO_UUID).catch(() => ({ totalMeetings: 0, present: {} as Record<string, number>, lastMeetingContactIds: [] as string[] })),
    listSiteContacts(siteId).catch(() => []),
    getSiteRecentEnrichments(siteId, 8).catch(() => []),
  ])

  const sections: string[] = []

  if (history.text) sections.push(history.text)

  if (history.subjectDigests.length > 0) {
    sections.push('Sujets ouverts :\n' + history.subjectDigests.map((d) => `- ${d}`).join('\n'))
  }

  // Signaux déterministes (ce qui traîne / bloque / revient).
  if (signals.length > 0) {
    const lines = signals.flatMap((s) => [
      s.title,
      ...s.items.slice(0, 4).map((i) => `  • ${i.label}${i.context && i.context.length > 0 ? ` (${i.context[0]})` : ''}`),
    ])
    sections.push('Points d\'attention (détecteurs) :\n' + lines.join('\n'))
  }

  // Intervenants les plus fréquents (par présence aux réunions passées).
  const nameById = new Map(contacts.map((c) => [c.id, c.fullName]))
  const topIntervenants = Object.entries(attendance.present)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, n]) => `- ${nameById.get(id) ?? 'contact'} (${n} réunion${n > 1 ? 's' : ''})`)
  if (topIntervenants.length > 0) {
    sections.push('Intervenants fréquents :\n' + topIntervenants.join('\n'))
  }

  // Enrichissements récents (ajoutés APRÈS diffusion) — « qu'est-ce qui a changé ».
  if (enrichments.length > 0) {
    sections.push('Enrichissements récents (après diffusion) :\n' + enrichments.map((e) => `- ${frShort(e.date)} : ${e.what}`).join('\n'))
  }

  return {
    siteName: identity.name,
    text: sections.join('\n\n') || '(aucune mémoire enregistrée pour ce chantier)',
  }
}
