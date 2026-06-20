// Mapper réunion MemorIA → CrBecib. RÈGLE : la donnée VALIDÉE prime toujours ;
// le transcript complète, ne contredit jamais ; un trou non résolu →
// « à compléter »/« à confirmer », JAMAIS inventé. Voir mémoire
// pv-questions-avant-validation. Prévu pour brancher un vrai site_report.

import type { CrBecib, CrBecibBloc, CrBecibIntervenant } from './cr-becib-schema'

const TODO = 'à compléter'
const TBC = 'à confirmer'

export type MeetingParticipant = {
  name: string; role?: string | null
  organisme?: string | null
  groupe?: CrBecibIntervenant['groupe']
  presence?: CrBecibIntervenant['presence']
  invite?: boolean; diffusion?: boolean
}
export type MeetingInput = {
  report: { title?: string | null; createdAt: string; participants: MeetingParticipant[] }
  site: { name?: string | null; dns?: string | null }
  contract: { name?: string | null; clientName?: string | null; startDate?: string | null; endDate?: string | null; delai?: string | null }
  actions: { title: string; assignedTo?: string | null; dueDate?: string | null; dueDateStatus?: string | null; status: string }[]
  contacts: { fullName: string; phone?: string | null; mob?: string | null; email?: string | null }[]
  // Contenu éditorial VALIDÉ (points examinés) — propositions acceptées / curation humaine.
  pointsAdmin?: CrBecibBloc[]
  pointsTech?: CrBecibBloc[]
  ordreDuJour?: string[]
  remarquesCrPrecedent?: string | null
  numeroCR?: string | null
  prochaineReunion?: { date?: string | null; heure?: string | null; lieu?: string | null }
}

export type PvGapQuestion = { type: string; question: string; propositionIA?: string }

// Semaine ISO (W..).
function isoWeek(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return TODO
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7))
}

/** FILET QUALITÉ : détecte les trous/ambiguïtés → questions à valider AVANT PV.
 *  (version déterministe ; la détection IA fine viendra avec l'UI dédiée.) */
export function detectPvGaps(input: MeetingInput): PvGapQuestion[] {
  const q: PvGapQuestion[] = []
  for (const a of input.actions.filter((x) => x.status !== 'cancelled')) {
    if (!a.assignedTo) q.push({ type: 'Responsable', question: `L'action « ${a.title} » n'a pas de responsable. Qui la porte ?` })
    if (!a.dueDate) q.push({ type: 'Échéance', question: `L'action « ${a.title} » n'a pas d'échéance. Laquelle ?`, propositionIA: TBC })
    else if (a.dueDateStatus === 'estimated') q.push({ type: 'Échéance', question: `Échéance de « ${a.title} » estimée (${a.dueDate}). Confirmer ?`, propositionIA: TBC })
  }
  if (!input.prochaineReunion?.date) q.push({ type: 'Date', question: 'Date de prochaine réunion non claire. Indiquer « à confirmer » ?', propositionIA: TBC })
  if (!input.site.dns) q.push({ type: 'DNS', question: 'Le N° DNS du chantier est absent. À renseigner.' })
  for (const p of input.report.participants) {
    if (!p.organisme) q.push({ type: 'Participant', question: `Organisme de « ${p.name} » non identifié. À préciser.` })
    if (!p.presence) q.push({ type: 'Présence', question: `Présence de « ${p.name} » (P / AE / AN) ?`, propositionIA: 'P' })
  }
  return q
}

export type PvReadiness = { score: number; checks: { label: string; ok: boolean }[]; blocking: boolean; gaps: PvGapQuestion[] }

/** Niveau de confiance du PV. Points BLOQUANTS (responsable/DNS manquants) →
 *  PDF FINAL désactivé, mais DOCX brouillon autorisé. */
