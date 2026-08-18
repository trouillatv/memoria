// services/ai/visit-debrief.ts
// Débrief de CHANTIER (desktop), déclenché ici par une VISITE. Le débrief n'est
// pas « celui de la visite » : il analyse ce qui vient de modifier la mémoire du
// site sur une fenêtre temporelle. La visite est le 1er type de déclencheur ;
// réunion / mail / DOE / intervention deviendront d'autres déclencheurs SANS
// changer le paradigme (moteur de contexte multi-événements gelé — cf.
// moteur-de-contexte-chantier).
//
// MOTEUR EN DEUX AGENTS (raisonnement → structure, cf. roadmap-ia-debrief) :
//   Agent 1 — COMPRÉHENSION : le LLM joue le conducteur qui rentre et débriefe son
//     directeur en 2 min. Texte libre. C'est l'agent qu'on fera évoluer.
//   Agent 2 — EXTRACTION : à partir du SEUL débrief de l'agent 1, extrait la
//     structure (objectif/sujet/résultat/confiance/actions/questions…). Stable,
//     léger (modelTier 'light'). Garantit le contrat de données.
//
// L'IA PROPOSE et N'ÉCRIT RIEN : persistance uniquement après validation humaine.

import { z } from 'zod'
import { getAIProvider } from './factory'
import { withAITracking } from './tracking'
import type { AIProviderName } from './index'
import type { DebriefCapturedNote } from '@/lib/db/visit-captures'

const OUTCOMES = ['ras', 'conforme', 'conforme_reserves', 'non_conforme', 'a_revoir', 'info'] as const
const RESOLUTIONS = ['resolue', 'a_suivre', 'recontrole'] as const
const CONFIDENCE = ['elevee', 'moyenne', 'faible'] as const
const PRIORITY = ['haute', 'moyenne', 'basse'] as const

// Le LLM structure de façon variable (parfois une chaîne au lieu d'un objet, une
// priorité en anglais…). On TOLÈRE : on normalise avant de valider, plutôt que de
// rejeter toute l'extraction pour une virgule de forme.
function toPriority(v: unknown): 'haute' | 'moyenne' | 'basse' | null {
  const s = String(v ?? '').toLowerCase()
  if (/haut|urgent|high|élev|elev/.test(s)) return 'haute'
  if (/moy|medium|normal/.test(s)) return 'moyenne'
  if (/bas|prépar|prepar|low|faible/.test(s)) return 'basse'
  return null
}

// Le LLM écrit souvent `null` pour un champ vide → on le tolère (null|undefined → '').
const optStr = z.preprocess((v) => (v == null ? '' : v), z.string())

// Listes de FAITS (à savoir, échéances, intervenants…) : le LLM renvoie parfois des
// objets ({name, role}, {label, due}) au lieu de chaînes. On aplatit en « nom (détail) »
// plutôt que de rejeter toute l'extraction pour une virgule de forme.
const strItem = z.preprocess((v) => {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const name = String(o.name ?? o.label ?? o.title ?? o.text ?? '').trim()
    const detail = String(o.role ?? o.due ?? o.detail ?? o.impact ?? '').trim()
    return detail && detail !== name ? `${name} (${detail})` : name
  }
  return String(v)
}, z.string())
const strList = z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(strItem))
  .transform((arr) => arr.map((s) => s.trim()).filter((s) => s.length > 0))
  .default([])

