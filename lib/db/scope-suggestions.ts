import 'server-only'

// Sprint 3.5 — ALIMENTATION des scopes : rattachement assisté.
//
// Le terrain dépose photos/anomalies au niveau du site (scope_id NULL). Ici on
// LISTE ce contenu non rattaché et on PROPOSE un sous-périmètre probable, de
// façon 100 % DÉTERMINISTE (zéro LLM, zéro coût) : corps d'état + mots-clés du
// métier + héritage (photo ↔ intervention déjà classée). L'humain valide/corrige
// — doctrine « IA propose / humain valide », terrain jamais ralenti.
//
// Les suggestions sont des INDICES, jamais des décisions : rien n'est rattaché
// sans clic. Le LLM pourra raffiner plus tard, sans rien changer à ce socle.

import { createAdminClient } from '@/lib/supabase/admin'

export interface ScopeSuggestion {
  scopeId: string
  scopeLabel: string
  /** Pourquoi cette suggestion — montré à l'humain pour qu'il juge (pas une boîte noire). */
  reason: string
}

export interface UnattachedItem {
  kind: 'action' | 'anomaly' | 'photo'
  id: string
  label: string
  sub: string | null
  createdAt: string
  suggestion: ScopeSuggestion | null
}

interface ScopeLite {
  id: string
  label: string
  scopeTypeKey: string | null
}

