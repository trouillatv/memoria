// Mapper réunion MemorIA → CrBecib. RÈGLE : la donnée VALIDÉE prime toujours ;
// le transcript complète, ne contredit jamais ; un trou non résolu →
// « à compléter »/« à confirmer », JAMAIS inventé. Voir mémoire
// pv-questions-avant-validation. Prévu pour brancher un vrai site_report.

import type { CrBecib, CrBecibBloc, CrBecibIntervenant, StatutPoint } from './cr-becib-schema'
import type { PointExamine, PointExamineStatut } from '@/lib/db/points-examines'

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
  // Points examinés TYPÉS (couche 3) — prioritaire sur pointsAdmin/pointsTech.
  pointsExaminesTyped?: PointExamine[]
  ordreDuJour?: string[]
  remarquesCrPrecedent?: string | null
  // Prévisions issues des interventions (anomalies non résolues + interventions à
  // venir) — déjà rédigées en lignes déterministes ; complètent les actions ouvertes.
  previsionsInterventions?: string[]
  // Photos du site (projection fine de SitePhoto → {url, legende}). La structure
  // riche réutilisable vit dans lib/db/site-photos.ts.
  photos?: { url: string; legende: string }[]
  numeroCR?: string | null
  prochaineReunion?: { date?: string | null; heure?: string | null; lieu?: string | null }
}

// POINTS À CONFIRMER (jamais « questions ») — vocabulaire pro voulu par Vincent
// (2026-06-20). Doctrine : MemorIA ne devine pas tout, il identifie PRÉCISÉMENT
// ce qu'il ne sait pas, et ne demande QUE ce qui empêche la qualité du PV
// (« j'ai compris 90 %, il me manque 3 infos »). 3 niveaux de sévérité :
//   🔴 bloquant   — sans réponse, PV NON finalisable (PDF désactivé) ;
//   🟠 important  — PV générable mais avec avertissement ;
//   🟢 suggestion — aucune obligation (confort).
// `proposition` = valeur pré-remplie déterministe si une source existe (l'humain
// clique pour valider) ; sinon undefined → on demande sans inventer.
export type PvNiveau = 'bloquant' | 'important' | 'suggestion'
// Sous-axe des 🔴 (Vincent 2026-06-20) : distinguer le blocage MÉTIER (vrai problème
// de conduite — action sans responsable — JAMAIS contournable) du blocage DOCUMENTAIRE
// (le document est incomplet — DNS, date réunion — qu'un « PV urgent » peut décider de
// sortir quand même). Les deux restent rouges ; la nuance pilote l'override côté écran.
export type PvNature = 'metier' | 'documentaire'
export type PvPointAConfirmer = { niveau: PvNiveau; type: string; libelle: string; nature?: PvNature; proposition?: string }
/** @deprecated alias historique — utiliser PvPointAConfirmer. */
export type PvGapQuestion = PvPointAConfirmer

// Semaine ISO (W..).
function isoWeek(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return TODO
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7))
}

/** FILET QUALITÉ : ce que la mémoire ne sait pas et qui compte pour le PV, classé
 *  par sévérité. PARCIMONIE volontaire — on NE demande PAS la présence (défaut
 *  « présent » : la personne figure dans les participants) et on regroupe les
 *  photos sans légende en UN point (pas un par photo). Déterministe ; la détection
 *  IA fine et les propositions auto (calendrier/réunions passées) viendront ensuite. */