export const visitDebriefSchema = z.object({
  // Niveau 1 — « ce qui mérite ton attention » : 3 à 5 max. C'est un FILTRE.
  // BLINDÉ partout : le LLM sort parfois une valeur hors enum, un objet, un null →
  // .catch défausse la valeur fautive sur son défaut au lieu de casser TOUTE
  // l'extraction. Mieux vaut un champ vide qu'un « analyse impossible ».
  attention: strList,
  objective: optStr,
  objective_rationale: optStr, // POURQUOI : reformule ce que dit le débrief
  objective_confidence: z.enum(CONFIDENCE).nullable().catch(null).default(null),
  subject_match_index: z.preprocess((v) => (v == null ? -1 : v), z.number().int()).catch(-1).default(-1),
  subject_name: optStr,
  subject_rationale: optStr,
  subject_confidence: z.enum(CONFIDENCE).nullable().catch(null).default(null),
  outcome: z.enum(OUTCOMES).nullable().catch(null).default(null),
  resolution: z.enum(RESOLUTIONS).nullable().catch(null).default(null),
  // ⚠️ Points de vigilance — de vrais RISQUES, exploitables : impact + responsable
  // + échéance quand le débrief les donne (sinon vides). TOLÉRANT : chaîne → objet.
  important_points: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(
      z.preprocess(
        (v) => (typeof v === 'string' ? { label: v } : v),
        z.object({ label: optStr, impact: optStr, owner: optStr, due: optStr }),
      ).catch({ label: '', impact: '', owner: '', due: '' }),
    ),
  ).transform((arr) => arr.filter((x) => x.label.trim().length > 0)).default([]),
  // ✅ Actions — des CARTES : quoi + pourquoi + priorité + responsable + échéance.
  // BLINDÉ : chaîne → objet ; priorité normalisée ; null → '' ; item malformé ignoré.
  suggested_actions: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(
      z.preprocess(
        (v) => (typeof v === 'string' ? { title: v } : v),
        z.object({
          title: optStr,
          rationale: optStr,
          priority: z.preprocess((p) => toPriority(p), z.enum(PRIORITY).nullable()).default(null),
          owner: optStr,
          due: optStr,
        }),
      ).catch({ title: '', rationale: '', priority: null, owner: '', due: '' }),
    ),
  ).transform((arr) => arr.filter((a) => a.title.trim().length > 0)).default([]),
  // ✓ Décisions PRISES — les engagements actés pendant la visite (ni action à
  // faire, ni risque : ce qui a été tranché). « Les accès seront fournis plus tard. »
  decisions: strList,
  // ℹ️ À savoir — le CONTEXTE important mais NON actionnable (ni action, ni risque,
  // ni décision). « Première visite. », « Le nettoyage précède l'intervention. »
  a_savoir: strList,
  // 📅 Échéances — une échéance existe UNIQUEMENT s'il y a une notion de TEMPS :
  // une date absolue (« le 28 juillet »), une date relative (« sous dix jours »),
  // ou une dépendance (« avant le démarrage », « après la visite PAVE »). Sans
  // notion temporelle, ce n'est pas une échéance : c'est une action. On ne dédouble
  // pas le travail en une fausse date.
  //
  // `date` n'est remplie QUE si le débrief donne une vraie date. « Sous une dizaine
  // de jours » n'est PAS une date : c'est une contrainte, et elle va dans
  // `constraint`. Convertir l'un en l'autre serait inventer une information que
  // MemorIA ne possède pas — l'humain tranchera.
  //
  // BLINDÉ : une chaîne nue (ancien format) devient un label sans date ni contrainte.
  echeances: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(
      z.preprocess(
        (v) => (typeof v === 'string' ? { label: v } : v),
        z.object({ label: optStr, date: optStr, constraint: optStr }),
      ).catch({ label: '', date: '', constraint: '' }),
    ),
  ).transform((arr) => arr.filter((e) => e.label.trim().length > 0)).default([]),
  // 👥 Intervenants — les personnes/entreprises citées, réutilisables aux visites
  // suivantes. « Vincent Milon (PAVE) », « Ginger », « Électriciens ».
  intervenants: strList,
  forgotten_obligations: strList,
  open_questions: strList,
})
export type VisitDebriefParsed = z.infer<typeof visitDebriefSchema>

// ── Agent 1 — Compréhension (narratif, joue le conducteur) ────────────────────

