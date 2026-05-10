# Engagement Loop — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> **Important** : ce plan est organisé par **vertical slices orientées apprentissage produit**, pas par couches techniques. Chaque slice produit du software démontrable et teste un risque distinct.

**Goal:** Livrer le squelette opérable de la boucle Engagement (PROMIS uniquement pour Phase 1) — un Resp. AO peut convertir un AO gagné en contrat avec 15-30 engagements curés affichés dans un cockpit visualisant les 5 dimensions de compliance.

**Architecture:** 4 vertical slices testables séquentielles. Chaque slice ajoute UNE capacité produit, testée sur usage réel avant la suivante. Pas de big bang, pas d'architecture prématurée. Database minimale (2 nouvelles tables Phase 1), frontend en composants existants Tailwind+Next, IA via le pipeline AI provider déjà en place.

**Tech Stack:** Next.js 16 App Router · TypeScript 5 · Supabase Cloud · Tailwind v4 · vitest 4 · React 19 · pas de nouveau framework, pas de nouvelle bibliothèque

**Spec source:** `docs/superpowers/specs/2026-05-10-engagement-loop-design.md` + `2026-05-10-engagement-cockpit-design.md`

---

## 1. Philosophie d'exécution — anti-frameworkitis

### Les 7 règles d'or

1. **YAGNI ruthless** — chaque ligne de code doit servir une démo cette semaine
2. **Pas d'abstraction avant 3 duplications** — copier-coller est OK pour les 2 premiers cas
3. **Calcul à la demande > tables de cache** — on optimise quand le profileur le dit
4. **SQL direct > ORM gymnastics** — Supabase + raw queries jusqu'à preuve du contraire
5. **Code laid qui marche > code beau qui plante** — refacto post-pilote
6. **Test sur user réel > test unitaire seul** — le pilote remplace 80% des assertions
7. **One pilote à la fois** — pas de scaling avant validation 1er pilote

### La frontière du Phase 1

```
✅ Phase 1 INCLUT
  - Table engagements + table contracts
  - Extraction IA (nouveau agent)
  - UI curation des engagements
  - Wizard conversion AO → contrat
  - Cockpit minimal : engagements liste + Boucle de preuve à 5 segments (mais seulement PROMIS=100% car le reste vient en Phase 2)

❌ Phase 1 N'INCLUT PAS
  - Sites / Missions / Interventions / Photos / Anomalies (= Phase 2)
  - App agent terrain (= Phase 3)
  - Rapport mensuel (= Phase 4)
  - Cross-tender matching V1.2 (= Phase 5)
```

Si pendant l'implémentation on se surprend à vouloir « préparer le terrain pour la Phase 2 » → STOP. On code juste ce qui sert la démo Phase 1.

---

## 2. Les 4 vertical slices

Chaque slice = une démo testable + un risque produit testé.

### Slice 0 — Foundation DB (3 jours)

**Démo livrable** : RIEN visible côté UI. Mais on peut créer un `contract` + 5 `engagements` en SQL et lire en TypeScript.

**Risque testé** : architecture data correcte, types TypeScript cohérents, RLS multi-tenant.

**Critère d'acceptance** : `lib/db/engagements.ts` permet `listEngagementsByTender()`, `upsertEngagement()`, `archiveEngagement()`. 100% testés.

### Slice 1 — Extraction IA brute (5 jours)

**Démo livrable** : sur un tender existant avec mémoire technique, on clique « Extraire engagements », l'IA propose 15-30 engagements en JSON brut affiché dans un `<pre>`.

**Risque testé** : **qualité de l'extraction LLM**. C'est le risque #1. Si l'IA produit du bruit, tout le reste s'écroule.

**Critère d'acceptance** : sur 5 AOs réels variés, ≥ 80% des engagements extraits sont jugés acceptables par 1 utilisateur réel (Resp. AO). Catégories correctes ≥ 70%.

### Slice 2 — Curation UX (5 jours)

**Démo livrable** : la page d'engagements devient une vue split (source ↔ engagements détectés) avec bulk actions, édition de catégorie/label.

**Risque testé** : **friction cognitive de la curation**. Si l'utilisateur passe > 15 min, il abandonnera.

**Critère d'acceptance** : sur 5 AOs réels avec 18-25 engagements, l'utilisateur curate en < 10 min en moyenne. Aucune action ne nécessite > 2 clics.

### Slice 3 — Cockpit Boucle de preuve (5 jours)

**Démo livrable** : page `/contracts/[id]` qui affiche les engagements actifs avec la visualisation 5-segments. Phase 1 = seul `PROMIS` est calculé (100% si engagement actif), les 4 autres affichés à 0% en gris (« en attente de mobilisation Field »).

**Risque testé** : **comprehensibilité 30 secondes** par un dirigeant non-technique.

**Critère d'acceptance** : sur 3 testeurs différents (1 dirigeant, 1 ops manager, 1 personne extérieure), tous comprennent en moins de 30 secondes ce que représente la barre 5 segments.

### Slice 4 — Wizard conversion AO → contrat (5 jours)

**Démo livrable** : depuis une page tender (statut `won`), bouton « Convertir en contrat » ouvre un wizard 4 étapes (info contrat / curation engagements / sites placeholder / récap), créé le contrat, redirige sur `/contracts/[id]`.

**Risque testé** : **fluidité du flow complet**. Y a-t-il une étape qui frustre ?

**Critère d'acceptance** : un Resp. AO peut, depuis un AO gagné, créer un contrat opérationnel en < 12 minutes (curation incluse) sans aide extérieure.

### Total : ~23 jours = 4-5 semaines de travail

Cohérent avec l'estimation Phase 1 du spec principal.

---

## 3. Risques identifiés et stratégie de mitigation

| # | Risque | Slice où testé | Mitigation préventive | Plan B si échec |
|---|---|---|---|---|
| R1 | Extraction LLM bruyante | Slice 1 | Prompt engineering itératif sur 3-5 AOs réels | Curation manuelle assistée (saisie utilisateur de 1-2 engagements, IA suggère similaires) |
| R2 | Curation step trop lourde | Slice 2 | Bulk actions + édition inline + skip step | Reduire à confirmation 1-clic « tout accepter », curation différée |
| R3 | Cockpit incompris | Slice 3 | Tester sur 3 personas différentes avant slice 4 | Simplifier en 3 segments (PROMIS / EXÉCUTÉ / PROUVÉ) si 5 trop |
| R4 | Wizard fastidieux | Slice 4 | < 4 étapes, possibilité de skip étape 3 (sites) | Mode « contrat éclair » 2 étapes |
| R5 | RLS multi-tenant cassé | Slice 0 | Tests d'isolation explicites avec 2 tenants | Audit sécurité avant pilote |
| R6 | Performance compliance calc | Future | Index DB ciblés dès slice 0, profileur si lent | Vue matérialisée au scale |

**Risques DÉLIBÉRÉMENT non-mitigés Phase 1** :
- Cross-tender matching (V1.2)
- Real-time collaboration sur curation (V2)
- Engagement modification post-activation (refusé par design)

---

## 4. Implementations « fakes » acceptables Phase 1

| Élément | Fake acceptable Phase 1 | Implémentation propre quand |
|---|---|---|
| Health calculation | `health` toujours = `unknown` (pas assez de data) | Phase 4 quand on a interventions |
| Compliance ratios | PROMIS=100% si actif, autres=0% (gris) | Phase 2-3 quand interventions arrivent |
| AI extraction confidence score | Hardcoded 0.85 sur tous les engagements | Slice 1 itération 2 si pertinent |
| Wizard étape « Sites » | Skip optionnel, sans création de sites | Phase 2 (vrai module Field) |
| Curation save-resume | Pas implémenté (tout en mémoire pendant la session) | V1.1 si retours utilisateur le demandent |
| Wording lint (compliance/breached/violation) | Manuel par code review | V1.2 quand l'app est plus grande |
| `engagement_events` table | Pas créée | V1.2 si besoin de tracking historique |
| Indexes DB performance | Index basiques sur `tender_id`/`contract_id` uniquement | Profiler quand >100 contrats |
| Validation : commentaire optionnel | Implémenté direct (textarea simple) | — |
| Multi-tenant isolation | RLS Postgres, tests E2E avec 2 tenants | — |

