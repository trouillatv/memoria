// P1-5A — Classification P0-2 des paires candidates OCEF.
// MODE LECTURE SEULE STRICT — aucune mutation DB, aucun merge, aucun backfill, aucun commit.
//
// Réutilise :
//   - Les verdicts P0-2 déjà connus (22 paires validées dans _validate-p02-ocef.ts + doc P0-1-P0-2)
//   - analyzeSubjectPair() UNIQUEMENT pour les paires candidates non couvertes
//
// Classification de chaque paire :
//   SAFE_SAME        : same_subject, confidence >= 85, pas de distinction métier visible
//   RELATED_NOT_SAME : related
//   DISTINCT         : distinct OU confidence < 60
//   UNCERTAIN        : uncertain OU confidence 60-84 sans preuve claire
//
// Garde acteur : une paire dont un des deux CS est un acteur (company_id/contact_id) OU
// dont les labels ressemblent à des noms de personnes est forcée en DISTINCT sans Gemini
// (COLL-5 : ne jamais fusionner deux acteurs distincts).
//
// Usage : npx tsx scripts/_p15a-classify.ts > audit-p15a-classify.json 2>audit-p15a-classify.err

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { analyzeSubjectPair } from '../lib/subjects/similarity-analyze'

const OCEF_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'