const UNDERSTANDING_SYSTEM = `Tu rédiges le RÉSUMÉ OPÉRATIONNEL d'une visite de chantier, à partir UNIQUEMENT
des éléments fournis (vocal, notes, photos, réserves, actions capturées) et du
contexte mémoire du site.

Ce résumé est lu par quelqu'un qui n'était PAS présent (chef de projet, bureau).
Il doit se lire en MOINS DE 20 SECONDES et donner ce qui est RESSORTI de la visite.

RÈGLES ABSOLUES :
- CHAQUE PHRASE doit apporter une information OPÉRATIONNELLE NOUVELLE. Si une phrase
  n'apporte aucune information utile à quelqu'un qui n'a PAS participé à la visite,
  ne l'écris pas. Zéro paraphrase, zéro remplissage (« cette visite permet de
  documenter… », « ces éléments serviront de référence… » = INTERDIT).
- 5 à 8 phrases maximum, en français, en prose (pas de liste, pas de titre).
- Écris ce qui EST RESSORTI de la visite, JAMAIS comment elle s'est déroulée.
- N'écris JAMAIS « je reviens de ma visite », « l'objectif était… », « j'ai pris
  des photos / des mémos », « c'est une première visite », « il faudra analyser
  les photos… » : celui qui lit vient de faire la visite ou connaît le contexte, il
  le sait déjà. Ne mentionne les photos/mémos/le fait que c'est une première visite
  QUE si cela porte une vraie information métier.
- Le CŒUR du résumé, ce sont les FAITS CONCRETS dits dans le vocal et les notes :
  qui doit contacter qui, quels contrôles, quelles échéances, quels documents, quel
  intervenant, quel délai. CITE-LES précisément (noms, délais, tâches). NE te
  réfugie PAS dans des généralités du type « la visite a permis de constater l'état
  du site », « les photos documentent les conditions initiales », « ces éléments
  serviront de référence » : c'est du vide, l'utilisateur n'en fait rien.
- N'invente AUCUN fait précis (chiffre, date, nom) absent des éléments fournis, mais
  REPRENDS tous ceux qui y sont.
- JAMAIS de jugement sur une personne : tu parles de l'ouvrage, des sujets, des
  obligations, jamais de la valeur des gens.

FRONTIÈRE DES SOURCES (P0-I.2 — chaque source a un droit différent, pas juste un
contenu différent) :
- Seuls les éléments sous « PREUVES DE LA VISITE COURANTE » (vocal, notes, photos
  qualifiées par un triage) peuvent FONDER un fait de CETTE visite.
- Les photos SANS triage sont des repères de localisation, pas des constats :
  n'en tire JAMAIS un fait narratif à elles seules (une légende comme « Plonge
  Batterie » ne dit rien sur ce qui s'y est passé). Elles ne deviennent un fait
  que si le vocal ou une note confirme indépendamment le même contenu.
- Les éléments sous « CONTEXTE DU CHANTIER » (sujets suivis, signaux, historique)
  disent DE QUOI parle le chantier, JAMAIS ce qui s'est passé pendant cette
  visite. Un sujet encore ouvert, ou l'intitulé d'un sujet suivi, ne devient un
  fait de cette visite QUE si les preuves ci-dessus montrent qu'il a été discuté,
  confirmé, modifié, réalisé ou reporté MAINTENANT. Le contexte t'aide à
  COMPRENDRE et NOMMER un fait déjà présent dans les preuves — jamais à le
  CRÉER. Exemple interdit : un sujet suivi intitulé « Lancement et avancement de
  la dépose du matériel de cuisine » ne devient PAS « des restants de matériel
  de cuisine ont été déposés » sans preuve de cette visite.

Exemple de BON résumé (STYLE et niveau de concret attendus — les faits ci-dessous
sont fictifs, n'utilise QUE ceux de TA visite) : « La chape du hall n'est pas sèche,
le carreleur ne peut pas intervenir avant lundi. Le lot plomberie a pris trois jours
de retard ; le maître d'œuvre doit être prévenu. Les luminaires livrés ne sont pas
conformes au CCTP, un avoir est à demander au fournisseur. » — des faits, des noms,
des délais, des suites. AUCUN méta (« la visite a permis de… », « les photos… »).`

// ── Agent 2 — Extraction (structure stable à partir du débrief) ───────────────