**Fakes refusés Phase 1** (= construire propre dès le départ, sinon dette toxique) :
- ❌ Pas de fake sur les types TypeScript — schémas stricts dès slice 0
- ❌ Pas de fake sur la sécurité multi-tenant — RLS dès la 1ère table
- ❌ Pas de fake sur les wording UI utilisateur (pas de « TODO: traduire » sur du français)

---

## 5. Métriques produit à observer dès le pilote

### Métriques techniques (loggées dans `ai_usage`, exposées en SQL)

| Métrique | Comment collectée | Seuil acceptable |
|---|---|---|
| Temps extraction IA par AO | `duration_ms` de `runEngagementExtractionAgent` | < 30 sec |
| Tokens consommés par extraction | `input_tokens + output_tokens` | < 10k tokens |
| Coût IA par AO converti | calcul depuis tokens × tarif provider | < 0.50 € |
| Temps de réponse curation save | timestamp début/fin client-side | < 1 sec |

### Métriques produit (loggées dans tables ad-hoc + Supabase events)

| Métrique | Comment collectée | Indicateur |
|---|---|---|
| Engagements extraits par AO | `COUNT(*) FROM engagements WHERE tender_id = X` | 15-30 typique, < 10 ou > 40 = alerte |
| Taux d'acceptation curation | `accepted / extracted` | > 70% sain, < 50% = extraction bruyante |
| Temps moyen de curation | timestamps debut/fin du wizard étape 2 | < 10 min, > 15 min = friction UX |
| Délai AO gagné → contrat actif | `tender.won_at → contract.created_at` | < 7 jours = adoption ; > 30 jours = friction |
| Engagements non-couverts par mission (Phase 2) | calcul SQL | informatif |
| % wizards démarrés / terminés | event `wizard_started` vs `wizard_completed` | > 80% sain |

### Métriques d'usage cockpit (V1.2 si besoin)

- Fréquence de visite `/contracts/[id]` par rôle
- Temps passé sur la page
- Drill-down vers détail engagement (oui/non)

---

## 6. Signaux d'échec précoce — comment savoir que ça dérive

À surveiller pendant les 30 premiers jours du pilote :

### 🔴 Signaux critiques (réagir sous 48h)
- Taux d'acceptation curation < 30% → l'extraction est bruyante, refaire le prompt
- Aucun contrat créé après 14 jours d'accès → friction wizard ou pas de valeur perçue
- Engagements extraits = 0 sur ≥ 1 AO → l'extraction a un bug
- > 50% wizards abandonnés → étape qui frustre

### 🟡 Signaux d'alerte (réagir sous 1 semaine)
- Temps curation moyen > 15 min → bulk actions insuffisantes
- < 5 engagements moyens par AO → extraction trop conservative
- > 35 engagements moyens par AO → extraction trop verbeuse
- Catégorisation manuelle modifiée > 50% → AI catégorise mal
- Cockpit consulté < 1× / semaine → pas perçu comme valeur

### 🟢 Signaux positifs à célébrer
- Cas où l'utilisateur réutilise un engagement curé sur un nouvel AO (Phase 1.2)
- Demande utilisateur « comment je relie ça à mes missions ? » → tirer Phase 2
- Resp. AO partage spontanément le cockpit avec direction

---

## 7. Stratégie pilote

### Profil cible du 1er pilote

| Dimension | Sweet spot | À éviter |
|---|---|---|
| Taille | PME 50-200 employés | Major group (Atalian/Onet) ou TPE 1 site |
| Sites actifs | 5-15 | < 3 (pas assez de signal) ou > 30 (trop complexe) |
| Contrats actifs | 1-3 | 10+ (impossible à maîtriser) |
| Resp. AO disponible | 1 personne identifiée comme « champion » produit | Comité, plusieurs validateurs |
| Culture | Ouverte au feedback, agile | Top-down, hiérarchie rigide |
| Maturité digitale | Utilise déjà 1-2 SaaS métier | Tout-papier (trop de change management) |
| Sector | Tertiaire / hospitalier généraliste | Spécialités exotiques (food/pharma/biotech) |
| Crisis status | Pas en crise — a du temps pour tester | Sauver la boîte, pas de bande passante |

### La règle pilote unique

**Un seul pilote à la fois.** Pas deux en parallèle. Pas trois.

Raison : le bruit produit est trop fort. Si deux pilotes ont des problèmes différents, on ne peut prioriser. Un pilote, on apprend, on itère, on stabilise. **Puis** on en prend un deuxième.

### Le superviseur idéal pour le pilote

Pas le DG. Pas un cadre top-down. **Un Responsable d'exploitation expérimenté qui souffre de** :
- Difficulté à prouver à ses clients qu'il livre
- Reporting mensuel pénible (Excel + photos sans organisation)
- Résiliations contractuelles inattendues (« nos preuves étaient pauvres »)
- AO complexes où la mémoire technique répète la dernière fois

Ce profil RECONNAÎT immédiatement la valeur. Il sera ton meilleur sponsor interne.

### Timeline pilote

- **Semaine 0** : onboarding, import 1 AO existant gagné
- **Semaine 1-2** : Slice 1+2 testés (extraction + curation)
- **Semaine 3-4** : Slice 3+4 testés (cockpit + wizard)
- **Semaine 5-8** : usage réel + collecte métriques + itération
- **Semaine 9** : décision Go/No-Go pour Phase 2

---

## 8. File structure — Phase 1

### Nouveaux fichiers à créer

```
supabase/migrations/
  └─ 017_engagements_and_contracts.sql       (Slice 0)

types/
  └─ db.ts                                   (modifié, ajout types)

lib/db/
  ├─ contracts.ts                            (Slice 0)
  └─ engagements.ts                          (Slice 0)

services/ai/agents/
  └─ engagement-extractor.ts                 (Slice 1)

app/(dashboard)/tenders/[id]/
  ├─ engagements-actions.ts                  (server actions Slice 1+2)
  ├─ engagements-extract-button.tsx          (Slice 1)
  ├─ engagement-list.tsx                     (Slice 1+2 - shared component)
  ├─ engagement-curation-view.tsx            (Slice 2)
  └─ EngagementsPage.tsx                     (Slice 1+2 - page wrapper)

app/(dashboard)/tenders/[id]/engagements/
  └─ page.tsx                                (Slice 1)

app/(dashboard)/tenders/[id]/convert/
  └─ page.tsx                                (Slice 4 - wizard)

app/(dashboard)/contracts/
  └─ [id]/
     └─ page.tsx                             (Slice 3)

app/(dashboard)/contracts/[id]/
  └─ engagement-compliance.tsx               (Slice 3 - the signature visual)

tests/lib/
  ├─ contracts.test.ts                       (Slice 0)
  └─ engagements.test.ts                     (Slice 0)

tests/services/
  └─ engagement-extractor.test.ts            (Slice 1)

tests/components/
  └─ engagement-compliance.test.tsx          (Slice 3)
```

### Fichiers modifiés

```
types/db.ts                          (Slice 0 - ajout types)
app/(dashboard)/tenders/[id]/page.tsx  (Slice 4 - bouton "Convertir en contrat")
```

---

## 9. Slice 0 — Foundation DB

**Goal** : tables `contracts` + `engagements` + helpers DB testés. Aucune UI.

**Risque testé** : architecture data + RLS multi-tenant.

### Task 0.1 — Migration Supabase