export function detectPvGaps(input: MeetingInput): PvPointAConfirmer[] {
  const q: PvPointAConfirmer[] = []
  // Actions : responsable inconnu = 🔴 (engagement non assumable) ; échéance = 🟠.
  for (const a of input.actions.filter((x) => x.status !== 'cancelled')) {
    if (!a.assignedTo) q.push({ niveau: 'bloquant', nature: 'metier', type: 'Responsable', libelle: `Responsable de « ${a.title} »` })
    if (!a.dueDate) q.push({ niveau: 'important', type: 'Échéance', libelle: `Échéance de « ${a.title} »`, proposition: TBC })
    else if (a.dueDateStatus === 'estimated') q.push({ niveau: 'important', type: 'Échéance', libelle: `Échéance de « ${a.title} » estimée (${a.dueDate}) — à confirmer`, proposition: TBC })
  }
  // Identité du document : DNS + date de la prochaine réunion = 🔴 mais DOCUMENTAIRE
  // (contournable en PV urgent), pas métier.
  if (!input.site.dns) q.push({ niveau: 'bloquant', nature: 'documentaire', type: 'DNS', libelle: 'N° DNS du chantier' })
  if (!input.prochaineReunion?.date) q.push({ niveau: 'bloquant', nature: 'documentaire', type: 'Date', libelle: 'Date de la prochaine réunion' })
  // Participants : organisme manquant = 🟠 (la colonne organisme du PV en a besoin).
  for (const p of input.report.participants) {
    if (!p.organisme) q.push({ niveau: 'important', type: 'Participant', libelle: `Organisme de « ${p.name} »` })
  }
  // Photos sans légende → UN seul point regroupé (jamais un par photo = bruit).
  const photosSansLegende = (input.photos ?? []).filter((p) => !(p.legende ?? '').trim()).length
  if (photosSansLegende > 0) q.push({ niveau: 'important', type: 'Photo', libelle: `${photosSansLegende} photo(s) sans légende` })
  // Suggestion (🟢) : confort, jamais bloquant.
  if ((input.photos ?? []).length === 0) q.push({ niveau: 'suggestion', type: 'Photo', libelle: 'Aucune photo rattachée — en ajouter une ?' })
  return q
}

const POIDS: Record<PvNiveau, number> = { bloquant: 15, important: 5, suggestion: 0 }

// POLITIQUE DE BLOCAGE par entreprise (Vincent 2026-06-20). « documentaire » ≠
// « non bloquant » : la SÉVÉRITÉ (niveau/nature) est intrinsèque au signal, mais la
// CONSÉQUENCE (désactiver le PDF final) est une décision MÉTIER configurable. Un
// bloquant MÉTIER (responsable d'action) bloque toujours ; un bloquant DOCUMENTAIRE
// (DNS, date) ne bloque que si l'entreprise l'exige — BECIB peut rendre le DNS
// obligatoire, un autre client non. Modèle : Signal → Politique → Bloquant.
// Le stockage par org viendra plus tard ; ici on pose le SEAM + un défaut permissif,
// pour ne PAS figer « documentaire = contournable » en dur dans le code.
export type PvBlockingPolicy = {
  /** Types de bloquants DOCUMENTAIRES que CETTE entreprise traite comme durs (ex. ['DNS']). */
  documentaireBlocking: string[]
}
export const DEFAULT_PV_POLICY: PvBlockingPolicy = { documentaireBlocking: [] }

/** Ce point désactive-t-il le PDF final, selon la politique ? Métier = toujours ;
 *  documentaire = seulement si l'entreprise l'a déclaré obligatoire. */
export function pointBloque(g: PvPointAConfirmer, policy: PvBlockingPolicy): boolean {
  if (g.niveau !== 'bloquant') return false
  if ((g.nature ?? 'metier') === 'metier') return true
  return policy.documentaireBlocking.includes(g.type)
}

export type PvReadiness = {
  score: number
  checks: { label: string; ok: boolean }[]
  blocking: boolean
  /** Compte par sévérité (pour l'en-tête « 🔴 2 · 🟠 4 · 🟢 1 »). */
  niveaux: Record<PvNiveau, number>
  /** Décompose les 🔴 (intrinsèque) : métier vs documentaire. Indépendant de la politique. */
  bloquants: { metier: number; documentaire: number }
  /** Bloquants DURS retenus par la politique = ceux qui désactivent réellement le PDF. */
  durs: number
  gaps: PvPointAConfirmer[]
}

/** Niveau de confiance du PV. Au moins un point 🔴 DUR (selon la politique) non levé
 *  → PDF FINAL désactivé, mais DOCX brouillon autorisé (règle actée). */
