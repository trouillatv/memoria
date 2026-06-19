// Sprint 4.5 — Clé de groupement des responsables.
//
// SEUL endroit qui « sait » regrouper des libellés `assigned_to`. C'est la
// couture vers le futur modèle Entreprise → Contacts → Actions : le jour où
// l'entité existe, on mappe `responsibleKey → entreprise` ici sans toucher les
// appelants.
//
// Normalisation CONSERVATRICE (décision Vincent 2026-06-19) : casse + espaces
// uniquement. PAS de strip des suffixes juridiques (SARL/SAS/NC…) → éviter les
// fusions fausses (« D3T » ≠ « D3T Élec »). La vraie déduplication viendra avec
// une réconciliation humaine, plus tard. `assigned_to` n'est JAMAIS réécrit.

/** Clé de regroupement stable et conservatrice. '' si pas de responsable. */
export function responsibleKey(label: string | null | undefined): string {
  return (label ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
}

/**
 * Libellé affiché pour un groupe : la variante la PLUS FRÉQUENTE (à fréquence
 * égale, la plus longue/complète). On affiche l'orthographe réelle des gens,
 * pas la clé normalisée.
 */
export function canonicalLabel(variants: string[]): string {
  const counts = new Map<string, { count: number; label: string }>()
  for (const raw of variants) {
    const label = (raw ?? '').trim()
    if (!label) continue
    const k = responsibleKey(label)
    const cur = counts.get(k)
    if (!cur) counts.set(k, { count: 1, label })
    else {
      cur.count += 1
      // À fréquence égale on garde la forme la plus longue (souvent la + complète).
      if (label.length > cur.label.length) cur.label = label
    }
  }
  let best: { count: number; label: string } | null = null
  for (const v of counts.values()) {
    if (!best || v.count > best.count || (v.count === best.count && v.label.length > best.label.length)) best = v
  }
  return best?.label ?? ''
}