**Files:**
- Create: `supabase/migrations/017_engagements_and_contracts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 017 : engagements + contracts (Phase 1)

-- ==========================================
-- contracts table
-- ==========================================
CREATE TABLE contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid REFERENCES tenders(id) ON DELETE SET NULL,
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  client_name     text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 200),
  start_date      date NOT NULL,
  end_date        date,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'terminated', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_contracts_org ON contracts(org_id);
CREATE INDEX idx_contracts_tender ON contracts(tender_id);
CREATE INDEX idx_contracts_status ON contracts(status) WHERE status = 'active';

-- ==========================================
-- engagements table
-- ==========================================
CREATE TABLE engagements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  contract_id     uuid REFERENCES contracts(id) ON DELETE SET NULL,
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source_type     text NOT NULL CHECK (source_type IN ('ao_clause', 'memoire_engagement', 'manual')),
  source_excerpt  text NOT NULL CHECK (length(source_excerpt) BETWEEN 5 AND 2000),
  source_ref      jsonb,
  category        text NOT NULL CHECK (category IN
                    ('frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other')),
  short_label     text NOT NULL CHECK (length(short_label) BETWEEN 3 AND 100),
  measurable      boolean NOT NULL DEFAULT false,
  ai_confidence   numeric(3,2) CHECK (ai_confidence BETWEEN 0 AND 1),
  status          text NOT NULL DEFAULT 'extracted'
                  CHECK (status IN ('extracted', 'curated', 'active', 'completed', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_engagements_tender ON engagements(tender_id);
CREATE INDEX idx_engagements_contract ON engagements(contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX idx_engagements_org_status ON engagements(org_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER engagements_updated_at BEFORE UPDATE ON engagements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- RLS multi-tenant isolation
-- ==========================================
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_org_isolation ON contracts FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY engagements_org_isolation ON engagements FOR ALL
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
```

- [ ] **Step 2: Apply migration**

Run: `npm run db:push` (utilise le script `scripts/db-push.ts` du projet)

Expected: migration appliquée, tables visibles dans Supabase Studio.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/017_engagements_and_contracts.sql
git commit -m "feat(engagement): migration 017 — contracts + engagements tables with RLS"
```

### Task 0.2 — Types TypeScript

**Files:**
- Modify: `types/db.ts` (ajout types)

- [ ] **Step 1: Add types**

Append à `types/db.ts` :

```ts
// =================================
// Engagement & Contracts (Phase 1)
// =================================

export type ContractStatus = 'active' | 'paused' | 'terminated' | 'archived'

export interface DbContract {
  id: string
  tender_id: string | null
  org_id: string
  name: string
  client_name: string
  start_date: string
  end_date: string | null
  status: ContractStatus
  created_at: string
  updated_at: string
  created_by: string | null
}

export type EngagementSourceType = 'ao_clause' | 'memoire_engagement' | 'manual'

export type EngagementCategory =
  | 'frequency'
  | 'quality'
  | 'compliance'
  | 'delivery'
  | 'sla'
  | 'reporting'
  | 'other'

export type EngagementStatus =
  | 'extracted'
  | 'curated'
  | 'active'
  | 'completed'
  | 'archived'

export interface DbEngagement {
  id: string
  tender_id: string
  contract_id: string | null
  org_id: string
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown> | null
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number | null
  status: EngagementStatus
  created_at: string
  updated_at: string
  created_by: string | null
}

// Compliance helpers (computed view-side, not persisted)
export type EngagementHealth = 'green' | 'amber' | 'red' | 'unknown'

export interface EngagementComplianceRatios {
  promised: boolean         // engagement actif sur le contrat
  planned: number           // 0-1, % sites avec mission qui couvre
  executed: number          // 0-1, % interventions réalisées
  proven: number            // 0-1, % interventions avec photo
  validated: number         // 0-1, % interventions validées
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add types/db.ts
git commit -m "feat(engagement): TypeScript types for contracts + engagements"
```

### Task 0.3 — DB helpers

**Files:**
- Create: `lib/db/contracts.ts`
- Create: `lib/db/engagements.ts`
- Test: `tests/lib/contracts.test.ts`
- Test: `tests/lib/engagements.test.ts`

- [ ] **Step 1: Implement `lib/db/contracts.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbContract, ContractStatus } from '@/types/db'

export async function getContract(id: string): Promise<DbContract | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('contracts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function listContractsByOrg(orgId: string): Promise<DbContract[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createContract(input: {
  tender_id: string | null
  org_id: string
  name: string
  client_name: string
  start_date: string
  end_date?: string | null
  created_by: string | null
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contracts')
    .insert({ ...input, status: 'active' })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateContractStatus(id: string, status: ContractStatus): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('contracts').update({ status }).eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2: Implement `lib/db/engagements.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { DbEngagement, EngagementCategory, EngagementSourceType, EngagementStatus } from '@/types/db'

export async function listEngagementsByTender(tenderId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listEngagementsByContract(contractId: string): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .select('*')
    .eq('contract_id', contractId)
    .in('status', ['active', 'completed'])
    .order('category')
  if (error) throw error
  return data ?? []
}

export async function bulkInsertEngagements(input: {
  tender_id: string
  org_id: string
  created_by: string | null
  engagements: Array<{
    source_type: EngagementSourceType
    source_excerpt: string
    source_ref: Record<string, unknown> | null
    category: EngagementCategory
    short_label: string
    measurable: boolean
    ai_confidence: number | null
  }>
}): Promise<DbEngagement[]> {
  const supabase = createAdminClient()
  const rows = input.engagements.map((e) => ({
    tender_id: input.tender_id,
    org_id: input.org_id,
    created_by: input.created_by,
    status: 'extracted' as EngagementStatus,
    ...e,
  }))
  const { data, error } = await supabase.from('engagements').insert(rows).select('*')
  if (error) throw error
  return data ?? []
}

export async function curateEngagement(
  id: string,
  patch: { short_label?: string; category?: EngagementCategory; measurable?: boolean }
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('engagements')
    .update({ ...patch, status: 'curated' })
    .eq('id', id)
    .eq('status', 'extracted')   // safety: cannot modify after activation
  if (error) throw error
}

export async function rejectEngagements(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase.from('engagements').delete().in('id', ids).eq('status', 'extracted')
  if (error) throw error
}

export async function activateEngagementsForContract(
  tenderId: string,
  contractId: string
): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('engagements')
    .update({ contract_id: contractId, status: 'active' })
    .eq('tender_id', tenderId)
    .in('status', ['extracted', 'curated'])
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

export async function archiveEngagement(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('engagements').update({ status: 'archived' }).eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 3: Write tests** for `lib/db/engagements.ts`

`tests/lib/engagements.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  listEngagementsByTender,
  bulkInsertEngagements,
  curateEngagement,
  activateEngagementsForContract,
  archiveEngagement,
} from '@/lib/db/engagements'
import { createContract } from '@/lib/db/contracts'

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000099'
const TEST_TENDER_ID = '00000000-0000-0000-0000-000000000098'

async function cleanupTestData() {
  const supabase = createAdminClient()
  await supabase.from('engagements').delete().eq('tender_id', TEST_TENDER_ID)
  await supabase.from('contracts').delete().eq('org_id', TEST_ORG_ID)
}