/** minuscule + sans accents — comparaisons robustes sur du jargon chantier. */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Synonymes BTP par scope_type_key (corps d'état). V0 déterministe et
// EXTENSIBLE : on enrichit cette table sans toucher au moteur. Les clés suivent
// org_catalog.kind='corps_etat' (cf. lib/catalog/industry-templates.ts).
const SCOPE_KEYWORDS: Record<string, string[]> = {
  // NB : pas de « parking » ici — trop ambigu (« éclairage parking » est électrique).
  // Précision >> rappel : on préfère « pas de suggestion » à une mauvaise.
  'vrd': ['vrd', 'reseau ep', 'eaux pluviales', 'regard', 'bordure', 'voirie', 'assainissement', 'caniveau', 'enrobe', 'pente', 'trottoir'],
  'electricite': ['electricite', 'tgbt', 'tableau', 'coffret', 'eclairage', 'cable', 'disjoncteur', 'divisionnaire', 'courant', 'prise', 'luminaire'],
  'gros-oeuvre': ['gros oeuvre', 'voile', 'beton', 'fissure', 'dalle', 'coffrage', 'ferraillage', 'maconnerie', 'pignon', 'poteau', 'poutre'],
  'terrassement': ['terrassement', 'remblai', 'deblai', 'fouille', 'talus', 'decapage'],
  'plomberie': ['plomberie', 'evacuation', 'canalisation', 'sanitaire', 'fuite', 'siphon'],
  'cvc': ['cvc', 'chauffage', 'ventilation', 'climatisation', 'gaine', 'vmc', 'clim'],
  'charpente': ['charpente', 'toiture', 'couverture', 'etancheite', 'zinguerie'],
  'menuiserie': ['menuiserie', 'porte', 'fenetre', 'vitrage', 'cloison'],
  'peinture': ['peinture', 'enduit', 'revetement'],
}

/** Suggère le scope le plus probable pour un contenu, à partir de son texte et
 *  de son corps d'état. Renvoie null si aucun signal fiable (mieux vaut « non
 *  rattaché » qu'une mauvaise suggestion — précision >> rappel). */
function suggestScope(text: string, corpsEtat: string | null, scopes: ScopeLite[]): ScopeSuggestion | null {
  const t = norm(text)
  const ce = norm(corpsEtat)
  let best: { sc: ScopeLite; score: number; reason: string } | null = null

  for (const sc of scopes) {
    const label = norm(sc.label)
    const key = norm(sc.scopeTypeKey)
    let score = 0
    let reason = ''

    // Corps d'état exact = signal le plus fort (l'action porte déjà son métier).
    if (ce && (ce === label || (key && ce === key))) {
      score += 10
      reason = `corps d'état « ${sc.label} »`
    }
    // Le label du scope apparaît littéralement dans le texte.
    if (label && t.includes(label)) {
      score += 4
      if (!reason) reason = `mentionne « ${sc.label} »`
    }
    // Mots-clés métier du type.
    const kws = sc.scopeTypeKey ? (SCOPE_KEYWORDS[sc.scopeTypeKey] ?? []) : []
    for (const kw of kws) {
      if (kw && (t.includes(kw) || ce === kw)) {
        score += 2
        if (!reason) reason = `mentionne « ${kw} »`
      }
    }

    if (score > 0 && (!best || score > best.score)) best = { sc, score, reason }
  }

  if (!best) return null
  return { scopeId: best.sc.id, scopeLabel: best.sc.label, reason: best.reason }
}

const SITE_EMBED = 'intervention:interventions!inner(mission:missions!inner(site_id, organization_id))'

/** Contenu d'un site NON rattaché à un sous-périmètre, avec une suggestion. */
export async function listUnattachedContent(siteId: string, orgId: string): Promise<UnattachedItem[]> {
  const supabase = createAdminClient()

  // Scopes du site (légers) — la cible des suggestions.
  const { data: scopeRows } = await supabase
    .from('memory_scopes')
    .select('id, label, scope_type_key')
    .eq('site_id', siteId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .eq('active', true)
    .order('label', { ascending: true }) // ordre stable → égalités de score résolues de façon déterministe
  const scopes: ScopeLite[] = ((scopeRows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    scopeTypeKey: (r.scope_type_key as string | null) ?? null,
  }))
  if (scopes.length === 0) return [] // rien où rattacher → rien à proposer

  const [actionsRes, anomaliesRes, photosRes, attachedAnoRes] = await Promise.all([
    supabase
      .from('site_actions')
      .select('id, title, body, corps_etat, created_at')
      .eq('site_id', siteId)
      .is('scope_id', null)
      .in('status', ['open', 'planned', 'done'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('intervention_anomalies')
      .select(`id, category, category_other, description, created_at, intervention_id, ${SITE_EMBED}`)
      .eq('organization_id', orgId)
      .is('scope_id', null)
      .eq('intervention.mission.site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('intervention_photos')
      .select(`id, caption, kind, taken_at, intervention_id, ${SITE_EMBED}`)
      .is('scope_id', null)
      .eq('intervention.mission.site_id', siteId)
      .eq('intervention.mission.organization_id', orgId)
      .order('taken_at', { ascending: false })
      .limit(100),
    // Anomalies DÉJÀ classées → carte intervention_id ⇒ scope, pour faire hériter
    // les photos de la même intervention (« même intervention qu'une anomalie VRD »).
    supabase
      .from('intervention_anomalies')
      .select(`intervention_id, scope_id, ${SITE_EMBED}`)
      .eq('organization_id', orgId)
      .not('scope_id', 'is', null)
      .eq('intervention.mission.site_id', siteId)
      .limit(500),
  ])

  const scopeById = new Map(scopes.map((s) => [s.id, s]))
  const intvScope = new Map<string, string>() // intervention_id → scope_id
  for (const r of (attachedAnoRes.data ?? []) as Record<string, unknown>[]) {
    const iid = r.intervention_id as string | null
    const sid = r.scope_id as string | null
    if (iid && sid && !intvScope.has(iid)) intvScope.set(iid, sid)
  }

  const items: UnattachedItem[] = []

  for (const r of (actionsRes.data ?? []) as Record<string, unknown>[]) {
    const title = (r.title as string) ?? ''
    const body = (r.body as string | null) ?? ''
    const corps = (r.corps_etat as string | null) ?? null
    items.push({
      kind: 'action',
      id: r.id as string,
      label: title || 'Action',
      sub: corps,
      createdAt: r.created_at as string,
      suggestion: suggestScope(`${title} ${body}`, corps, scopes),
    })
  }

  for (const r of (anomaliesRes.data ?? []) as Record<string, unknown>[]) {
    const desc = (r.description as string | null) ?? ''
    const cat = (r.category as string | null) ?? ''
    const catOther = (r.category_other as string | null) ?? ''
    items.push({
      kind: 'anomaly',
      id: r.id as string,
      label: desc.trim() || catOther.trim() || cat || 'Anomalie',
      sub: cat || null,
      createdAt: r.created_at as string,
      suggestion: suggestScope(`${desc} ${cat} ${catOther}`, null, scopes),
    })
  }

  for (const r of (photosRes.data ?? []) as Record<string, unknown>[]) {
    const caption = (r.caption as string | null) ?? ''
    const kind = (r.kind as string | null) ?? ''
    const iid = (r.intervention_id as string | null) ?? null
    // 1) suggestion par texte (légende) ; 2) à défaut, héritage de l'intervention.
    let suggestion = suggestScope(caption, null, scopes)
    if (!suggestion && iid && intvScope.has(iid)) {
      const sc = scopeById.get(intvScope.get(iid)!)
      if (sc) suggestion = { scopeId: sc.id, scopeLabel: sc.label, reason: 'même intervention qu’une anomalie déjà classée' }
    }
    items.push({
      kind: 'photo',
      id: r.id as string,
      label: caption.trim() || (kind === 'anomaly' ? 'Photo (anomalie)' : 'Photo (passage)'),
      sub: (r.taken_at as string | null) ? new Date(r.taken_at as string).toLocaleDateString('fr-FR') : null,
      createdAt: (r.taken_at as string) ?? (r.created_at as string) ?? '',
      suggestion,
    })
  }

  // Les items AVEC suggestion d'abord (action immédiate possible), puis récence.
  items.sort((a, b) => {
    if (!!a.suggestion !== !!b.suggestion) return a.suggestion ? -1 : 1
    return (a.createdAt < b.createdAt ? 1 : -1)
  })
  return items
}
