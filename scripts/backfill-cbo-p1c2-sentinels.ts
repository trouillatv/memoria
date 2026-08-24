// Backfill P1-C2A/étape 4 — canonical_business_object sur les sentinelles validées
//
// Périmètre STRICT (validé par Vincent, 2026-08-24) : uniquement les 6 sujets sentinelles
// P1-C2 (Regard R4, Enrobage, Débourbeur/Zone déshuileur, Busage, Lagunage, FT Matériaux).
// Aucune autre entité du dépôt n'est touchée. Aucun status d'action/réserve/échéance n'est modifié.
//
// Pour chaque (sujet, object_type) avec ≥2 entités ouvertes :
//   - appelle resolveCanonicalBusinessObjectGroups() (même resolver que le dry-run)
//   - pour chaque groupe retourné, crée un canonical_business_object + ses membres
//     avec resolution_source='llm', llm_confidence, llm_reasoning
//   - idempotent : si un membre appartient déjà à un CBO (ex. Enrobage, pilote manuel du
//     2026-08-09), le groupe entier est sauté (log), jamais d'insertion partielle
//
// Usage :
//   npx tsx --env-file=.env.local scripts/backfill-cbo-p1c2-sentinels.ts --dry-run   # aperçu, aucune écriture
//   npx tsx --env-file=.env.local scripts/backfill-cbo-p1c2-sentinels.ts             # écriture réelle

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import {
  getCanonicalSubjectEntities,
  resolveCanonicalBusinessObjectGroups,
  type CanonicalBusinessObjectEntityType,
} from '../lib/db/canonical-business-object-resolve'

const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const SENTINELS: Array<{ label: string; canonicalSubjectId: string; types: CanonicalBusinessObjectEntityType[] }> = [
  { label: 'Regard R4',                    canonicalSubjectId: '4fb967c3-4432-4bc2-9e47-e626fcd6fa84', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Enrobage',                     canonicalSubjectId: '4981ddb0-4fdd-4a60-a216-e18a3ad86cb7', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Débourbeur / Zone déshuileur', canonicalSubjectId: 'ce73b108-c4f1-486b-b421-338d44e0943c', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Busage',                       canonicalSubjectId: '5a507b15-eae0-49dd-9076-2c915e45d3d6', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Lagunage',                     canonicalSubjectId: '2bff30b9-8298-4363-89db-45f12eb8c0bd', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'FT Matériaux',                 canonicalSubjectId: '9e7bc5cb-0ee2-4eed-a8f5-2a9d1f47f593', types: ['site_reserve', 'site_action', 'site_deadline'] },
]

function sep(label: string) {
  console.log(`\n${'─'.repeat(70)}\n${label}\n${'─'.repeat(70)}`)
}

async function getSiteId(canonicalSubjectId: string): Promise<string | null> {
  const { data } = await sb.from('canonical_subject').select('site_id').eq('id', canonicalSubjectId).single()
  return data?.site_id ?? null
}

async function alreadyCovered(entityIds: string[]): Promise<Set<string>> {
  if (!entityIds.length) return new Set()
  const { data } = await sb
    .from('canonical_business_object_member')
    .select('member_entity_id')
    .in('member_entity_id', entityIds)
  return new Set((data ?? []).map((r) => r.member_entity_id))
}

let created = 0
let membersCreated = 0
let skippedAlreadyCovered = 0

async function main() {
  console.log(`\n=== P1-C2A/étape 4 — Backfill canonical_business_object (sentinelles validées) ===`)
  if (DRY_RUN) console.log('⚡ DRY-RUN — aucune écriture en base\n')

  for (const sentinel of SENTINELS) {
    const siteId = await getSiteId(sentinel.canonicalSubjectId)
    if (!siteId) {
      console.log(`\n[SKIP] ${sentinel.label} — canonical_subject introuvable`)
      continue
    }

    for (const targetType of sentinel.types) {
      const entities = await getCanonicalSubjectEntities(sentinel.canonicalSubjectId, targetType)
      if (entities.length < 2) continue

      const groups = await resolveCanonicalBusinessObjectGroups(entities)
      if (!groups.length) {
        console.log(`\n[SKIP] ${sentinel.label} / ${targetType} — resolver n'a retourné aucun groupe`)
        continue
      }

      sep(`${sentinel.label} — ${targetType}`)

      for (const g of groups) {
        const covered = await alreadyCovered(g.members)
        if (covered.size === g.members.length) {
          console.log(`  ⏭ "${g.label}" — déjà couvert par un CBO existant (pilote manuel), skip`)
          skippedAlreadyCovered++
          continue
        }
        if (covered.size > 0) {
          console.log(`  ⚠ "${g.label}" — couverture PARTIELLE (${covered.size}/${g.members.length} membres déjà en CBO), skip par prudence`)
          continue
        }

        console.log(`  → "${g.label}" [${g.decision} ${(g.confidence * 100).toFixed(0)}%] — ${g.members.length} membre(s)`)

        if (DRY_RUN) {
          console.log(`     [DRY-RUN] insertion différée`)
          continue
        }

        const { data: cbo, error } = await sb
          .from('canonical_business_object')
          .insert({
            site_id: siteId,
            object_type: targetType,
            label: g.label,
            canonical_subject_id: sentinel.canonicalSubjectId,
          })
          .select('id')
          .single()

        if (error || !cbo) {
          console.error(`     ✗ erreur insertion CBO: ${error?.message}`)
          continue
        }

        const memberRows = g.members.map((entityId) => ({
          canonical_business_object_id: cbo.id,
          member_entity_type: targetType,
          member_entity_id: entityId,
          resolution_source: 'llm' as const,
          llm_confidence: g.confidence,
          llm_reasoning: g.reasoning,
        }))

        const { error: membErr } = await sb.from('canonical_business_object_member').insert(memberRows)
        if (membErr) {
          console.error(`     ✗ erreur insertion membres: ${membErr.message}`)
          continue
        }

        console.log(`     ✓ CBO créé (${cbo.id.slice(0, 8)})`)
        created++
        membersCreated += memberRows.length
      }
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Synthèse : ${created} CBO créé(s), ${membersCreated} membre(s), ${skippedAlreadyCovered} groupe(s) déjà couvert(s) sauté(s).`)
  if (DRY_RUN) console.log('Aucune écriture DB effectuée (dry-run).')
}

main().catch((e) => { console.error(e); process.exit(1) })