const EXTRACTION_SYSTEM = `Tu es un EXTRACTEUR. On te donne le DÉBRIEF rédigé par le conducteur de travaux,
les éléments BRUTS de la visite (notes, photos qualifiées ou non par un triage),
et la liste des sujets connus du site (par index). Tu produis UNIQUEMENT la
structure JSON demandée, FIDÈLE au débrief : n'ajoute AUCUN fait que le débrief ne
contient pas. Si le débrief ne dit rien sur un champ, laisse-le vide / null.

FRONTIÈRE DES SOURCES (P0-I.2) : la liste des sujets connus du site NOMME des
THÈMES suivis par le chantier, jamais des événements. N'en tire un fait QUE si le
débrief l'affirme explicitement pour cette visite — le simple rapprochement entre
un sujet connu et le vocabulaire du débrief n'est pas une preuve. Une photo SANS
triage citée dans les éléments bruts est un repère de localisation, pas un
constat : ne la transforme en fait que si le débrief la corrobore.

Les « rationale » et le « pourquoi » REFORMULENT ce que dit le débrief (pas
d'invention). La confiance (elevee | moyenne | faible) reflète la FERMETÉ du
débrief sur ce point (le conducteur hésite → faible). « attention » = 3 à 5 MAX,
les éléments les plus décisifs du débrief — c'est un FILTRE, pas un résumé complet.

CHAQUE INFORMATION A UNE SEULE DESTINATION (P0-I.2) : ne recopie pas le même fait
dans plusieurs champs. Ordre de priorité — un fait va dans le champ structuré le
plus spécifique qui le concerne (important_points, suggested_actions, decisions,
echeances, intervenants) ; « attention » n'en retient qu'un résumé filtré (3-5) ;
« a_savoir » est un DERNIER RECOURS résiduel (voir plus bas), jamais un champ à
remplir pour lui-même.

Champs :
- attention : 3 à 5 max, les éléments les plus décisifs.
- objective : l'objectif de la visite tel que le conducteur l'exprime. Vide si absent.
- objective_rationale : pourquoi (reformule). objective_confidence : elevee|moyenne|faible|null.
- subject_match_index : index du sujet connu correspondant (liste fournie), sinon -1.
- subject_name : le sujet principal (nom existant retenu, ou nouveau nom court si -1).
- subject_rationale : pourquoi ce sujet. subject_confidence : elevee|moyenne|faible|null.
- outcome : ras|conforme|conforme_reserves|non_conforme|a_revoir|info, ou null. JAMAIS un jugement sur une personne.
- resolution : resolue|a_suivre|recontrole, ou null.
- important_points : les RISQUES / points de vigilance, EXPLOITABLES, CONSTATÉS pendant cette visite (par le vocal, une note, ou une photo qualifiée « À surveiller »/« Réserve à lever »). [{ label (le risque, court), impact (conséquence si non traité), owner (qui doit agir, si le débrief le dit), due (échéance, si dite) }]. Laisse impact/owner/due VIDES si le débrief ne les donne pas — n'invente pas. Un sujet du site resté ouvert n'y entre QUE si le débrief montre qu'il a été observé/reconfirmé maintenant, pas par simple rapprochement de vocabulaire.
- suggested_actions : les actions à FAIRE. [{ title, rationale, priority, owner, due }]. Le title doit être PILOTABLE et AUTOPORTANT — compréhensible plusieurs semaines plus tard sans le contexte : « Contacter M. Vincent Milon (PAVE) pour transmettre le plan de prévention avant le démarrage », JAMAIS « Contacter Vincent ». priority "haute"|"moyenne"|"basse" selon l'urgence exprimée, sinon null ; owner/due si dits.
- decisions : les DÉCISIONS PRISES / engagements actés PENDANT CETTE VISITE — ce qui a été TRANCHÉ, ni action à faire ni risque. Ex. « Les accès seront fournis ultérieurement. », « Une nouvelle visite sera organisée. » Un sujet resté ouvert depuis une visite précédente n'est PAS une décision de cette visite, SAUF si le débrief dit explicitement qu'il a été rediscuté, confirmé ou tranché maintenant.
- a_savoir : DERNIER RECOURS, résiduel — n'utilise ce champ QUE pour une information importante et durable qui n'a sa place NULLE PART ailleurs (ni attention, ni risque, ni décision, ni échéance, ni action). Ne le remplis JAMAIS pour combler un champ vide ou paraphraser un sujet connu du site : si rien ne reste après avoir rempli les autres champs, laisse a_savoir VIDE. Ex. « Première visite du chantier. », « Le nettoyage précède l'intervention. »
- echeances : ce qui doit arriver À UN MOMENT PENDANT CETTE VISITE ou décidé pendant celle-ci. Une échéance n'existe QUE s'il y a une notion de TEMPS — une date (« le 28 juillet »), un délai (« sous une dizaine de jours »), ou une dépendance (« avant le démarrage », « après la visite PAVE »). Si le débrief dit seulement qu'il faudra faire quelque chose, SANS aucune notion de temps, ce n'est PAS une échéance : c'est une action, ne la mets pas ici. Une échéance déjà connue d'un sujet du site n'est reprise ici QUE si le débrief la mentionne à nouveau pour cette visite (confirmée, modifiée ou reportée) — pas parce qu'elle reste ouverte.
  Format : [{ label, date, constraint }].
  · label : CE QUI doit arriver, court et autoportant. Ex. « Poser le coffret électrique », « Programmer la visite PAVE ». Pas de délai dans le label.
  · date : UNIQUEMENT une vraie date, au format AAAA-MM-JJ. Si le débrief dit « le 28 juillet », donne-la EN UTILISANT L'ANNÉE DE LA DATE DE VISITE fournie en tête (jamais une autre année). Si tu n'as PAS de date certaine, laisse VIDE. « Sous dix jours », « fin de la semaine », « avant le démarrage » ne sont PAS des dates : n'invente jamais une date à partir d'un délai.
  · constraint : la contrainte de temps, dite avec les mots du débrief. Ex. « Avant le démarrage », « Sous une dizaine de jours », « Après la visite PAVE ». Vide si le débrief donne une date nette.
- intervenants : les PERSONNES et ENTREPRISES citées, avec leur rôle si connu. Ex. « Vincent Milon (PAVE) », « Ginger », « Électriciens ». Réutilisables aux prochaines visites.
- forgotten_obligations : obligations/contrôles que le débrief signale comme oubliés ou manquants.
- open_questions : questions ouvertes soulevées par le débrief (aide à la réflexion, ni action ni résumé).`