describe('engagements DB helpers', () => {
  beforeAll(async () => {
    await cleanupTestData()
  })
  afterEach(async () => {
    await cleanupTestData()
  })

  it('bulkInsert creates engagements with status=extracted', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: TEST_TENDER_ID,
      org_id: TEST_ORG_ID,
      created_by: null,
      engagements: [
        {
          source_type: 'memoire_engagement',
          source_excerpt: 'Désinfection biquotidienne sanitaires écolabel',
          source_ref: { page: 12, section: '3.2' },
          category: 'frequency',
          short_label: 'Sanitaires 2x/jour avec écolabel',
          measurable: true,
          ai_confidence: 0.92,
        },
      ],
    })
    expect(inserted.length).toBe(1)
    expect(inserted[0].status).toBe('extracted')
    expect(inserted[0].short_label).toContain('Sanitaires')
  })

  it('curateEngagement updates label + sets status=curated', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: TEST_TENDER_ID,
      org_id: TEST_ORG_ID,
      created_by: null,
      engagements: [{
        source_type: 'ao_clause', source_excerpt: 'Clause X', source_ref: null,
        category: 'compliance', short_label: 'Initial label', measurable: false, ai_confidence: 0.7,
      }],
    })
    await curateEngagement(inserted[0].id, { short_label: 'Updated label', category: 'quality' })
    const list = await listEngagementsByTender(TEST_TENDER_ID)
    expect(list[0].short_label).toBe('Updated label')
    expect(list[0].category).toBe('quality')
    expect(list[0].status).toBe('curated')
  })

  it('curateEngagement is rejected on already-active engagement', async () => {
    const inserted = await bulkInsertEngagements({
      tender_id: TEST_TENDER_ID,
      org_id: TEST_ORG_ID,
      created_by: null,
      engagements: [{
        source_type: 'ao_clause', source_excerpt: 'Clause X', source_ref: null,
        category: 'compliance', short_label: 'Initial', measurable: false, ai_confidence: 0.7,
      }],
    })
    const contractId = await createContract({
      tender_id: TEST_TENDER_ID, org_id: TEST_ORG_ID, name: 'Test', client_name: 'Test Client',
      start_date: '2026-05-01', created_by: null,
    })
    await activateEngagementsForContract(TEST_TENDER_ID, contractId)
    await curateEngagement(inserted[0].id, { short_label: 'Should not apply' })
    const list = await listEngagementsByTender(TEST_TENDER_ID)
    expect(list[0].short_label).toBe('Initial')
    expect(list[0].status).toBe('active')
  })

  it('activateEngagementsForContract assigns contract_id + status=active', async () => {
    await bulkInsertEngagements({
      tender_id: TEST_TENDER_ID,
      org_id: TEST_ORG_ID,
      created_by: null,
      engagements: [
        { source_type: 'memoire_engagement', source_excerpt: 'A', source_ref: null,
          category: 'frequency', short_label: 'A', measurable: true, ai_confidence: 0.9 },
        { source_type: 'memoire_engagement', source_excerpt: 'B', source_ref: null,
          category: 'quality', short_label: 'B', measurable: false, ai_confidence: 0.8 },
      ],
    })
    const contractId = await createContract({
      tender_id: TEST_TENDER_ID, org_id: TEST_ORG_ID, name: 'Test', client_name: 'Test Client',
      start_date: '2026-05-01', created_by: null,
    })
    const count = await activateEngagementsForContract(TEST_TENDER_ID, contractId)
    expect(count).toBe(2)
    const list = await listEngagementsByTender(TEST_TENDER_ID)
    expect(list.every((e) => e.status === 'active' && e.contract_id === contractId)).toBe(true)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/engagements.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/contracts.ts lib/db/engagements.ts tests/lib/engagements.test.ts
git commit -m "feat(engagement): DB helpers contracts + engagements with curation safety"
```

---

## 10. Slice 1 — Extraction IA brute

**Goal** : sur un tender existant, un bouton « Extraire engagements » lance l'agent IA et affiche les engagements en liste basique.

**Risque testé** : qualité prompt extraction.

### Task 1.1 — Agent extraction

**Files:**
- Create: `services/ai/agents/engagement-extractor.ts`
- Test: `tests/services/engagement-extractor.test.ts`

- [ ] **Step 1: Implement extractor agent**

```ts
import { runAgent, type AgentRunResult } from '@/services/ai/runner'
import { z } from 'zod'
import type { EngagementCategory, EngagementSourceType } from '@/types/db'

const extractedSchema = z.object({
  engagements: z.array(z.object({
    source_type: z.enum(['ao_clause', 'memoire_engagement']),
    source_excerpt: z.string().min(10).max(1500),
    source_ref: z.object({
      page: z.number().int().nullable().optional(),
      section: z.string().nullable().optional(),
    }).nullable().optional(),
    category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']),
    short_label: z.string().min(5).max(100),
    measurable: z.boolean(),
    confidence: z.number().min(0).max(1),
  })),
})

export interface EngagementExtractInput {
  aoText: string
  memoireTechniqueText: string | null
  userId: string
}

export interface ExtractedEngagement {
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown> | null
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number
}

export interface EngagementExtractResult extends AgentRunResult {
  engagements: ExtractedEngagement[]
}

const SYSTEM_PROMPT = `Tu es un analyste d'AO de la prestation de nettoyage B2B.
Ta mission : extraire les ENGAGEMENTS atomiques d'un dossier de réponse à AO.

Un engagement est :
- une promesse opérationnelle vérifiable
- citable (extrait verbatim de la source)
- atomique (1 phrase = 1 engagement, pas d'imbrication)
- catégorisable (frequency / quality / compliance / delivery / sla / reporting / other)

Tu DOIS extraire entre 15 et 25 engagements maximum.
Tu DOIS éviter les généralités ("être professionnel", "respecter les normes") sans clause précise.
Tu DOIS donner un confidence score honnête (0.5 si vague, 0.9 si très net).

Sortie : JSON conforme au schema fourni.`

export async function extractEngagements(input: EngagementExtractInput): Promise<EngagementExtractResult> {
  const userPrompt = `=== AO source (extrait) ===
${input.aoText.slice(0, 12000)}

=== Mémoire technique (si disponible) ===
${input.memoireTechniqueText?.slice(0, 8000) ?? '(non fourni)'}

Extrais les engagements au format JSON :
{
  "engagements": [
    { "source_type": "...", "source_excerpt": "...", "source_ref": { "page": N, "section": "..." },
      "category": "...", "short_label": "...", "measurable": bool, "confidence": 0.X },
    ...
  ]
}`

  const r = await runAgent({
    agentName: 'engagement_extractor',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    userId: input.userId,
    expectJson: true,
  })

  // Parse + validate
  let parsed: z.infer<typeof extractedSchema>
  try {
    parsed = extractedSchema.parse(JSON.parse(r.content))
  } catch (e) {
    throw new Error(`Engagement extraction failed schema validation: ${e instanceof Error ? e.message : 'unknown'}`)
  }

  return {
    ...r,
    engagements: parsed.engagements.map((e) => ({
      source_type: e.source_type,
      source_excerpt: e.source_excerpt,
      source_ref: e.source_ref ?? null,
      category: e.category,
      short_label: e.short_label,
      measurable: e.measurable,
      ai_confidence: e.confidence,
    })),
  }
}
```

- [ ] **Step 2: Test with mock provider**

`tests/services/engagement-extractor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractEngagements } from '@/services/ai/agents/engagement-extractor'

const FIXTURE = {
  engagements: [
    {
      source_type: 'memoire_engagement',
      source_excerpt: 'Désinfection biquotidienne des sanitaires avec produits écolabel',
      source_ref: { page: 12, section: '3.2' },
      category: 'frequency',
      short_label: 'Sanitaires 2x/jour écolabel',
      measurable: true,
      confidence: 0.92,
    },
    {
      source_type: 'ao_clause',
      source_excerpt: 'Audit qualité hebdomadaire avec rapport écrit',
      source_ref: { page: 22, section: '4.7.1' },
      category: 'reporting',
      short_label: 'Audit qualité hebdo',
      measurable: true,
      confidence: 0.88,
    },
  ],
}

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'mock')
  vi.stubEnv('MOCK_FIXTURE_engagement_extractor', JSON.stringify(FIXTURE))
})

