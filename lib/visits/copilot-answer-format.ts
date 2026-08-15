// Mise en forme des réponses du Copilote — RENDU UNIQUEMENT.
//
// Le moteur (sélection des contrôles, hiérarchie de visite, rédaction) est
// validé en production le 15/08 : rien ici ne le modifie. Ce module ne fait que
// lire le texte déjà produit et le découper en blocs affichables, parce que
// l'UI l'imprimait littéralement — l'utilisateur voyait « **Pourquoi ce
// contrôle :** » au lieu d'une typographie.
//
// Forme réelle produite par le LLM sur un plan de visite (relevé sur PETRO
// ATTITI, 5 formulations, 15/08) :
//
//   Pour votre visite de demain, je vous conseille 5 contrôles :
//   1. **Gestion du matériel sur site non sécurisé**
//      * **À vérifier sur place :** Constater l'état réel…
//      * **Pourquoi ce contrôle :** Modifié le 13 août 2026…
//      * **Dernier état connu :** vérifié sur le terrain…
//      * **Changement depuis votre dernière visite :** Évolution enregistrée…
//
//   Vous n'avez encore ajouté aucun point personnel à votre plan de visite.
//
// Deux libellés varient d'une formulation à l'autre (« Pourquoi » / « Pourquoi
// ce contrôle », « Changement » / « Évolution depuis… »). On les normalise à
// l'affichage : mêmes données, moins de texte répétitif. Aucune reformulation
// de contenu — seuls les libellés d'étiquette sont raccourcis.
//
// Contrat de sûreté : tout ce qui n'est pas reconnu retombe en paragraphe. Une
// réponse courte, une réponse de fallback ou un futur format inconnu s'affichent
// comme avant, jamais dégradés.

export type CopilotField = { label: string; value: string }

export type CopilotAnswerBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'control'; index: string; title: string; fields: CopilotField[] }

const NUMBERED_RE = /^\s{0,3}(\d{1,2})[.)]\s+(.+)$/
const BULLET_RE = /^\s*[*\-–•]\s+(.+)$/
const FIELD_RE = /^\*\*\s*(.+?)\s*:?\s*\*\*\s*:?\s*(.*)$/

/** Retire le gras Markdown d'une chaîne (les titres n'ont pas besoin du marqueur). */
export function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').trim()
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Libellés longs → libellé court affiché. La clé est normalisée (sans accent,
// minuscules) pour absorber les variantes de rédaction du LLM.
const FIELD_LABELS: Array<{ match: string[]; short: string }> = [
  { match: ['a verifier sur place', 'a verifier', 'a controler sur place'], short: 'À vérifier' },
  { match: ['pourquoi ce controle', 'pourquoi', 'pourquoi ce point'], short: 'Pourquoi' },
  { match: ['dernier etat connu', 'dernier etat'], short: 'Dernier état' },
  {
    match: [
      'changement depuis votre derniere visite',
      'changement depuis la derniere visite',
      'evolution depuis votre derniere visite',
      'evolution depuis la derniere visite',
      'changement depuis',
      'evolution',
    ],
    short: 'Évolution',
  },
]

/** Raccourcit un libellé connu ; renvoie le libellé d'origine sinon. */
export function shortFieldLabel(label: string): string {
  const n = normalizeLabel(label)
  for (const entry of FIELD_LABELS) {
    if (entry.match.includes(n)) return entry.short
  }
  return label.trim()
}

/**
 * Découpe une réponse Copilote en blocs affichables.
 * Fonction pure, sans dépendance React : testable et réutilisable par toutes
 * les surfaces (bloc Aperçu, feuille mobile chantier, feuille vocale globale).
 */
export function parseCopilotAnswer(text: string): CopilotAnswerBlock[] {
  const blocks: CopilotAnswerBlock[] = []
  let current: Extract<CopilotAnswerBlock, { kind: 'control' }> | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') continue

    // « 1. **Titre du contrôle** » → ouvre un contrôle.
    const numbered = NUMBERED_RE.exec(line)
    if (numbered) {
      current = { kind: 'control', index: numbered[1], title: stripBold(numbered[2]), fields: [] }
      blocks.push(current)
      continue
    }

    // « * **À vérifier sur place :** … » → champ du contrôle courant.
    const bullet = BULLET_RE.exec(line)
    if (bullet) {
      const inner = bullet[1].trim()
      const field = FIELD_RE.exec(inner)
      if (field && current) {
        current.fields.push({ label: shortFieldLabel(field[1]), value: stripBold(field[2]) })
      } else if (current) {
        // Puce sans étiquette dans un contrôle : on garde la valeur telle quelle.
        current.fields.push({ label: '', value: stripBold(inner) })
      } else {
        blocks.push({ kind: 'bullet', text: stripBold(inner) })
      }
      continue
    }

    // Tout le reste : phrase d'ouverture, mention du plan personnel, réponse
    // libre hors plan de visite. Ferme le contrôle courant.
    current = null
    blocks.push({ kind: 'paragraph', text: line.trim() })
  }

  return blocks
}