export interface VisitDebriefInput {
  objectiveHint: string | null
  capturedText: string | null
  transcript: string | null
  attachmentNames: string[]
  /** P0-I.2 : chaque note/légende porte son triageIntent — jamais un texte brut
   *  anonyme. Une légende de photo sans triage (null) est un repère de
   *  localisation, pas un constat ; un triage explicite (follow/reserve/action)
   *  signale un contenu qualifié par l'humain, exploitable comme fait. */
  capturedNotes: DebriefCapturedNote[]
  capturedActions: Array<{ title: string; corps_etat: string | null }>
  capturedReserves: Array<{ label: string; location: string | null }>
  signalLines: string[]
  openSubjects: Array<{ id: string; name: string }>
  // V2.1 — contexte métier condensé du chantier (bornée au site, jamais cross-chantier).
  siteHistory: string
  /** Digest court par sujet ouvert — l'Agent 1 identifie LUI-MÊME le concerné. */
  subjectDigests: string[]
  /** Date de la visite (AAAA-MM-JJ) = ancre temporelle. Sans elle, le modèle
   *  situe « le 28 juillet » sur son année d'entraînement (~2024) au lieu de
   *  l'année réelle de la visite. null si inconnue. */
  referenceDate: string | null
  userId: string | null
  /** Bloc de contexte sémantique pré-formaté (lib/knowledge/semantic-entities).
   *  Injecté avant la transcription dans les deux agents. null = aucune entité
   *  connue → comportement identique à l'absence du module. */
  semanticBlock?: string | null
  /** Résultats structurés du plan de visite (buildWatchlistDebriefBlock).
   *  Injecté avant la transcription. null = pas de plan de visite pour cette session. */
  watchlistBlock?: string | null
  /** Contexte compact du chantier (canonical subjects + aliases confirmés).
   *  Aide à la compréhension des noms propres et termes métier — jamais source de vérité.
   *  Exclu du corpus_hash (volatile). null = aucun sujet connu → comportement inchangé. */
  siteContext?: string | null
}

export interface VisitDebriefResult {
  narrative: string          // Agent 1 — « voilà ce que j'ai compris » (montré à l'UI)
  parsed: VisitDebriefParsed // Agent 2 — structure extraite
  model: string | null
  provider: AIProviderName
}

/** Ancre temporelle : situe l'année des dates partielles. Vide si date inconnue. */
function referenceDateBlock(referenceDate: string | null): string {
  if (!referenceDate) return ''
  return [
    '=== Date de la visite (référence temporelle) ===',
    referenceDate,
    "Utilise CETTE date pour situer l'année des dates partielles (« le 28 juillet » → l'année de la visite, jamais une autre année). Ne convertis JAMAIS un délai (« sous dix jours », « avant le démarrage ») en date.",
    '',
  ].join('\n')
}

const TRIAGE_INTENT_FR: Record<NonNullable<DebriefCapturedNote['triageIntent']>, string> = {
  follow: 'À surveiller',
  reserve: 'Réserve à lever',
  action: 'Action à prévoir',
  memoire: 'Documenter la visite',
}

