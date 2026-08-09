// Routeur d'intention — Lot 4C
//
// Déterministe V1 : trois classes, zéro LLM.
//
//   A — Situation / pilotage global du chantier
//       → mémoire structurée complète ; retrieval uniquement en fallback (contexte vide)
//
//   B — Connaissance structurée ciblée
//       → dimensions ciblées selon les mots-clés ; retrieval uniquement en fallback
//
//   C — Document / preuve / détail texte
//       → retrieval documentaire obligatoire ; contexte structuré minimal en cadrage
//
// Règle : C en priorité (le plus spécifique), puis A (global), puis B par défaut.

import type { SiteIntelligenceContextOptions } from '@/lib/knowledge/build-site-intelligence-context'

export type IntentRoute = 'A' | 'B' | 'C'

export interface IntentClassification {
  route: IntentRoute
  routeLabel: string
  /** Options à passer à buildSiteIntelligenceContext(). */
  ctxOptions: SiteIntelligenceContextOptions
  /** true = lancer searchSiteMemory() en parallèle ; false = retrieval uniquement en fallback. */
  useRetrieval: boolean
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function norm(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''‛`]/g, "'")
    .replace(/[«»]/g, '"')
}

// ── Patterns de classe C — documentaire ───────────────────────────────────────

const C_PATTERNS: RegExp[] = [
  /\bpvs?\b/,               // "PV", "PVs", "PV 008"
  /\bpv\s*\d/,              // "PV008", "PV8"
  /compte[- ]?rendus?/,     // "compte-rendu", "compte rendu"
  /\bcrs?\b/,               // "CR", "CRs"
  /que disait/,
  /qu['']a dit/,
  /dans le (document|rapport|pv|cr|cctp|dossier)/,
  /\bcctp\b/,               // Cahier des Clauses Techniques Particulières
  /montre[- ]?moi/,
  /\bpage\s*\d/,            // "page 12"
  /\bspécifications?|\bspecs?\b/,
  /que dit le (document|pv|cr|rapport)/,
  /d'apres (le|la|les) (document|pv|cr|rapport)/,
  /\bextrait\b/,
  /dimensions? (prevues?|stipulees?|dans|au|du)/,
  /\bmentionnait\b/,
  /\bcite\b.*\bdocument\b/,
  /\bplans?\b.*\battaches?\b/,
]

// ── Patterns de classe A — situation globale ──────────────────────────────────

const A_PATTERNS: RegExp[] = [
  /qu['']est[- ]ce qui (merite|demande|necessite)/,
  /(merite|demande|requiert).*attention/,
  /qu['']est[- ]ce qui bloque/,
  /(bloque|ralentit|freine|bloquant).*chantier/,
  /chantier.*(bloque|ralenti|freine)/,
  /ou en est (le )?chantier/,
  /etat (general|du chantier|des lieux|global)/,
  /situation (du chantier|generale|globale|d'ensemble)/,
  /sujets? (stagnent?|sans evolution|dormants?)/,
  /tableau (de bord|de synthese)/,
  /\bresume.*(du )?chantier|\bsynthese.*(du )?chantier/,
  /\bsynthese generale\b/,
  /\bpriorites?\b/,
  /\burgences?\b/,
  /alertes? (du chantier|actives?|en cours)/,
  /risques?.*(chantier|actifs?)/,
  /vue d'ensemble/,
  /bilan (du chantier|global)/,
  /points? (critiques?|bloquants?|urgents?)/,
]

// ── Options de contexte ────────────────────────────────────────────────────────

const A_OPTIONS: SiteIntelligenceContextOptions = {
  subjects: true,
  attention: true,
  activeObjects: true,
  relations: true,
  actors: true,
  timeline: true,
  blockages: true,
  maxSubjects: 20,
  maxRelations: 20,
  maxActors: 15,
  maxAttentionItems: 10,
}

const C_OPTIONS: SiteIntelligenceContextOptions = {
  attention: true,
  timeline: true,
  maxAttentionItems: 5,
}

function computeBOptions(normQ: string): SiteIntelligenceContextOptions {
  const opts: SiteIntelligenceContextOptions = {
    attention: true,
    subjects: true,
    maxSubjects: 10,
    maxAttentionItems: 5,
  }

  if (/\b(qui|responsable|contact|entreprise|interlocuteur|personne|intervenant|equipe|societe)\b/.test(normQ)) {
    opts.actors = true
    opts.maxActors = 10
  }

  if (/\b(depend|lien|relation|necessite|require|prerequis|conditionne|bloque par|associe)\b/.test(normQ)) {
    opts.relations = true
    opts.maxRelations = 15
  }

  if (/\b(blocage|intemperie|arret|accident)\b/.test(normQ)) {
    opts.blockages = true
  }

  if (/\b(actions?|reserves?|echeances?|jalons?|retard|delai|obligation|ouvert|en cours|a faire)\b/.test(normQ)) {
    opts.activeObjects = true
  }

  return opts
}

// ── Classifieur ───────────────────────────────────────────────────────────────

export function classifyIntent(question: string): IntentClassification {
  const q = norm(question)

  // C d'abord (le plus spécifique)
  if (C_PATTERNS.some((p) => p.test(q))) {
    return {
      route: 'C',
      routeLabel: 'Documentaire',
      ctxOptions: C_OPTIONS,
      useRetrieval: true,
    }
  }

  // A ensuite (global)
  if (A_PATTERNS.some((p) => p.test(q))) {
    return {
      route: 'A',
      routeLabel: 'Situation/Pilotage',
      ctxOptions: A_OPTIONS,
      useRetrieval: false,
    }
  }

  // B par défaut (connaissance ciblée)
  return {
    route: 'B',
    routeLabel: 'Connaissance structurée',
    ctxOptions: computeBOptions(q),
    useRetrieval: false,
  }
}