// ── Niveaux de lecture d'un contrôle ─────────────────────────────────────────
//
// Retour terrain du 15/08 : « une check-list opérationnelle scannable en
// quelques secondes, pas cinq mini-comptes rendus ». Les quatre rubriques ne
// sont pas supprimées — elles changent de NIVEAU DE LECTURE :
//
//   lecture principale  → Qu'est-ce que je contrôle ? Pourquoi maintenant ?
//   lecture dépliée     → dernier état, dates, récurrence, sélection
//
// Aucune donnée n'est perdue : `details` reçoit tout ce qui quitte la première
// lecture, y compris le « Pourquoi » intégral quand un signal l'a résumé.

export type CopilotSignal = { text: string; tone: 'warning' | 'neutral' }

export type CopilotControlView = {
  index: string
  title: string
  /** Information principale : ce qu'il faut constater sur place. */
  check: string | null
  /** Une seule ligne, la raison d'être ici et maintenant. */
  signal: CopilotSignal | null
  /** Tout le reste, accessible en dépliant. */
  details: CopilotField[]
}

// « et est mentionné 4 fois de suite sans changement d'état »,
// « · mentionné 4 fois de suite sans changement d'état »,
// « a été mentionné 4 fois de suite sans changement d'état ».
const RECURRENCE_RE =
  /\s*(?:·|,|;|\bet\b)?\s*(?:est\s+|a\s+été\s+)?mentionné\s+(\d+)\s+fois\s+de\s+suite\s+sans\s+changement(?:\s+d['’]\s*état)?\s*\.?/i

// Consigne de récurrence répétée dans « À vérifier » — redondante avec le
// signal, elle alourdit la première lecture et part dans le détail. Le builder
// produit « Le sujet revient sans que son état change : chercher ce qui
// l'empêche d'avancer. » ; le LLM la restitue parfois tronquée à sa première
// moitié, d'où la seconde partie facultative.
const RECURRENCE_HINT_RE =
  /\s*Le sujet revient sans que son état change\s*(?::\s*chercher ce qui l['’]empêche d['’]avancer)?\s*\.?/i

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,;]+/, '')
    .replace(/[\s·,;]+$/, '')
    .replace(/\s+et$/i, '')
    .trim()
}

function endWithPeriod(text: string): string {
  if (!text) return text
  return /[.!?…]$/.test(text) ? text : `${text}.`
}

/**
 * Projette un contrôle analysé en deux niveaux de lecture.
 * Pure et testable : c'est ici, et pas dans le composant, que se décide ce qui
 * est visible d'emblée et ce qui est replié.
 */
export function toControlView(
  control: Extract<CopilotAnswerBlock, { kind: 'control' }>,
): CopilotControlView {
  let check: string | null = null
  let why: string | null = null
  let recurrence: number | null = null
  let hint: string | null = null
  const details: CopilotField[] = []

  for (const field of control.fields) {
    if (field.label === 'À vérifier' && check === null) {
      const hintMatch = RECURRENCE_HINT_RE.exec(field.value)
      if (hintMatch) hint = tidy(hintMatch[0])
      check = endWithPeriod(tidy(field.value.replace(RECURRENCE_HINT_RE, '')))
      continue
    }
    if (field.label === 'Pourquoi' && why === null) {
      const match = RECURRENCE_RE.exec(field.value)
      if (match) recurrence = Number(match[1])
      why = field.value.trim()
      continue
    }
    details.push(field)
  }

  // Un signal, un seul : la récurrence prime, sinon la raison de sélection.
  let signal: CopilotSignal | null = null
  if (recurrence !== null) {
    signal = { text: `Revient depuis ${recurrence} passages sans changement`, tone: 'warning' }
  } else if (why) {
    signal = { text: endWithPeriod(tidy(why)), tone: 'neutral' }
  }

  // Rien ne disparaît : le « Pourquoi » intégral rejoint le détail dès qu'un
  // signal l'a résumé, et la consigne de récurrence y est reversée.
  if (why && recurrence !== null) {
    details.unshift({ label: 'Pourquoi sélectionné', value: why })
  }
  if (hint) details.push({ label: 'À creuser', value: hint })

  return { index: control.index, title: control.title, check, signal, details }
}