/** Sépare les captures par ce qu'elles ont le droit d'affirmer (P0-I.2) :
 *  note = constat direct ; média triés = constat qualifié par l'humain ;
 *  média non triés = repère de localisation, jamais un fait à lui seul. */
function splitCapturedNotes(capturedNotes: DebriefCapturedNote[]) {
  return {
    notes: capturedNotes.filter((n) => n.kind === 'note'),
    triagedMedia: capturedNotes.filter((n) => n.kind !== 'note' && n.triageIntent),
    untriagedMedia: capturedNotes.filter((n) => n.kind !== 'note' && !n.triageIntent),
  }
}

/** Doctrine P0-I.2 (Vincent, 2026-08-18) — CE QUE chaque source A LE DROIT
 *  d'affirmer, pas seulement ce qu'elle sait :
 *   - « Constats actuels » (notes, légendes triées) = preuve d'événement.
 *   - « Repères photo » (légende SANS triage) = identifie/localise, jamais un
 *     fait à lui seul.
 *   - « Contexte du chantier » (sujets canoniques, historique, signaux) =
 *     VOCABULAIRE et mémoire pour interpréter, jamais une preuve que
 *     quelque chose s'est produit PENDANT cette visite.
 *  Rendu séparé pour que le prompt porte cette frontière dans sa structure,
 *  pas seulement dans une consigne générale. */
function buildContextBlock(input: VisitDebriefInput): string {
  const { notes, triagedMedia, untriagedMedia } = splitCapturedNotes(input.capturedNotes)

  return [
    referenceDateBlock(input.referenceDate),
    ...(input.watchlistBlock ? [input.watchlistBlock, ''] : []),
    '=== PREUVES DE LA VISITE COURANTE (ce qui s\'est produit MAINTENANT) ===',
    '',
    '--- Vocal / transcription ---',
    input.transcript?.slice(0, 10000) || '(aucun)',
    '',
    '--- Notes saisies (constats) ---',
    notes.length > 0 ? notes.map((n) => n.body).join('\n') : (input.capturedText ?? '(aucune)'),
    '',
    '--- Photos/vidéos QUALIFIÉES par l\'humain (triage explicite) ---',
    "Le triage indique la destination métier probable — utilise le contenu de la légende comme un fait, pas seulement le triage.",
    triagedMedia.length > 0
      ? triagedMedia.map((n) => `- [${TRIAGE_INTENT_FR[n.triageIntent!]}] ${n.body}`).join('\n')
      : '(aucune)',
    '',
    '--- Photos/vidéos SANS triage (repères de localisation) ---',
    'Ce sont des LÉGENDES qui identifient/localisent la photo, PAS des constats terrain. N\'en fais JAMAIS un fait narratif à elles seules (ex. « Plonge Batterie » ne dit rien sur ce qui s\'y est passé). Elles ne deviennent un fait que si le vocal ou une note ci-dessus confirme indépendamment le même contenu.',
    untriagedMedia.length > 0 ? untriagedMedia.map((n) => `- ${n.body}`).join('\n') : '(aucune)',
    '',
    '--- Photos / pièces (noms uniquement) ---',
    input.attachmentNames.length > 0 ? input.attachmentNames.join('\n') : '(aucune)',
    '',
    '--- Actions créées pendant la visite ---',
    input.capturedActions.length > 0 ? input.capturedActions.map((a) => `- ${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`).join('\n') : '(aucune)',
    '',
    '--- Réserves créées pendant la visite ---',
    input.capturedReserves.length > 0 ? input.capturedReserves.map((r) => `- ${r.label}${r.location ? ` @ ${r.location}` : ''}`).join('\n') : '(aucune)',
    '',
    ...(input.semanticBlock ? [input.semanticBlock, ''] : []),
    ...(input.siteContext ? [input.siteContext, ''] : []),
    '=== CONTEXTE DU CHANTIER (vocabulaire et mémoire — PAS une preuve d\'événement de cette visite) ===',
    "Un sujet suivi, un signal ou l'historique ci-dessous décrivent DE QUOI parle le chantier ou ce qui reste ouvert — jamais CE QUI S'EST PASSÉ pendant CETTE visite. N'en tire un fait de la visite courante QUE si les preuves ci-dessus (vocal, notes, photos qualifiées) montrent que ce sujet a été discuté, confirmé, modifié, réalisé ou reporté MAINTENANT. Le simple fait qu'un sujet soit encore ouvert ne suffit pas à l'affirmer comme un événement de cette visite.",
    '',
    '--- Signaux mémoire du site (déterministes) ---',
    input.signalLines.length > 0 ? input.signalLines.join('\n') : '(aucun signal)',
    '',
    '--- Historique condensé du chantier ---',
    input.siteHistory || '(aucun historique)',
    '',
    '--- Sujets ouverts du chantier (avec leur ancienneté/activité) ---',
    input.subjectDigests.length > 0
      ? input.subjectDigests.map((d) => `- ${d}`).join('\n') + '\nIDENTIFIE lequel cette visite concerne (par son sens, pas par les mots exacts), ou « aucun / nouveau sujet ».'
      : '(aucun sujet ouvert)',
    input.objectiveHint ? `\n=== Objectif déjà renseigné ===\n${input.objectiveHint}` : '',
  ].join('\n')
}