export function pvReadiness(input: MeetingInput, policy: PvBlockingPolicy = DEFAULT_PV_POLICY): PvReadiness {
  const gaps = detectPvGaps(input)
  const live = input.actions.filter((a) => a.status !== 'cancelled')
  const checks = [
    { label: `${input.report.participants.length} participant(s) identifié(s)`, ok: input.report.participants.length > 0 },
    { label: `${live.length} action(s) — ${live.filter((a) => a.assignedTo && a.dueDate).length} complète(s)`, ok: live.every((a) => a.assignedTo && a.dueDate) },
    { label: input.site.dns ? 'N° DNS présent' : 'N° DNS manquant', ok: !!input.site.dns },
    { label: input.prochaineReunion?.date ? 'Prochaine réunion datée' : 'Prochaine réunion à confirmer', ok: !!input.prochaineReunion?.date },
  ]
  const niveaux: Record<PvNiveau, number> = { bloquant: 0, important: 0, suggestion: 0 }
  const bloquants = { metier: 0, documentaire: 0 }
  let malus = 0
  let durs = 0
  for (const g of gaps) {
    niveaux[g.niveau]++; malus += POIDS[g.niveau]
    if (g.niveau === 'bloquant') {
      bloquants[g.nature ?? 'metier']++ // défaut prudent : non classé = métier (non contournable)
      if (pointBloque(g, policy)) durs++
    }
  }
  const blocking = durs > 0
  const score = Math.max(0, Math.min(100, Math.round(100 - malus)))
  return { score, checks, blocking, niveaux, bloquants, durs, gaps }
}

// Projection des points typés (couche 3) → blocs BECIB (présentation). On route
// decision/demande_moa vers les POINTS ADMINISTRATIFS, le reste vers les POINTS
// TECHNIQUES, en regroupant par sousTitre (ordre d'apparition préservé).
const STATUT_MAP: Record<PointExamineStatut, StatutPoint> = {
  fait: 'fait', 'en cours': 'en cours', 'à faire': 'à faire', 'en attente': 'en attente', bloqué: 'en attente',
}
function toBlocs(points: PointExamine[]): CrBecibBloc[] {
  const order: string[] = []
  const map = new Map<string, CrBecibBloc>()
  for (const p of points) {
    let b = map.get(p.sousTitre)
    if (!b) { b = { sousTitre: p.sousTitre, points: [], action: [] }; map.set(p.sousTitre, b); order.push(p.sousTitre) }
    const suffix = p.confiance === 'à confirmer' ? ' (à confirmer)' : ''
    b.points.push({ texte: p.texte + suffix, statut: p.statut ? STATUT_MAP[p.statut] : null, action: [] })
  }
  return order.map((s) => map.get(s)!)
}
function groupPointsExamines(points: PointExamine[]): { administratifs: CrBecibBloc[]; techniques: CrBecibBloc[] } {
  const isAdmin = (p: PointExamine) => p.type === 'decision' || p.type === 'demande_moa'
  return { administratifs: toBlocs(points.filter(isAdmin)), techniques: toBlocs(points.filter((p) => !isAdmin(p))) }
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
    pointsExamines: input.pointsExaminesTyped
      ? groupPointsExamines(input.pointsExaminesTyped)
      : { administratifs: input.pointsAdmin ?? [], techniques: input.pointsTech ?? [] },
    // Avancement adossé à la donnée structurée (jamais inventé) :
    //  FAIT ← actions clôturées ; PRÉVISIONS ← actions ouvertes (avec échéance/responsable).
    //  Le transcript enrichira ces listes plus tard (couche intelligence).
    avancement: {
      fait: input.actions.filter((a) => a.status === 'done').map((a) => a.title),
      // Prévisions = actions ouvertes + anomalies non résolues + interventions à venir.
      previsions: [
        ...input.actions
          .filter((a) => a.status !== 'done' && a.status !== 'cancelled')
          .map((a) => {
            const det = [a.assignedTo, a.dueDate ? `éch. ${a.dueDate}` : null].filter(Boolean).join(', ')
            return det ? `${a.title} (${det})` : a.title
          }),
        ...(input.previsionsInterventions ?? []),
      ],
    },
    intemperiesAleas: [],
    planning: {
      marche: { osDemarrage: input.contract.startDate ?? null, delai: input.contract.delai ?? null, finContractuelle: input.contract.endDate ?? null },
      intemperies: { depuisDerniereReunion: null, cumulOuvrable: null, finAvecIntemperies: null },
      prolongations: null,
      retard: { previsionnel: null, effectif: null },
    },
    securite: [],
    photos: input.photos ?? [],
    prochaineReunion: {
      date: input.prochaineReunion?.date ?? TBC,
      heure: input.prochaineReunion?.heure ?? null,
      lieu: input.prochaineReunion?.lieu ?? null,
    },
    signature: 'POUR BECIB,',
  }
}