export function pvReadiness(input: MeetingInput): PvReadiness {
  const gaps = detectPvGaps(input)
  const live = input.actions.filter((a) => a.status !== 'cancelled')
  const checks = [
    { label: `${input.report.participants.length} participant(s) identifié(s)`, ok: input.report.participants.length > 0 },
    { label: `${live.length} action(s) — ${live.filter((a) => a.assignedTo && a.dueDate).length} complète(s)`, ok: live.every((a) => a.assignedTo && a.dueDate) },
    { label: input.site.dns ? 'N° DNS présent' : 'N° DNS manquant', ok: !!input.site.dns },
    { label: input.prochaineReunion?.date ? 'Prochaine réunion datée' : 'Prochaine réunion à confirmer', ok: !!input.prochaineReunion?.date },
  ]
  const blocking = gaps.some((g) => g.type === 'Responsable' || g.type === 'DNS')
  const score = Math.max(0, Math.round(100 - gaps.length * 6))
  return { score, checks, blocking, gaps }
}

function findContact(input: MeetingInput, name: string) {
  const norm = (s: string) => s.toLowerCase().replace(/^m\.|^mme|^mlle/, '').trim()
  return input.contacts.find((c) => norm(c.fullName).includes(norm(name)) || norm(name).includes(norm(c.fullName)))
}

/** Mappe une réunion validée → CrBecib. Trous → « à compléter », jamais inventé. */
export function mapMeetingToCrBecib(input: MeetingInput): CrBecib {
  const intervenants: CrBecibIntervenant[] = input.report.participants.map((p) => {
    const c = findContact(input, p.name)
    return {
      groupe: p.groupe ?? 'ENTREPRISE',
      organisme: p.organisme ?? TODO,
      representant: p.name,
      tel: c?.phone ?? null,
      mob: c?.mob ?? null,
      email: c?.email ?? null,
      invite: p.invite ?? true, // convié par défaut (présent à la réunion)
      presence: p.presence ?? 'P', // présent par défaut ; le filet pose la question
      diffusion: p.diffusion ?? true,
    }
  })

  return {
    meta: {
      numeroCR: input.numeroCR ?? TODO,
      dateIso: input.report.createdAt,
      semaine: isoWeek(input.report.createdAt),
      projetTitre: input.contract.name ?? input.site.name ?? TODO,
      moa: input.contract.clientName ?? TODO,
      moe: 'BECIB',
      chantier: input.site.name ?? TODO,
      dns: input.site.dns ?? null, // null → le template affiche « à compléter »
      version: '1',
      modification: 'A',
      clientLogoDataUrl: null, // logo client variable, fourni par donnée
    },
    intervenants,
    ordreDuJour: input.ordreDuJour ?? [],
    remarquesCrPrecedent: input.remarquesCrPrecedent ?? '',
    // Contenu éditorial = VALIDÉ uniquement (propositions acceptées / curation).
    pointsExamines: { administratifs: input.pointsAdmin ?? [], techniques: input.pointsTech ?? [] },
    // Avancement adossé à la donnée structurée (jamais inventé) :
    //  FAIT ← actions clôturées ; PRÉVISIONS ← actions ouvertes (avec échéance/responsable).
    //  Le transcript enrichira ces listes plus tard (couche intelligence).
    avancement: {
      fait: input.actions.filter((a) => a.status === 'done').map((a) => a.title),
      previsions: input.actions
        .filter((a) => a.status !== 'done' && a.status !== 'cancelled')
        .map((a) => {
          const det = [a.assignedTo, a.dueDate ? `éch. ${a.dueDate}` : null].filter(Boolean).join(', ')
          return det ? `${a.title} (${det})` : a.title
        }),
    },
    intemperiesAleas: [],
    planning: {
      marche: { osDemarrage: input.contract.startDate ?? null, delai: input.contract.delai ?? null, finContractuelle: input.contract.endDate ?? null },
      intemperies: { depuisDerniereReunion: null, cumulOuvrable: null, finAvecIntemperies: null },
      prolongations: null,
      retard: { previsionnel: null, effectif: null },
    },
    securite: [],
    photos: [],
    prochaineReunion: {
      date: input.prochaineReunion?.date ?? TBC,
      heure: input.prochaineReunion?.heure ?? null,
      lieu: input.prochaineReunion?.lieu ?? null,
    },
    signature: 'POUR BECIB,',
  }
}