/** Mock Agent 1 : un récit déterministe à partir du contexte (démo sans clé IA). */
function mockNarrative(input: VisitDebriefInput): string {
  const bits: string[] = []
  bits.push(`Je suis passé sur le chantier${input.objectiveHint ? ` pour ${input.objectiveHint.toLowerCase()}` : ''}.`)
  if (input.capturedNotes[0]) bits.push(`J'ai noté : ${input.capturedNotes[0].body}.`)
  if (input.capturedReserves[0]) bits.push(`J'ai relevé une réserve : ${input.capturedReserves[0].label}.`)
  const subj = input.openSubjects[0]?.name ?? null
  if (subj) bits.push(`Ça rejoint le sujet « ${subj} » qu'on suit déjà${input.subjectDigests.length > 1 ? ' — et qui revient régulièrement' : ''}.`)
  if (input.signalLines[0]) bits.push(`Côté contexte, ${input.signalLines[0].toLowerCase()}.`)
  if (input.siteHistory) bits.push(`Par rapport aux derniers passages, rien de spectaculaire n'a changé.`)
  bits.push(`Rien d'autre de bloquant pour l'instant — à recontrôler au prochain passage si une réserve reste ouverte.`)
  return bits.join(' ')
}

/** Mock Agent 2 : extraction déterministe (démo sans clé IA). */
function mockExtraction(input: VisitDebriefInput): VisitDebriefParsed {
  const firstNote = input.capturedNotes[0]?.body ?? input.transcript ?? input.capturedText ?? ''
  const hasReserve = input.capturedReserves.length > 0
  return {
    attention: [...input.signalLines.slice(0, 3), ...(hasReserve ? [`Réserve « ${input.capturedReserves[0].label} » créée`] : [])].slice(0, 5),
    objective: input.objectiveHint ?? (firstNote ? firstNote.slice(0, 80) : ''),
    objective_rationale: firstNote ? 'Déduit de la première note / du vocal capturé.' : 'Aucun indice textuel — objectif indéterminé.',
    objective_confidence: firstNote ? 'moyenne' : 'faible',
    subject_match_index: input.openSubjects.length > 0 ? 0 : -1,
    subject_name: input.openSubjects[0]?.name ?? '',
    subject_rationale: input.openSubjects[0] ? `Rapproché du sujet existant « ${input.openSubjects[0].name} ».` : 'Aucun sujet connu correspondant.',
    subject_confidence: input.openSubjects[0] ? 'moyenne' : 'faible',
    outcome: hasReserve ? 'conforme_reserves' : null,
    resolution: hasReserve ? 'recontrole' : null,
    important_points: input.capturedNotes.slice(0, 3).map((n) => ({ label: n.body, impact: '', owner: '', due: '' })),
    suggested_actions: hasReserve
      ? [{ title: `Suivre la réserve « ${input.capturedReserves[0].label} »`, rationale: 'Une réserve a été créée pendant la visite.', priority: 'moyenne' as const, owner: '', due: '' }]
      : [],
    decisions: [],
    a_savoir: input.objectiveHint ? [`Objectif de la visite : ${input.objectiveHint}.`] : [],
    echeances: [],
    intervenants: [],
    forgotten_obligations: input.signalLines.slice(0, 2),
    open_questions: hasReserve ? [`La réserve « ${input.capturedReserves[0].label} » est-elle toujours valide ?`] : [],
  }
}