describe('extractEngagements', () => {
  it('returns parsed engagements from mock provider', async () => {
    const r = await extractEngagements({
      aoText: 'AO test content',
      memoireTechniqueText: 'Mémoire technique content',
      userId: 'test-user',
    })
    expect(r.engagements.length).toBe(2)
    expect(r.engagements[0].short_label).toBe('Sanitaires 2x/jour écolabel')
    expect(r.engagements[0].ai_confidence).toBe(0.92)
    expect(r.engagements[0].category).toBe('frequency')
  })

  it('throws if JSON does not match schema', async () => {
    vi.stubEnv('MOCK_FIXTURE_engagement_extractor', JSON.stringify({ engagements: [{ invalid: true }] }))
    await expect(extractEngagements({
      aoText: 'x', memoireTechniqueText: null, userId: 'test',
    })).rejects.toThrow(/schema validation/)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/services/engagement-extractor.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 4: Commit**

```bash
git add services/ai/agents/engagement-extractor.ts tests/services/engagement-extractor.test.ts
git commit -m "feat(engagement): IA agent for engagement extraction with zod schema validation"
```

### Task 1.2 — Server action + page brute

**Files:**
- Create: `app/(dashboard)/tenders/[id]/engagements-actions.ts`
- Create: `app/(dashboard)/tenders/[id]/engagements/page.tsx`
- Modify: `app/(dashboard)/tenders/[id]/page.tsx` (ajout bouton « Engagements »)

- [ ] **Step 1: Create server action**

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { extractEngagements } from '@/services/ai/agents/engagement-extractor'
import { bulkInsertEngagements, listEngagementsByTender } from '@/lib/db/engagements'
import { getTender, getTenderDocument, getLatestTenderAnalysis } from '@/lib/db/tenders'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserOrgId } from '@/lib/db/users'

const extractSchema = z.object({ tender_id: z.string().uuid() })

export async function extractEngagementsAction(formData: FormData) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = extractSchema.safeParse({ tender_id: formData.get('tender_id') })
  if (!parsed.success) return { error: 'Invalid input' }

  // Skip if already extracted
  const existing = await listEngagementsByTender(parsed.data.tender_id)
  if (existing.length > 0) return { error: 'Engagements already extracted for this tender' }

  const tender = await getTender(parsed.data.tender_id)
  if (!tender) return { error: 'Tender not found' }
  const orgId = await getUserOrgId(user.id)
  if (!orgId) return { error: 'User has no org' }

  const [doc, analysis] = await Promise.all([
    getTenderDocument(parsed.data.tender_id),
    getLatestTenderAnalysis(parsed.data.tender_id),
  ])
  if (!doc?.extracted_text) return { error: 'No extracted text on tender document' }

  const result = await extractEngagements({
    aoText: doc.extracted_text,
    memoireTechniqueText: analysis?.technical_memo ?? null,
    userId: user.id,
  })

  await bulkInsertEngagements({
    tender_id: parsed.data.tender_id,
    org_id: orgId,
    created_by: user.id,
    engagements: result.engagements,
  })

  revalidatePath(`/tenders/${parsed.data.tender_id}/engagements`)
  return { ok: true, count: result.engagements.length }
}
```

- [ ] **Step 2: Create raw page**

```tsx
import { listEngagementsByTender } from '@/lib/db/engagements'
import { extractEngagementsAction } from '../engagements-actions'

export default async function EngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const engagements = await listEngagementsByTender(id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Engagements ({engagements.length})</h1>
        {engagements.length === 0 && (
          <form action={extractEngagementsAction}>
            <input type="hidden" name="tender_id" value={id} />
            <button type="submit" className="px-3 py-1 rounded border bg-card hover:bg-muted/50 text-sm">
              Extraire les engagements (IA)
            </button>
          </form>
        )}
      </div>
      {engagements.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucun engagement extrait pour cet AO. Cliquez ci-dessus pour lancer l'extraction.
        </p>
      )}
      <ul className="space-y-2">
        {engagements.map((e) => (
          <li key={e.id} className="rounded-lg border p-3 bg-card">
            <div className="flex items-start gap-2 mb-1">
              <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground">{e.category}</span>
              <span className="text-[10px] text-muted-foreground">conf. {e.ai_confidence?.toFixed(2)}</span>
            </div>
            <div className="text-sm font-semibold mb-1">{e.short_label}</div>
            <div className="text-xs text-muted-foreground italic">« {e.source_excerpt} »</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Add link to engagements page in tender detail**

Modifier `app/(dashboard)/tenders/[id]/page.tsx` — ajouter dans la sidebar nav un item « Engagements » avec lien vers `/tenders/[id]/engagements`.

- [ ] **Step 4: Smoke test**

Sur un tender réel avec mémoire technique :
1. Naviguer vers `/tenders/[id]/engagements`
2. Cliquer « Extraire les engagements »
3. Vérifier qu'au retour, 15-25 engagements sont affichés
4. Vérifier au moins 80% sont jugés « pertinents » par soi-même

**RÉAGIR** : si < 80% pertinents, retravailler le prompt système avant de continuer.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/engagements-actions.ts \
        app/\(dashboard\)/tenders/\[id\]/engagements/page.tsx \
        app/\(dashboard\)/tenders/\[id\]/page.tsx
git commit -m "feat(engagement): server action + raw display page for IA extraction"
```

---

## 11. Slice 2 — Curation UX

**Goal** : transformer la page engagements brute en outil de curation efficace.

**Risque testé** : friction cognitive de la curation.

### Task 2.1 — Bulk actions + édition inline

**Files:**
- Create: `app/(dashboard)/tenders/[id]/engagement-curation-view.tsx` (composant client)
- Modify: `app/(dashboard)/tenders/[id]/engagements-actions.ts` (ajout actions curation)
- Modify: `app/(dashboard)/tenders/[id]/engagements/page.tsx`

- [ ] **Step 1: Add curation server actions**

Append à `engagements-actions.ts` :

```ts
import { curateEngagement, rejectEngagements } from '@/lib/db/engagements'

const curateSchema = z.object({
  id: z.string().uuid(),
  short_label: z.string().min(3).max(100).optional(),
  category: z.enum(['frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other']).optional(),
})

export async function curateEngagementAction(formData: FormData) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = curateSchema.safeParse({
    id: formData.get('id'),
    short_label: formData.get('short_label') || undefined,
    category: formData.get('category') || undefined,
  })
  if (!parsed.success) return { error: 'Invalid input' }

  const { id, ...patch } = parsed.data
  await curateEngagement(id, patch)
  return { ok: true }
}

export async function rejectEngagementsAction(formData: FormData) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const idsRaw = formData.get('ids') as string
  const ids = idsRaw.split(',').filter((s) => /^[0-9a-f-]{36}$/.test(s))
  if (ids.length === 0) return { error: 'No valid ids' }

  await rejectEngagements(ids)
  return { ok: true, count: ids.length }
}
```

- [ ] **Step 2: Create client curation component**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Trash2, Edit3 } from 'lucide-react'
import { toast } from 'sonner'
import { curateEngagementAction, rejectEngagementsAction } from './engagements-actions'
import type { DbEngagement, EngagementCategory } from '@/types/db'

const CATEGORIES: EngagementCategory[] = [
  'frequency', 'quality', 'compliance', 'delivery', 'sla', 'reporting', 'other',
]

export function EngagementCurationView({ engagements }: { engagements: DbEngagement[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function rejectSelected() {
    if (selected.size === 0) return
    const fd = new FormData()
    fd.set('ids', Array.from(selected).join(','))
    const r = await rejectEngagementsAction(fd)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success(`${(r as { count: number }).count} engagements supprimés`)
      setSelected(new Set())
      startTransition(() => {})
    }
  }

  async function saveEdit(id: string, patch: { short_label?: string; category?: EngagementCategory }) {
    const fd = new FormData()
    fd.set('id', id)
    if (patch.short_label) fd.set('short_label', patch.short_label)
    if (patch.category) fd.set('category', patch.category)
    const r = await curateEngagementAction(fd)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else {
      toast.success('Engagement mis à jour')
      setEditing(null)
      startTransition(() => {})
    }
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between p-2 rounded-lg border bg-amber-50">
          <span className="text-sm">{selected.size} sélectionnés</span>
          <button
            onClick={rejectSelected}
            className="inline-flex items-center gap-1 px-3 py-1 rounded border bg-card hover:bg-muted/50 text-sm"
          >
            <Trash2 className="h-3 w-3" /> Supprimer
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {engagements.map((e) => (
          <li key={e.id} className="rounded-lg border p-3 bg-card flex items-start gap-3">
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={() => toggleSelect(e.id)}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              {editing === e.id ? (
                <EditForm engagement={e} onSave={(p) => saveEdit(e.id, p)} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground">{e.category}</span>
                    <span className="text-[10px] text-muted-foreground">conf. {e.ai_confidence?.toFixed(2) ?? '—'}</span>
                    {e.status !== 'extracted' && (
                      <span className="text-[10px] uppercase text-emerald-700">{e.status}</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold mb-1">{e.short_label}</div>
                  <div className="text-xs text-muted-foreground italic">« {e.source_excerpt} »</div>
                </>
              )}
            </div>
            {editing !== e.id && e.status === 'extracted' && (
              <button onClick={() => setEditing(e.id)} className="p-1 rounded hover:bg-muted/50" aria-label="Éditer">
                <Edit3 className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EditForm({
  engagement,
  onSave,
  onCancel,
}: {
  engagement: DbEngagement
  onSave: (p: { short_label?: string; category?: EngagementCategory }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(engagement.short_label)
  const [category, setCategory] = useState(engagement.category)
  return (
    <div className="space-y-2">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="w-full rounded border p-1 text-sm"
        placeholder="Label court"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as EngagementCategory)}
        className="rounded border p-1 text-xs"
      >
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <div className="flex gap-1">
        <button onClick={() => onSave({ short_label: label, category })} className="px-2 py-0.5 rounded border bg-emerald-50 text-xs">
          Sauver
        </button>
        <button onClick={onCancel} className="px-2 py-0.5 rounded border text-xs">
          Annuler
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update page to use curation component**

`app/(dashboard)/tenders/[id]/engagements/page.tsx`:

```tsx
import { listEngagementsByTender } from '@/lib/db/engagements'
import { EngagementCurationView } from '../engagement-curation-view'
import { extractEngagementsAction } from '../engagements-actions'

export default async function EngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const engagements = await listEngagementsByTender(id)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Engagements ({engagements.length})</h1>
        {engagements.length === 0 && (
          <form action={extractEngagementsAction}>
            <input type="hidden" name="tender_id" value={id} />
            <button type="submit" className="px-3 py-1 rounded border bg-card hover:bg-muted/50 text-sm">
              Extraire les engagements (IA)
            </button>
          </form>
        )}
      </div>
      {engagements.length > 0 ? (
        <EngagementCurationView engagements={engagements} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucun engagement. Cliquez ci-dessus pour lancer l'extraction IA.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Smoke test**

1. Sur un tender avec engagements extraits
2. Sélectionner 3 engagements via checkbox
3. Cliquer « Supprimer » → toast de confirmation, refresh
4. Cliquer édition sur un engagement, modifier label, sauver
5. Vérifier que `status` passe à `curated`
6. Mesurer le temps total pour curer 18-25 engagements (cible : < 10 min)

**RÉAGIR** : si > 15 min, identifier la friction (typing label trop fréquent ? trop de catégories ? UX peu claire ?) et fixer avant Slice 3.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/engagement-curation-view.tsx \
        app/\(dashboard\)/tenders/\[id\]/engagements-actions.ts \
        app/\(dashboard\)/tenders/\[id\]/engagements/page.tsx
git commit -m "feat(engagement): curation UX with bulk reject + inline edit"
```

---

## 12. Slice 3 — Cockpit Boucle de preuve

**Goal** : page contrat avec liste d'engagements + visualisation 5 segments.

**Risque testé** : compréhensibilité 30 secondes.

### Task 3.1 — Composant `EngagementCompliance`

**Files:**
- Create: `app/(dashboard)/contracts/[id]/engagement-compliance.tsx`
- Test: `tests/components/engagement-compliance.test.tsx`

> **Note pour l'implémenteur** : c'est ICI que tu peux exécuter `uipro init` dans le repo (la skill UI/UX Pro Max installée globalement). Elle peut donner des suggestions de design. Décision optionnelle — si le composant ci-dessous suffit visuellement, pas besoin.

- [ ] **Step 1: Implement compliance bar**

```tsx
'use client'

import { cn } from '@/lib/utils'
import type { EngagementComplianceRatios } from '@/types/db'

interface EngagementComplianceProps {
  ratios: EngagementComplianceRatios
  size?: 'compact' | 'medium' | 'detail'
}

const SEGMENT_LABELS = ['PROMIS', 'PLANIFIÉ', 'EXÉCUTÉ', 'PROUVÉ', 'VALIDÉ'] as const
const SEGMENT_COLORS = [
  'bg-sage-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-amber-500',
  'bg-emerald-500',
] as const

function segmentValue(ratios: EngagementComplianceRatios, idx: number): number {
  switch (idx) {
    case 0: return ratios.promised ? 1 : 0
    case 1: return ratios.planned
    case 2: return ratios.executed
    case 3: return ratios.proven
    case 4: return ratios.validated
    default: return 0
  }
}

export function EngagementCompliance({ ratios, size = 'medium' }: EngagementComplianceProps) {
  const values = SEGMENT_LABELS.map((_, i) => segmentValue(ratios, i))

  if (size === 'compact') {
    // 5 dots reliés — version dashboard direction
    return (
      <div className="inline-flex items-center gap-0.5" aria-label="Compliance overview">
        {values.map((v, i) => {
          const filled = v >= 0.9 ? 'full' : v >= 0.5 ? 'half' : 'empty'
          return (
            <span key={i} className="inline-flex items-center">
              <span
                className={cn(
                  'inline-block w-2.5 h-2.5 rounded-full border',
                  filled === 'full' && 'bg-emerald-500 border-emerald-600',
                  filled === 'half' && 'bg-amber-300 border-amber-500',
                  filled === 'empty' && 'bg-muted border-muted-foreground/30',
                )}
                aria-label={`${SEGMENT_LABELS[i]}: ${Math.round(v * 100)}%`}
              />
              {i < values.length - 1 && <span className="w-1 h-px bg-muted-foreground/30" />}
            </span>
          )
        })}
      </div>
    )
  }

  // medium / detail
  return (
    <div className={cn('w-full', size === 'detail' && 'space-y-2')}>
      <div className="flex items-center gap-2">
        {values.map((v, i) => {
          const widthPct = Math.max(0, Math.min(1, v)) * 100
          return (
            <div key={i} className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {SEGMENT_LABELS[i]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(v * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', SEGMENT_COLORS[i])}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {size === 'detail' && <DetailFooter ratios={ratios} />}
    </div>
  )
}

function DetailFooter({ ratios }: { ratios: EngagementComplianceRatios }) {
  // Identify weakest link
  const weakest = [
    { label: 'planification', v: ratios.planned },
    { label: 'exécution', v: ratios.executed },
    { label: 'preuves', v: ratios.proven },
    { label: 'validations', v: ratios.validated },
  ].sort((a, b) => a.v - b.v)[0]

  if (!ratios.promised) return null
  if (weakest.v >= 0.9) {
    return <p className="text-[11px] text-emerald-700">Tout est en bonne progression sur cet engagement.</p>
  }
  return (
    <p className="text-[11px] text-muted-foreground">
      Maillon faible : <span className="font-semibold">{weakest.label}</span> ({Math.round(weakest.v * 100)}%).
      {weakest.v < 0.5 && <span className="text-rose-700"> À reprendre cette semaine.</span>}
    </p>
  )
}
```

- [ ] **Step 2: Tests**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngagementCompliance } from '@/app/(dashboard)/contracts/[id]/engagement-compliance'

const FULL_RATIOS = { promised: true, planned: 1, executed: 1, proven: 1, validated: 1 }
const PARTIAL = { promised: true, planned: 1, executed: 1, proven: 0.76, validated: 1 }
const EMPTY = { promised: false, planned: 0, executed: 0, proven: 0, validated: 0 }

describe('EngagementCompliance', () => {
  it('compact mode renders 5 dots', () => {
    const { container } = render(<EngagementCompliance ratios={FULL_RATIOS} size="compact" />)
    const dots = container.querySelectorAll('[aria-label*="PROMIS"], [aria-label*="VALIDÉ"]')
    expect(dots.length).toBeGreaterThanOrEqual(2)
  })

  it('medium mode shows all 5 labels', () => {
    render(<EngagementCompliance ratios={FULL_RATIOS} size="medium" />)
    expect(screen.getByText('PROMIS')).toBeInTheDocument()
    expect(screen.getByText('PLANIFIÉ')).toBeInTheDocument()
    expect(screen.getByText('EXÉCUTÉ')).toBeInTheDocument()
    expect(screen.getByText('PROUVÉ')).toBeInTheDocument()
    expect(screen.getByText('VALIDÉ')).toBeInTheDocument()
  })

  it('detail mode highlights weakest link', () => {
    render(<EngagementCompliance ratios={PARTIAL} size="detail" />)
    expect(screen.getByText(/maillon faible/i)).toBeInTheDocument()
    expect(screen.getByText(/preuves/i)).toBeInTheDocument()
  })

  it('detail mode confirms when all green', () => {
    render(<EngagementCompliance ratios={FULL_RATIOS} size="detail" />)
    expect(screen.getByText(/bonne progression/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/components/engagement-compliance.test.tsx`
Expected: 4/4 PASS.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/contracts/\[id\]/engagement-compliance.tsx \
        tests/components/engagement-compliance.test.tsx
git commit -m "feat(engagement): EngagementCompliance Boucle de preuve 5 segments (signature visual)"
```

### Task 3.2 — Page contrat

**Files:**
- Create: `app/(dashboard)/contracts/[id]/page.tsx`

- [ ] **Step 1: Implement contract page**

```tsx
import { notFound } from 'next/navigation'
import { getContract } from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { EngagementCompliance } from './engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'

// Phase 1: only PROMIS is real, rest is 0
function phase1Ratios(): EngagementComplianceRatios {
  return { promised: true, planned: 0, executed: 0, proven: 0, validated: 0 }
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()
  const engagements = await listEngagementsByContract(id)

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{contract.name}</h1>
        <p className="text-sm text-muted-foreground">
          {contract.client_name} · démarré le {new Date(contract.start_date).toLocaleDateString('fr-FR')}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Engagements ({engagements.length})
        </h2>
        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun engagement actif sur ce contrat.</p>
        ) : (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li key={e.id} className="rounded-lg border p-4 bg-card">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{e.short_label}</div>
                    <div className="text-[11px] text-muted-foreground italic">« {e.source_excerpt} »</div>
                  </div>
                  <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground shrink-0">
                    {e.category}
                  </span>
                </div>
                <EngagementCompliance ratios={phase1Ratios()} size="medium" />
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground italic">
          Note : phases planification / exécution / preuves / validation seront alimentées
          dès la mise en place du module Field (Phase 2).
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Smoke test produit**

Avec un contrat de test ayant 18 engagements actifs :
1. Naviguer sur `/contracts/[id]`
2. Demander à 3 personnes différentes (idéalement 1 hors équipe tech) :
   « Que représente cette barre ? »
3. Mesurer le temps de compréhension
4. Cible : < 30 secondes pour 3/3

**RÉAGIR** : si compréhension < 2/3 sous 30s :
- Soit simplifier en 3 segments (PROMIS / EXÉCUTÉ / PROUVÉ uniquement)
- Soit ajouter une légende au-dessus de la 1ère barre
- Soit ajuster les couleurs

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/contracts/\[id\]/page.tsx
git commit -m "feat(engagement): contract page with engagement list + compliance bar"
```

---

## 13. Slice 4 — Wizard conversion AO → contrat

**Goal** : un Resp. AO peut, depuis un AO gagné, créer un contrat opérationnel en < 12 min.

**Risque testé** : fluidité du flow complet.

### Task 4.1 — Wizard 4 étapes

**Files:**
- Create: `app/(dashboard)/tenders/[id]/convert/page.tsx`
- Modify: `app/(dashboard)/tenders/[id]/engagements-actions.ts` (ajout `createContractAction`)
- Modify: `app/(dashboard)/tenders/[id]/page.tsx` (bouton « Convertir »)

- [ ] **Step 1: Server action createContract**

Append à `engagements-actions.ts` :

```ts
import { createContract } from '@/lib/db/contracts'
import { activateEngagementsForContract } from '@/lib/db/engagements'
import { redirect } from 'next/navigation'

const createContractSchema = z.object({
  tender_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  client_name: z.string().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function createContractAction(formData: FormData) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const parsed = createContractSchema.safeParse({
    tender_id: formData.get('tender_id'),
    name: formData.get('name'),
    client_name: formData.get('client_name'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date') || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const orgId = await getUserOrgId(user.id)
  if (!orgId) return { error: 'User has no org' }

  const contractId = await createContract({
    tender_id: parsed.data.tender_id,
    org_id: orgId,
    name: parsed.data.name,
    client_name: parsed.data.client_name,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    created_by: user.id,
  })
  const activatedCount = await activateEngagementsForContract(parsed.data.tender_id, contractId)

  return { ok: true, contractId, activatedCount }
}
```

- [ ] **Step 2: Wizard page**

```tsx
import { notFound } from 'next/navigation'
import { getTender } from '@/lib/db/tenders'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { ConvertWizard } from './convert-wizard'

export default async function ConvertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tender = await getTender(id)
  if (!tender) notFound()
  if (tender.status !== 'won') {
    return (
      <div className="rounded-xl border p-6 bg-rose-50">
        <p className="text-sm text-rose-800">Cet AO n'est pas marqué comme gagné. Conversion impossible.</p>
      </div>
    )
  }
  const engagements = await listEngagementsByTender(id)

  return <ConvertWizard tender={tender} engagements={engagements} />
}
```

- [ ] **Step 3: Wizard client component**

Create `app/(dashboard)/tenders/[id]/convert/convert-wizard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createContractAction } from '../engagements-actions'
import { EngagementCurationView } from '../engagement-curation-view'
import type { DbEngagement, DbTender } from '@/types/db'

export function ConvertWizard({ tender, engagements }: { tender: DbTender; engagements: DbEngagement[] }) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [pending, setPending] = useState(false)

  // Étape 1 — Identification
  const [name, setName] = useState(tender.title)
  const [clientName, setClientName] = useState(tender.client_name ?? '')
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState('')

  async function submit() {
    setPending(true)
    const fd = new FormData()
    fd.set('tender_id', tender.id)
    fd.set('name', name)
    fd.set('client_name', clientName)
    fd.set('start_date', startDate)
    if (endDate) fd.set('end_date', endDate)
    const r = await createContractAction(fd)
    setPending(false)
    if (r && 'error' in r && r.error) {
      toast.error(r.error)
    } else if (r && 'contractId' in r) {
      toast.success(`Contrat créé · ${r.activatedCount} engagements activés`)
      router.push(`/contracts/${r.contractId}`)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Header step={step} />

      {step === 1 && (
        <Step1
          name={name} setName={setName}
          clientName={clientName} setClientName={setClientName}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <Step2 engagements={engagements} onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && <Step3 onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && (
        <Step4 name={name} clientName={clientName} engagementsCount={engagements.length}
               pending={pending} onSubmit={submit} onBack={() => setStep(3)} />
      )}
    </div>
  )
}

function Header({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {[1, 2, 3, 4].map((s) => (
        <span key={s} className={s === step ? 'font-semibold text-foreground' : ''}>
          {s === 1 ? 'Identification' : s === 2 ? 'Engagements' : s === 3 ? 'Sites' : 'Récap'}
          {s < 4 && <span className="mx-2">·</span>}
        </span>
      ))}
    </div>
  )
}

function Step1(props: {
  name: string; setName: (s: string) => void
  clientName: string; setClientName: (s: string) => void
  startDate: string; setStartDate: (s: string) => void
  endDate: string; setEndDate: (s: string) => void
  onNext: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Identification du contrat</h2>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Nom du contrat</label>
        <input value={props.name} onChange={(e) => props.setName(e.target.value)} className="w-full rounded border p-2 text-sm" />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Client</label>
        <input value={props.clientName} onChange={(e) => props.setClientName(e.target.value)} className="w-full rounded border p-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Début</label>
          <input type="date" value={props.startDate} onChange={(e) => props.setStartDate(e.target.value)} className="w-full rounded border p-2 text-sm" />
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Fin (optionnel)</label>
          <input type="date" value={props.endDate} onChange={(e) => props.setEndDate(e.target.value)} className="w-full rounded border p-2 text-sm" />
        </div>
      </div>
      <button onClick={props.onNext} disabled={!props.name || !props.clientName || !props.startDate}
              className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50">
        Suivant
      </button>
    </div>
  )
}

function Step2({ engagements, onNext, onBack }: { engagements: DbEngagement[]; onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Curation des engagements ({engagements.length})</h2>
      <p className="text-xs text-muted-foreground">
        Validez ou supprimez les engagements détectés. Vous pourrez aussi sauter cette étape et curer plus tard.
      </p>
      <EngagementCurationView engagements={engagements} />
      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-1.5 rounded border text-sm">Précédent</button>
        <button onClick={onNext} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm">Suivant</button>
      </div>
    </div>
  )
}

function Step3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Sites du contrat</h2>
      <p className="text-xs text-muted-foreground">
        La gestion des sites sera disponible avec le module Field (Phase 2). Pour l'instant, vous pouvez continuer
        — vous ajouterez les sites quand le module sera disponible.
      </p>
      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-1.5 rounded border text-sm">Précédent</button>
        <button onClick={onNext} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm">Suivant</button>
      </div>
    </div>
  )
}

function Step4({
  name, clientName, engagementsCount, pending, onSubmit, onBack,
}: {
  name: string; clientName: string; engagementsCount: number
  pending: boolean; onSubmit: () => void; onBack: () => void
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card">
      <h2 className="text-sm font-semibold">Récapitulatif</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Contrat :</dt><dd>{name}</dd>
        <dt className="text-muted-foreground">Client :</dt><dd>{clientName}</dd>
        <dt className="text-muted-foreground">Engagements à activer :</dt><dd>{engagementsCount}</dd>
      </dl>
      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-1.5 rounded border text-sm" disabled={pending}>Précédent</button>
        <button onClick={onSubmit} disabled={pending} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50">
          {pending ? 'Création…' : 'Créer le contrat'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add link from tender page**

Modifier `app/(dashboard)/tenders/[id]/page.tsx` — quand `tender.status === 'won'`, afficher un bouton « Convertir en contrat » qui pointe vers `/tenders/[id]/convert`.

- [ ] **Step 5: E2E smoke test**

Créer un tender de test avec status `won` + engagements extraits. Compter le temps total :
1. Click « Convertir en contrat » → wizard
2. Étape 1 : remplir → 1 min
3. Étape 2 : curer 18 engagements → < 8 min cible
4. Étape 3 : skip → 5 sec
5. Étape 4 : valider → 5 sec
6. Redirect contract page → vérifier 18 engagements actifs avec barre PROMIS=100%

**Total cible : < 12 min**.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/tenders/\[id\]/convert \
        app/\(dashboard\)/tenders/\[id\]/engagements-actions.ts \
        app/\(dashboard\)/tenders/\[id\]/page.tsx
git commit -m "feat(engagement): wizard conversion AO → contract (4 steps, skip sites)"
```

---

## 14. Self-Review

### Couverture du spec

| Spec section | Implémenté par |
|---|---|
| § Engagement = entité 1er niveau | Slice 0 — table `engagements` |
| § Lifecycle extracted/curated/active/completed/archived | Slice 0 + Slice 2 |
| § Pas de `breached` | Slice 0 — CHECK constraint exclut breached |
| § AI extraction 15-30 engagements | Slice 1 — prompt cible 15-25 |
| § Curation ergonomique | Slice 2 — bulk + inline edit |
| § Engagement invisible terrain | N/A Phase 1 (terrain en Phase 2) |
| § Boucle de preuve 5 segments | Slice 3 — composant `EngagementCompliance` |
| § Drilldown 3 niveaux max | Slice 3 — page contrat = level 2 |
| § Wizard 4 étapes | Slice 4 |
| § Health calculé view-side | Phase 4 (pas Phase 1) |
| § RLS multi-tenant | Slice 0 — policies créées |
| § Wording cockpit (pas ERP) | Slice 3 — « bonne progression », « maillon faible » |

### Placeholder scan

Aucun TBD/TODO. Chaque step a code complet ou commande exacte.

### Type consistency

- `EngagementCategory`, `EngagementStatus`, `EngagementSourceType` cohérents Slice 0 → Slice 4
- `DbContract`, `DbEngagement` cohérents partout
- `EngagementComplianceRatios` défini Slice 0, utilisé Slice 3
- Server actions retournent `{ ok: true, ... } | { error: string }` partout (pattern existant du projet)

---

## 15. Décisions et stratégie pilote

| # | Décision | Choix |
|---|---|---|
| 1 | Phase 1 inclut Field ? | ❌ Non — Phase 2 |
| 2 | Health calculé Phase 1 ? | ❌ Non — toujours `unknown` |
| 3 | PLANIFIÉ/EXÉCUTÉ/PROUVÉ/VALIDÉ Phase 1 | Toujours 0% (gris) — alimentés Phase 2+ |
| 4 | Skip wizard étape 3 (sites) Phase 1 | ✅ Oui — placeholder |
| 5 | uipro skill activée | Optionnel à Slice 3 |
| 6 | Curation save-resume | ❌ Non MVP |
| 7 | Cross-tender matching | ❌ V1.2, pas Phase 1 |
| 8 | Pilote unique | ✅ Oui — règle |

### Critère Go/No-Go pour passer en Phase 2

À la fin des 5 semaines de Phase 1, on doit pouvoir cocher :
- [ ] 1 pilote a converti ≥ 3 AOs en contrats avec engagements
- [ ] Curation moyenne < 12 min
- [ ] Compréhension cockpit ≥ 2/3 testeurs en 30s
- [ ] Aucun bug bloquant non résolu
- [ ] Métriques produit collectées et analysées
- [ ] L'utilisateur DEMANDE Phase 2 (« comment je relie ça à mes missions ? »)

Si au moins 5/6 critères atteints → Go Phase 2.
Si < 5/6 → itération Phase 1 avant tout move.

---

## 16. Conventions techniques

- Tailwind v4 + couleurs existantes (`bg-card`, `text-muted-foreground`, etc.)
- Server Actions Next.js (pas d'API routes séparées)
- Tests vitest + @testing-library/react existants
- RLS Postgres pour multi-tenant
- `lib/db/*` pattern existant (admin client, async functions)
- Pas de nouvelle dépendance npm
- Pas de nouveau framework UI (uipro skill optionnelle, pas dépendance)
