// LA NUIT DE MEMORIA — lecture/écriture du digest nocturne (mig 191).
//
// Chaque nuit, le cron /api/cron/night-digest rejoue les détecteurs mémoire
// déterministes (buildSiteMemorySignals) sur chaque chantier actif et persiste
// le résultat ici. Le matin, le dashboard LIT — il ne recalcule plus.
//
// Doctrine :
//   * Read-model persisté : donnée dérivée, reconstructible, jamais source de
//     vérité. Un digest vide est écrit aussi (signal_count = 0) pour distinguer
//     « rien à signaler » (silence vert assumé) de « pas encore calculé ».
//   * UNE apparition : le matin. Pas de notification au fil de l'eau.
//   * Zéro LLM. Wording descriptif, calme (discipline d'apparition).

import { createAdminClient } from '@/lib/supabase/admin'
import { SCENE_ORDER } from '@/lib/scene'
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'

export interface SiteMorningDigestRow {
  siteId: string
  siteName: string | null
  digestDate: string
  signals: MemorySignal[]
  signalCount: number
  computedAt: string
}

export interface OrgMorningDigest {
  date: string
  sites: SiteMorningDigestRow[]
  totalSignals: number
  /** Dernier calcul (max computed_at) — « relu cette nuit à 06h02 ». */
  computedAt: string | null
}

/** Ordre éditorial du MATIN — vit désormais dans la MISE EN SCÈNE
 *  (lib/mise-en-scene.ts : la couture choisit l'ordre du récit). Ré-exporté ici
 *  pour compatibilité (tests, consommateurs existants). */
export const MORNING_KIND_PRIORITY: SignalKind[] = SCENE_ORDER.matin

/** Écrit (upsert) le digest d'un chantier pour une date civile Nouméa.
 *  Appelé UNIQUEMENT par le cron de la Nuit (service-role). */
export async function writeSiteMorningDigest(params: {
  siteId: string
  organizationId: string | null
  digestDate: string
  signals: MemorySignal[]
  durationMs?: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await createAdminClient()
    .from('site_morning_digest')
    .upsert(
      {
        site_id: params.siteId,
        organization_id: params.organizationId,
        digest_date: params.digestDate,
        signals: params.signals,
        signal_count: params.signals.reduce((n, s) => n + s.items.length, 0),
        computed_at: new Date().toISOString(),
        duration_ms: params.durationMs ?? null,
      },
      { onConflict: 'site_id,digest_date' },
    )
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Purge les digests plus vieux que `retentionDays` (le digest sert LE matin,
 *  l'historique vit dans les tables métier). */
export async function purgeOldDigests(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString().slice(0, 10)
  const { data } = await createAdminClient()
    .from('site_morning_digest')
    .delete()
    .lt('digest_date', cutoff)
    .select('id')
  return data?.length ?? 0
}

/** Le digest du matin pour toute l'org (date civile Nouméa). Retourne null si
 *  la Nuit n'a pas tourné pour cette date → l'appelant garde son fallback live. */
export async function getOrgMorningDigest(orgId: string, date = todayLocalIso()): Promise<OrgMorningDigest | null> {
  const { data } = await createAdminClient()
    .from('site_morning_digest')
    .select('site_id, digest_date, signals, signal_count, computed_at, sites(name)')
    .eq('organization_id', orgId)
    .eq('digest_date', date)
    .order('signal_count', { ascending: false })
  const rows = data ?? []
  if (rows.length === 0) return null
  const sites: SiteMorningDigestRow[] = rows.map((r) => {
    const site = r.sites as { name?: string | null } | { name?: string | null }[] | null
    const siteName = Array.isArray(site) ? (site[0]?.name ?? null) : (site?.name ?? null)
    return {
      siteId: r.site_id as string,
      siteName,
      digestDate: r.digest_date as string,
      signals: (r.signals ?? []) as MemorySignal[],
      signalCount: (r.signal_count as number) ?? 0,
      computedAt: r.computed_at as string,
    }
  })
  return {
    date,
    sites,
    totalSignals: sites.reduce((n, s) => n + s.signalCount, 0),
    computedAt: sites.reduce<string | null>((max, s) => (max && max > s.computedAt ? max : s.computedAt), null),
  }
}

/** Le digest du matin pour MON organisation (résolution getOrgId, pattern
 *  maison — le client admin bypasse les RLS, on re-scope par org). */
export async function getMyOrgMorningDigest(date = todayLocalIso()): Promise<OrgMorningDigest | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  return getOrgMorningDigest(orgId, date)
}

/** Le digest du matin pour UN chantier (page site / préparation de visite). */
export async function getSiteMorningDigest(siteId: string, date = todayLocalIso()): Promise<SiteMorningDigestRow | null> {
  const { data } = await createAdminClient()
    .from('site_morning_digest')
    .select('site_id, digest_date, signals, signal_count, computed_at, sites(name)')
    .eq('site_id', siteId)
    .eq('digest_date', date)
    .maybeSingle()
  if (!data) return null
  const site = data.sites as { name?: string | null } | { name?: string | null }[] | null
  return {
    siteId: data.site_id as string,
    siteName: Array.isArray(site) ? (site[0]?.name ?? null) : (site?.name ?? null),
    digestDate: data.digest_date as string,
    signals: (data.signals ?? []) as MemorySignal[],
    signalCount: (data.signal_count as number) ?? 0,
    computedAt: data.computed_at as string,
  }
}

// ─── Helpers PURS (testables sans DB) ────────────────────────────────────────

export interface MorningFocusItem {
  siteId: string
  siteName: string | null
  signal: MemorySignal
}

function kindRank(kind: SignalKind): number {
  const i = MORNING_KIND_PRIORITY.indexOf(kind)
  return i === -1 ? MORNING_KIND_PRIORITY.length : i
}

/** Le signal le plus pressant d'un chantier, selon l'ordre éditorial du matin. */
export function topMorningSignal(signals: MemorySignal[]): MemorySignal | null {
  if (signals.length === 0) return null
  return [...signals].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.items.length - a.items.length)[0]
}

/** Composition éditoriale du MATIN (discipline d'apparition) : au plus `max`
 *  éléments dans toute l'org — un chantier n'apparaît qu'une fois, via son
 *  signal le plus pressant. Le reste se tait (il reste consultable par site). */
export function pickMorningFocus(digest: OrgMorningDigest, max = 2): MorningFocusItem[] {
  const candidates: MorningFocusItem[] = []
  for (const site of digest.sites) {
    const top = topMorningSignal(site.signals)
    if (top) candidates.push({ siteId: site.siteId, siteName: site.siteName, signal: top })
  }
  return candidates
    .sort((a, b) => kindRank(a.signal.kind) - kindRank(b.signal.kind) || b.signal.items.length - a.signal.items.length)
    .slice(0, max)
}

/** Vrai si la nuit n'a RIEN trouvé sur toute l'org → « silence vert » assumé
 *  (différent de « pas calculé » : ici le digest existe, il est vide). */
export function isQuietMorning(digest: OrgMorningDigest): boolean {
  return digest.totalSignals === 0
}
