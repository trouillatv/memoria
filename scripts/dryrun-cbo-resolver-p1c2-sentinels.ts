// Dry-run P1-C2A/step2 — Resolver canonical_business_object sur les 5 sentinelles P1-C2
//
// Aucune écriture en base. Appelle resolveCanonicalBusinessObjectGroups() (lib/db/canonical-business-object-resolve.ts)
// sur les entités ouvertes (site_action / site_reserve / site_deadline) de chaque sujet canonique sentinelle,
// et affiche les groupes SAME_OBJECT / RELATED_BUT_DISTINCT / UNCERTAIN pour validation humaine (Vincent, étape 3).
//
// Usage :
//   npx tsx --env-file=.env.local scripts/dryrun-cbo-resolver-p1c2-sentinels.ts

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import {
  getCanonicalSubjectEntities,
  resolveCanonicalBusinessObjectGroups,
  type CanonicalBusinessObjectEntityType,
} from '../lib/db/canonical-business-object-resolve'

const SENTINELS: Array<{ label: string; canonicalSubjectId: string; types: CanonicalBusinessObjectEntityType[] }> = [
  { label: 'Regard R4',                       canonicalSubjectId: '4fb967c3-4432-4bc2-9e47-e626fcd6fa84', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Enrobage',                        canonicalSubjectId: '4981ddb0-4fdd-4a60-a216-e18a3ad86cb7', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Débourbeur / Zone déshuileur',    canonicalSubjectId: 'ce73b108-c4f1-486b-b421-338d44e0943c', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Busage',                          canonicalSubjectId: '5a507b15-eae0-49dd-9076-2c915e45d3d6', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'Lagunage',                        canonicalSubjectId: '2bff30b9-8298-4363-89db-45f12eb8c0bd', types: ['site_reserve', 'site_action', 'site_deadline'] },
  { label: 'FT Matériaux',                    canonicalSubjectId: '9e7bc5cb-0ee2-4eed-a8f5-2a9d1f47f593', types: ['site_reserve', 'site_action', 'site_deadline'] },
]

const DECISION_ICON: Record<string, string> = {
  SAME_OBJECT: '🟢',
  RELATED_BUT_DISTINCT: '🟡',
  UNCERTAIN: '🟠',
}

async function main() {
  console.log('\n=== P1-C2A — Dry-run resolver canonical_business_object (5 sentinelles) ===')
  console.log('Aucune écriture en base. Sortie destinée à validation humaine.\n')

  for (const sentinel of SENTINELS) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log(`SUJET : ${sentinel.label}  (${sentinel.canonicalSubjectId})`)
    console.log('═'.repeat(70))

    for (const targetType of sentinel.types) {
      const entities = await getCanonicalSubjectEntities(sentinel.canonicalSubjectId, targetType)

      if (entities.length === 0) {
        continue // rien de ce type pour ce sujet — pas de bruit dans la sortie
      }

      console.log(`\n── ${targetType} — ${entities.length} entité(s) ouverte(s) ──`)
      for (const e of entities) {
        console.log(`   [${e.stableKey ?? '(no key)'}] ${e.label.slice(0, 70)}  — ${e.date ?? '(no date)'}`)
      }

      if (entities.length < 2) {
        console.log('   → une seule entité, rien à regrouper')
        continue
      }

      const groups = await resolveCanonicalBusinessObjectGroups(entities)

      if (groups.length === 0) {
        console.log('   ⚠ resolver n\'a retourné aucun groupe (clé API absente, erreur, ou réponse invalide)')
        continue
      }

      console.log(`\n   Regroupement proposé (${groups.length} groupe(s)) :`)
      for (const g of groups) {
        const icon = DECISION_ICON[g.decision] ?? '⚪'
        console.log(`   ${icon} [${g.decision} ${(g.confidence * 100).toFixed(0)}%] "${g.label}" — ${g.members.length} membre(s)`)
        console.log(`      raison : ${g.reasoning}`)
        for (const m of g.members) {
          const e = entities.find((en) => en.entityId === m)
          console.log(`      · ${m.slice(0, 8)} ${e ? '"' + e.label.slice(0, 50) + '"' : ''}`)
        }
      }
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Fin du dry-run — aucune écriture DB effectuée.')
}

main().catch((e) => { console.error(e); process.exit(1) })
