'use server'

// 🔍 Interroger ce site — Phase 1 « moteur d'enquête » (retrieval-only, 2026-06-16).
//
// Cible validée : pas un chatbot. Une question → des RÉSULTATS classés, typés,
// datés, sourcés, cliquables. ZÉRO LLM, zéro synthèse générative : MemorIA ne
// répond pas à la place des preuves, il les retrouve. Pas de cause inventée.
//
// Corpus (scopé au site courant) : anomalies, notes de site, notes
// d'intervention, légendes photo — via la RPC search_memory (FTS, jamais de
// donnée per-personne). Le rang « conceptuel » (embeddings) viendra en 1.5.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { searchMemory, memoryHitHref, type MemoryHitType } from '@/lib/db/memory-search'

const IdSchema = z.string().uuid()

export interface SiteMemoryHit {
  type: MemoryHitType
  id: string
  title: string
  snippet: string
  occurredAt: string
  href: string
}

export async function askSiteMemoryAction(
  siteId: string,
  question: string,
): Promise<{ ok: true; hits: SiteMemoryHit[] } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }

  const q = (question ?? '').trim().slice(0, 200)
  if (q.length < 2) return { ok: true, hits: [] }

  // search_memory scope déjà par org (getOrgId interne) ET par site_id.
  const hits = await searchMemory({ q, siteId, periodDays: 3650, limit: 30 })

  return {
    ok: true,
    hits: hits.map((h) => ({
      type: h.type,
      id: h.id,
      title: h.title,
      snippet: h.snippet,
      occurredAt: h.occurredAt,
      href: memoryHitHref(h),
    })),
  }
}