// Verdicts P0-2 déjà connus, indexés par paire de labels normalisés (ordre indifférent).
// Source : docs/memory-longitudinal-v1/P0-1-P0-2-VALIDATION.md (résultats du run validé).
const KNOWN: Array<{ a: string; b: string; verdict: string; conf: number }> = [
  { a: 'Coordination Réseaux sous-dalle LOT01 et LOT02', b: 'Coordination à faire entre LOT01 et LOT02', verdict: 'same_subject', conf: 95 },
  { a: 'Coordination réseaux sous-dalle (LOT01 & LOT02)', b: 'Coordination à faire entre LOT01 et LOT02', verdict: 'same_subject', conf: 95 },
  { a: 'Gestion des Eaux (GDE) : Busage Provisoire', b: 'GDE - Busage Provisoire', verdict: 'same_subject', conf: 98 },
  { a: 'GDE - Fossé', b: 'Gestion des Eaux : Fossé', verdict: 'same_subject', conf: 98 },
  { a: 'Accès Plateforme : Déblais réalisés', b: 'Accès Plateforme - Travaux réalisés', verdict: 'same_subject', conf: 95 },
  { a: 'Déblais/Remblais plateforme', b: 'Terrassement Plateforme Déblais/Remblais', verdict: 'same_subject', conf: 98 },
  // BORDER documentés (classés same_subject 95 par Gemini, mais réservés pour review humaine)
  { a: 'Démarrage purge', b: 'Purge de la plateforme', verdict: 'same_subject', conf: 95 },
  { a: 'Couche de forme Accès Plateforme', b: 'GNT sur plateforme', verdict: 'same_subject', conf: 95 },
  // DISTINCT gardes
  { a: 'GDE - Busage Provisoire', b: 'GDE - Fossé', verdict: 'related', conf: 60 },
  { a: 'Accès au site', b: 'Accès Plateforme', verdict: 'related', conf: 60 },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
function findKnown(la: string, lb: string) {
  const a = norm(la), b = norm(lb)
  for (const k of KNOWN) {
    const ka = norm(k.a), kb = norm(k.b)
    if ((a === ka && b === kb) || (a === kb && b === ka)) return k
  }
  return null
}

// Heuristique acteur (stricte) : civilité OU initiale pointée suivie d'un patronyme.
// Ex: "M. DEVALLEZ", "G. DEVALLEZ", "Mme Dupont". Ne doit PAS matcher un sigle métier (GDE).
const looksLikePerson = (l: string) => {
  const t = l.trim()
  return /^(M\.|Mme|Mr|Dr|Mlle)\s+[A-ZÀ-Ÿ]/.test(t) || /^[A-ZÀ-Ÿ]\.\s+[A-ZÀ-Ÿ][a-zà-ÿA-ZÀ-Ÿ]+$/.test(t)
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const inv = JSON.parse(readFileSync('audit-p15a-inventory.clean.json', 'utf8'))
  const candidates: Array<{
    aId: string; bId: string; aLabel: string; bLabel: string
    normA: string; normB: string; jaccard: number
    aOcc: number; bOcc: number; aThreads: number; bThreads: number
    aCreated: string; bCreated: string
  }> = inv.candidatePairs

  // acteurs : IDs avec company_id/contact_id
  const { data: actorRaw } = await sb
    .from('canonical_subject')
    .select('id, label, company_id, contact_id')
    .eq('site_id', OCEF_SITE_ID)
    .or('company_id.not.is.null,contact_id.not.is.null')
  const actorIds = new Set(((actorRaw ?? []) as Array<{ id: string }>).map((r) => r.id))

  type Row = {
    aLabel: string; bLabel: string; aId: string; bId: string
    jaccard: number; aOcc: number; bOcc: number; aThreads: number; bThreads: number
    verdict: string; confidence: number; reason: string; source: string
    classification: string
  }
  const rows: Row[] = []

  for (const c of candidates) {
    let verdict = '', conf = 0, reason = '', source = ''

    // Garde acteur COLL-5
    const actorPair = actorIds.has(c.aId) || actorIds.has(c.bId) || (looksLikePerson(c.aLabel) && looksLikePerson(c.bLabel))
    if (actorPair) {
      verdict = 'distinct'; conf = 0; reason = 'ACTOR_GUARD_COLL5 — acteur/personne, jamais fusionné automatiquement'; source = 'guard'
    } else {
      const known = findKnown(c.aLabel, c.bLabel)
      if (known) {
        verdict = known.verdict; conf = known.conf; reason = 'verdict P0-2 pré-existant (validé)'; source = 'known'
      } else {
        try {
          const res = await analyzeSubjectPair(
            { id: c.aId, label: c.aLabel, aliases: [] },
            { id: c.bId, label: c.bLabel, aliases: [] },
            null,
          )
          verdict = res.verdict; conf = res.score; reason = res.reason; source = 'gemini'
        } catch (e) {
          verdict = 'error'; conf = 0; reason = String(e).slice(0, 120); source = 'error'
        }
      }
    }

    // Classification
    let classification: string
    if (verdict === 'same_subject' && conf >= 85) classification = 'SAFE_SAME'
    else if (verdict === 'related') classification = 'RELATED_NOT_SAME'
    else if (verdict === 'distinct' || conf < 60) classification = 'DISTINCT'
    else classification = 'UNCERTAIN' // uncertain, ou 60-84 sans preuve

    rows.push({
      aLabel: c.aLabel, bLabel: c.bLabel, aId: c.aId, bId: c.bId,
      jaccard: c.jaccard, aOcc: c.aOcc, bOcc: c.bOcc, aThreads: c.aThreads, bThreads: c.bThreads,
      verdict, confidence: conf, reason, source, classification,
    })
  }

  const summary = {
    SAFE_SAME: rows.filter((r) => r.classification === 'SAFE_SAME').length,
    RELATED_NOT_SAME: rows.filter((r) => r.classification === 'RELATED_NOT_SAME').length,
    DISTINCT: rows.filter((r) => r.classification === 'DISTINCT').length,
    UNCERTAIN: rows.filter((r) => r.classification === 'UNCERTAIN').length,
    total: rows.length,
    fromGemini: rows.filter((r) => r.source === 'gemini').length,
    fromKnown: rows.filter((r) => r.source === 'known').length,
    fromGuard: rows.filter((r) => r.source === 'guard').length,
  }

  process.stdout.write(JSON.stringify({ summary, rows }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
