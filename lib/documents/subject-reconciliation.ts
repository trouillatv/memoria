import 'server-only'

// Seuil de similarité Jaccard pour les propositions non-intervenants.
// 0.5 = 50 % de tokens en commun (après normalisation).
// Valeur tunable : abaisser → plus de correspondances (risque faux positifs),
// augmenter → plus strict (risque de rater des fils réels).
const SIMILARITY_THRESHOLD = 0.5

// Stopwords français courants — retirés avant comparaison pour se concentrer
// sur les tokens porteurs de sens (matériau, localisation, désignation technique).
const STOPWORDS = new Set([
  'de','du','la','le','les','des','un','une','et','ou','à','au','aux',
  'en','par','pour','sur','sous','dans','avec','sans','ce','se','sa',
  'son','ses','l','d','est','sont','été','être','avoir','y','il','ils',
])

/**
 * Normalise un label pour la comparaison :
 * minuscules → suppression accents → alphanumériques uniquement → filtrage stopwords
 */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // supprimer les diacritiques
    .replace(/[^a-z0-9\s]/g, ' ')      // garder alphanumérique + espaces
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .join(' ')
    .trim()
}

/**
 * Similarité de Jaccard sur ensembles de tokens.
 * Deux labels parfaitement identiques → 1.0. Sans tokens communs → 0.
 * Exportée pour les tests unitaires.
 */
export function jaccardSimilarity(labelA: string, labelB: string): number {
  const tokA = new Set(normalizeLabel(labelA).split(' ').filter(Boolean))
  const tokB = new Set(normalizeLabel(labelB).split(' ').filter(Boolean))
  if (tokA.size === 0 && tokB.size === 0) return 1
  if (tokA.size === 0 || tokB.size === 0) return 0
  let intersection = 0
  for (const t of tokA) { if (tokB.has(t)) intersection++ }
  const union = tokA.size + tokB.size - intersection
  return intersection / union
}

type ProposalStub = {
  id: string
  proposal_family: string
  thematic_category: string | null
  label: string
  subject_thread_id: string | null
}

function isPersonLike(family: string): boolean {
  return family === 'person' || family === 'company'
}

/**
 * Cherche la meilleure correspondance dans les propositions antérieures.
 * Retourne le subject_thread_id du meilleur match, ou null si aucun.
 */
function findBestThread(newProp: ProposalStub, priors: ProposalStub[]): string | null {
  const sameFamilyPriors = priors.filter(
    (p) => p.proposal_family === newProp.proposal_family && p.subject_thread_id !== null,
  )

  if (isPersonLike(newProp.proposal_family)) {
    // Intervenants : correspondance exacte sur nom normalisé
    const newNorm = normalizeLabel(newProp.label)
    const match = sameFamilyPriors.find((p) => normalizeLabel(p.label) === newNorm)
    return match?.subject_thread_id ?? null
  }

  // Propositions de contenu : famille + thème + Jaccard
  const sameTheme = sameFamilyPriors.filter(
    (p) => p.thematic_category === newProp.thematic_category,
  )
  let bestScore = 0
  let bestThread: string | null = null
  for (const prior of sameTheme) {
    const score = jaccardSimilarity(newProp.label, prior.label)
    if (score > bestScore) {
      bestScore = score
      bestThread = prior.subject_thread_id
    }
  }
  return bestScore >= SIMILARITY_THRESHOLD ? bestThread : null
}

/**
 * Assigne un subject_thread_id à toutes les propositions d'un run qui n'en ont pas encore.
 *
 * - Si une proposition antérieure sur le même chantier correspond → même thread.
 * - Sinon → nouveau UUID (premier PV à mentionner ce sujet).
 *
 * Appelé après la fin de l'extraction (run → ready_for_review).
 * Idempotent : les propositions déjà assignées sont ignorées.
 *
 * Retourne { matched, created } pour logging.
 */
export async function reconcileSubjectThreads(
  runId: string,
  siteId: string,
): Promise<{ matched: number; created: number }> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  // Charger les nouvelles propositions sans thread (idempotent : skip les assignées)
  const { data: newRaw, error: newErr } = await supabase
    .from('document_extraction_proposal')
    .select('id, proposal_family, thematic_category, label, subject_thread_id')
    .eq('extraction_run_id', runId)
    .is('subject_thread_id', null)
  if (newErr) throw new Error(newErr.message)
  if (!newRaw?.length) return { matched: 0, created: 0 }
  const newProposals = newRaw as ProposalStub[]

  // Charger les propositions antérieures issues uniquement des runs canoniques.
  // Les re-analyses non-canoniques sont exclues pour éviter la pollution du graphe thématique.
  const { data: canonicalRunsData } = await supabase
    .from('document_extraction_run')
    .select('id')
    .eq('target_site_id', siteId)
    .eq('is_canonical', true)
    .neq('id', runId)
  const canonicalRunIds = ((canonicalRunsData ?? []) as Array<{ id: string }>).map((r) => r.id)

  let priorProposals: ProposalStub[] = []
  if (canonicalRunIds.length > 0) {
    const { data: priorRaw, error: priorErr } = await supabase
      .from('document_extraction_proposal')
      .select('id, proposal_family, thematic_category, label, subject_thread_id')
      .in('extraction_run_id', canonicalRunIds)
      .not('subject_thread_id', 'is', null)
    if (priorErr) throw new Error(priorErr.message)
    priorProposals = (priorRaw ?? []) as ProposalStub[]
  }

  let matched = 0
  let created = 0

  const assignments = newProposals.map((p) => {
    const existingThread = findBestThread(p, priorProposals)
    const subject_thread_id = existingThread ?? crypto.randomUUID()
    if (existingThread) matched++; else created++
    return { id: p.id, subject_thread_id }
  })

  // Mise à jour individuelle — les runs ont ~50–150 propositions max
  const errors: string[] = []
  await Promise.all(
    assignments.map(async ({ id, subject_thread_id }) => {
      const { error } = await supabase
        .from('document_extraction_proposal')
        .update({ subject_thread_id })
        .eq('id', id)
      if (error) errors.push(error.message)
    }),
  )
  if (errors.length > 0) throw new Error(`subject_thread assignment: ${errors.join('; ')}`)

  return { matched, created }
}

/**
 * Mappe le texte libre statusAtDocumentDate → enum document_status normalisé.
 * Ne s'applique pas aux intervenants (person / company) dont le statut est la présence.
 *
 * Ordre du plus spécifique au plus général pour éviter les collisions :
 * ex. "non démarré" doit → planned avant que "démarr" → in_progress soit testé ;
 *     "VISA en cours" doit → awaiting_validation avant que "en cours" → in_progress ;
 *     "partiellement réalisé" doit → in_progress avant que "réalis" → done.
 */
export function mapDocumentStatus(
  statusAtDocumentDate: string | null | undefined,
  family: string,
): string | null {
  if (family === 'person' || family === 'company') return null
  if (!statusAtDocumentDate) return null
  const s = statusAtDocumentDate.toLowerCase()
  if (/non conform|refus|hors tolérance/.test(s)) return 'non_compliant'
  if (/non démarr|non commenc|prévu|planif|programm/.test(s)) return 'planned'
  if (/en attente|attendu|visa|validation/.test(s)) return 'awaiting_validation'
  if (/annul|abandonn/.test(s)) return 'cancelled'
  if (/en cours|partiell|démarr/.test(s)) return 'in_progress'
  if (/réalis|termin|levé|exécut|accompl/.test(s) || s === 'fait') return 'done'
  if (/ouvert|signalé|constaté/.test(s)) return 'open'
  return 'informational'
}