export async function runVisitDebriefAgent(input: VisitDebriefInput): Promise<VisitDebriefResult> {
  const provider = getAIProvider()

  // ── Agent 1 — Compréhension (narratif) ──
  const narrative = await withAITracking('visit_debrief_understand', input.userId, async () => {
    const userMessage = provider.name === 'mock'
      ? `__MOCK_FIXTURE__:${JSON.stringify(mockNarrative(input))}`
      : `${buildContextBlock(input)}\n\nRédige le résumé opérationnel (5 à 8 phrases, lisible en moins de 20 s).`
    const out = await provider.complete({
      systemPrompt: UNDERSTANDING_SYSTEM,
      userMessage,
      modelTier: 'heavy',
      maxOutputTokens: 900,
    })
    const text = (out.text ?? '').trim()
    if (!text) throw new Error('[visit-debrief] Agent 1 (compréhension) a rendu un débrief vide')
    return { result: text, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  // ── Agent 2 — Extraction (structure stable, léger) ──
  const parsed = await withAITracking('visit_debrief_extract', input.userId, async () => {
    let userMessage: string
    if (provider.name === 'mock') {
      userMessage = `__MOCK_FIXTURE__:${JSON.stringify(mockExtraction(input))}`
    } else {
      const subjectsList = input.openSubjects.length > 0
        ? input.openSubjects.map((s, i) => `[${i}] ${s.name}`).join('\n')
        : '(aucun sujet connu)'
      const { notes, triagedMedia, untriagedMedia } = splitCapturedNotes(input.capturedNotes)
      userMessage = [
        referenceDateBlock(input.referenceDate),
        ...(input.watchlistBlock ? [input.watchlistBlock, ''] : []),
        ...(input.semanticBlock ? [input.semanticBlock, ''] : []),
        ,
        narrative,
        '',
        '=== Éléments BRUTS de la visite (pour ne RIEN omettre : noms, délais, faits à retenir) ===',
        input.transcript?.slice(0, 8000) || '(aucun mémo vocal)',
        notes.length > 0 ? `\nNotes :\n${notes.map((n) => n.body).join('\n')}` : '',
        triagedMedia.length > 0
          ? `\nPhotos/vidéos QUALIFIÉES par l'humain (le triage indique la destination — utilise le contenu comme un fait) :\n${triagedMedia.map((n) => `- [${TRIAGE_INTENT_FR[n.triageIntent!]}] ${n.body}`).join('\n')}`
          : '',
        untriagedMedia.length > 0
          ? `\nLégendes de photos SANS triage (repères de localisation — n'en extrais un fait que si le vocal ou une note ci-dessus confirme indépendamment le même contenu) :\n${untriagedMedia.map((n) => `- ${n.body}`).join('\n')}`
          : '',
        '',
        '=== Sujets connus du site (par index, pour subject_match_index) ===',
        subjectsList,
        '',
        ,
      ].join('\n')
    }
    const out = await provider.complete({
      systemPrompt: EXTRACTION_SYSTEM,
      userMessage,
      responseSchema: visitDebriefSchema,
      modelTier: 'light',
      maxOutputTokens: 2500,
    })
    let result: VisitDebriefParsed | undefined
    if (out.parsed !== undefined && out.parsed !== null) {
      const r = visitDebriefSchema.safeParse(out.parsed)
      if (r.success) result = r.data
    }
    if (result === undefined) {
      try {
        const r = visitDebriefSchema.safeParse(JSON.parse(out.text))
        if (r.success) result = r.data
      } catch { /* ignore */ }
    }
    // Dernier filet : si l'extraction échoue malgré tout (JSON tronqué…), on NE
    // jette PAS — on garde le RÉSUMÉ (Agent 1) avec une structure vide. Un résumé
    // sans blocs vaut mieux qu'un « analyse impossible » qui prive l'utilisateur
    // de tout. (Tous les champs ont un défaut → parse({}) donne la structure vide.)
    if (result === undefined) {
      console.error('[visit-debrief] Agent 2 extraction non parsable — résumé conservé, structure vide')
      result = visitDebriefSchema.parse({})
    }
    return { result, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
  })

  return { narrative, parsed, model: null, provider: provider.name }
}
