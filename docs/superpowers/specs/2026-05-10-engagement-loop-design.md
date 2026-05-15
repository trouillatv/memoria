# Boucle Engagements — Architecture cockpit métier

**Date :** 2026-05-10
**Statut :** Design validé — prêt pour implémentation par phases
**Scope :** L'entité-pivot **Engagement** qui boucle AO → Promesse → Exécution → Preuve → Capitalisation
**Lignes directrices validées par l'utilisateur :** cf. dialogue produit du 2026-05-10

---

## 1. Test de réussite du produit (30 secondes démo)

Si dans 12 mois la séquence suivante peut être démontrée à un prospect en moins de 30 secondes, le produit est défensible :

1. **[5s]** *« Voici votre dernier AO gagné — analysé en 2 minutes par nos 7 experts IA »*
2. **[10s]** *« 18 promesses ont été extraites de votre mémoire technique. Vous les conservez ou rejetez en bulk. »*
3. **[10s]** *« Voici votre rapport mensuel structuré par promesse — chaque engagement avec son taux de réalisation, ses photos preuves, ses anomalies. »*
4. **[5s]** *« Et lors du prochain AO, MemorIA cite automatiquement vos preuves passées : "247 interventions sanitaires écolabel sur 12 sites, score qualité 4.7/5". »*

Si cette démo passe, le moat existe.

---

## 2. Le concept central — l'Engagement comme entité-pivot

### Définition formelle

> Un **Engagement** est une promesse atomique, citable, mesurable, traçable, extraite d'un AO ou d'un mémoire technique, qui devient opérationnelle lors de la signature du contrat.

### Ses 4 propriétés inhérentes

| Propriété | Conséquence |
|---|---|
| **Atomique** | Une promesse = un engagement. Pas d'arbre, pas de sub-engagements |
| **Citable** | Toujours liée à une source verbatim (AO clause ou mémoire section) |
| **Mesurable** | Soit oui (« 2x/jour ») soit non (« qualité maximale »). Le booléen est explicite |
| **Traçable** | Connectable aux preuves d'exécution via la chaîne `mission → checklist_item → photo` |

### Pourquoi pas une simple colonne dans `tender_analyses` ?

- Une promesse vit **au-delà du tender**. Elle existe pendant toute la durée du contrat (parfois 3-5 ans).
- Elle est référencée par **plusieurs entités field** (missions, anomalies, photos).
- Elle a son propre **cycle de vie indépendant** (extracted → curated → active → completed/breached/archived).
- Elle alimente le **moat cross-tender** (V1.2) qui nécessite une recherche distincte.

Stocker dans `tender_analyses` casserait l'architecture dès la phase 4 d'exécution.

---

## 3. Les 5 états de compliance — le cockpit central

### Le modèle de maturité opérationnelle

Inspiré directement de la formulation utilisateur, **chaque engagement vit dans une matrice à 5 dimensions de compliance** :

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  PROMIS    │ →→→ │ PLANIFIÉ   │ →→→ │ EXÉCUTÉ    │ →→→ │  PROUVÉ    │ →→→ │  VALIDÉ    │
│            │     │            │     │            │     │            │     │            │
│ engagement │     │ couvert    │     │ intervention│    │ photo(s)   │     │ superviseur│
│ actif sur  │     │ par ≥1     │     │ complétée   │    │ jointes    │     │ a signé    │
│ contrat    │     │ mission    │     │             │    │            │     │            │
└────────────┘     └────────────┘     └────────────┘     └────────────┘     └────────────┘
```

### Ces 5 états sont des **dimensions**, pas une chaîne linéaire

À tout moment, pour un engagement donné sur une période donnée, on peut dire :

- *« Promis ? »* — Booléen (est-ce dans le contrat actif)
- *« Planifié à X% »* — Ratio (combien de sites du contrat ont une mission qui couvre cet engagement)
- *« Exécuté à X% »* — Ratio (combien d'interventions attendues ont été réalisées)
- *« Prouvé à X% »* — Ratio (combien d'interventions exécutées ont des photos)
- *« Validé à X% »* — Ratio (combien d'interventions sont signées par le superviseur)

> **Compliance globale** = AND logique des 5. Si un seul des ratios est < 100%, il y a un trou que le rapport mensuel doit révéler.

### La visualisation cockpit

C'est le composant signature de MemorIA — l'écran où le prospect dit *« je n'ai jamais vu ça ailleurs »* :

```
┌──────────────────────────────────────────────────────────────────────┐
│ Sanitaires 2x/jour avec écolabel                                     │
│ Source : Mémoire technique §3.2 · Catégorie : frequency             │
│                                                                      │
│  PROMIS ── PLANIFIÉ ── EXÉCUTÉ ── PROUVÉ ── VALIDÉ                  │
│   ✅       ✅          ⚠ 88%       ⚠ 76%      ✅                     │
│            12/12       106/120     93/106     93/93                  │
│            sites       intvtns     photos     signat.                │
│                                                                      │
│  Trous : 14 interventions manquantes · 13 photos manquantes          │
│  [Voir détails →]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

Cette visualisation **rend visible l'écart entre la promesse et la réalité**. Elle fait peur à un prospect qui n'a aucun système (« je ne sais pas où je suis »), elle rassure un client mature (« je peux prouver »).

---

## 4. Lifecycle d'un Engagement (états indépendants des compliance)

```
              ┌──────────────────────────────────────────────────┐
              │                                                  │
              │    extracted                                     │
              │    (AI a proposé, AO en cours d'analyse)         │
              │         │                                        │
              │         │  user accepts/edits/rejects            │
              │         ▼                                        │
              │    curated                                       │
              │    (humain a validé, AO non encore gagné)        │
              │         │                                        │
              │         │  AO gagné → contrat créé               │
              │         ▼                                        │
              │    active                                        │
              │    (engagement opérationnel)                     │
              │         │                                        │
              │         ├─→ completed (contrat terminé OK)       │
              │         ├─→ breached (manquement avéré)          │
              │         └─→ archived (remplacé / déprécié)       │
              │                                                  │
              └──────────────────────────────────────────────────┘
```

### Règles de transition

| Transition | Déclencheur | Qui peut faire |
|---|---|---|
| `extracted` → `curated` | Validation utilisateur | Resp. AO |
| `extracted` → (suppression) | Rejet utilisateur | Resp. AO |
| `curated` → `active` | Création de contrat depuis AO | Resp. AO + auto système |
| `active` → `completed` | Contrat terminé sans issue | Resp. exploitation |
| `active` → `breached` | Manquement avéré (manuel) | Direction (rare) |
| `active` → `archived` | Engagement remplacé ou AO amendé | Resp. AO |
| **`active` → `curated`** | **INTERDIT** — un engagement actif n'est plus modifiable | — |

### Règle cardinale : pas de modification après activation

Une fois un engagement `active` :
- ❌ son texte source est immuable
- ❌ sa catégorie est immuable
- ❌ son label est immuable
- ✅ son status peut évoluer (vers archived/breached/completed)

Si la réalité métier change : on archive et on crée un nouvel engagement. Pas de versionning chain. **Cette rigidité est une feature, pas un bug** — elle préserve la traçabilité juridique.

---

## 5. Data model — minimal et précis

### Nouvelle table principale

```
engagements
─────────────────────────────────────────────────────────────────
  id                  uuid PK
  tender_id           uuid FK → tenders (origine, toujours présent)
  contract_id         uuid FK → contracts (nullable jusqu'à activation)
  source_type         text  ('ao_clause' | 'memoire_engagement' | 'manual')
  source_excerpt      text  (citation verbatim, immuable)
  source_ref          jsonb ({ page, section, anchor, library_item_id })
  category            text  ('frequency' | 'quality' | 'compliance' |
                              'delivery' | 'sla' | 'reporting' | 'other')
  short_label         text  (≤ 100 chars, pour l'UI)
  measurable          boolean
  ai_confidence       numeric(3,2)?   (score d'extraction IA, 0.00-1.00)
  status              text  ('extracted' | 'curated' | 'active' |
                              'completed' | 'breached' | 'archived')
  created_at, updated_at, created_by
  
  CONSTRAINT engagement_active_immutable :
    après transition vers 'active', source_excerpt + source_ref +
    category + short_label ne peuvent plus être modifiés
    (enforced application-side, pas DB-side)
```

### Liaison aux tables Field

```
missions
  + engagement_ids       uuid[]       -- many-to-many (validé)
  
checklist_items_template (dans missions.default_checklist jsonb)
  [
    { label, required, engagement_id?, ... }     -- 1-many (validé)
  ]
  
checklist_items (table runtime)
  + engagement_id        uuid?        -- copié du template à création
                                         intervention (peut être null)
  
photos
  -- pas de colonne engagement_id directe
  -- héritage indirect via checklist_item_id → engagement_id
  
anomalies
  + engagement_id        uuid?        -- si l'anomalie touche un engagement précis
```

### Vues calculées (à la demande, pas matérialisées MVP)

```sql
-- Compliance par engagement, sur une période
CREATE VIEW engagement_compliance AS
  SELECT
    e.id AS engagement_id,
    e.contract_id,
    -- PROMIS : booléen, trivial
    (e.status = 'active') AS is_promised,
    -- PLANIFIÉ : ratio
    COUNT(DISTINCT m.id) FILTER (WHERE e.id = ANY(m.engagement_ids)) AS planned_missions_count,
    -- EXÉCUTÉ : ratio
    COUNT(DISTINCT i.id) FILTER (WHERE i.status IN ('completed', 'validated')) AS executed_count,
    -- PROUVÉ : ratio  
    COUNT(DISTINCT i.id) FILTER (
      WHERE i.status IN ('completed', 'validated')
      AND EXISTS (SELECT 1 FROM photos p WHERE p.intervention_id = i.id)
    ) AS proven_count,
    -- VALIDÉ : ratio
    COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'validated') AS validated_count
  FROM engagements e
  LEFT JOIN missions m ON e.id = ANY(m.engagement_ids)
  LEFT JOIN interventions i ON m.id = i.mission_id
  WHERE e.status = 'active'
  GROUP BY e.id;
```

> **YAGNI explicite** : pas de table `engagement_compliance_cache`. Calcul à la demande jusqu'à 1000 contrats actifs. Au-delà, refacto.

### Tables nouvelles totales pour le module Field + boucle

| Table | Statut |
|---|---|
| `engagements` | NOUVEAU (boucle) |
| `contracts` | NOUVEAU (Field MVP) |
| `sites` | NOUVEAU (Field MVP) |
| `missions` | NOUVEAU (Field MVP) |
| `interventions` | NOUVEAU (Field MVP) |
| `checklist_items` | NOUVEAU (Field MVP) |
| `photos` | NOUVEAU (Field MVP) |
| `anomalies` | NOUVEAU (Field MVP) |
| `validations` | NOUVEAU (Field MVP) |
| `monthly_reports` | NOUVEAU (Field MVP) |

10 tables au total. Acceptable pour l'ampleur du module.

---

## 6. Architecture UX — par rôle

### Règle cardinale : l'Engagement est invisible côté terrain

| Rôle | L'Engagement existe-t-il dans son UI ? | Comment ? |
|---|---|---|
| **Direction** | OUI — vue agrégée | Dashboard compliance multi-contrats |
| **Responsable AO** | OUI — création/curation | Wizard conversion AO → contrat |
| **Responsable exploitation** | OUI — opérationnel | Mission Editor + rapports |
| **Superviseur** | NON — invisible | Voit interventions/anomalies seulement |
| **Agent terrain** | NON — totalement invisible | Voit checklist, jamais de mention engagement |
| **Client** | INDIRECT — via rapport | Le rapport mensuel structure par engagement, sans nommer le terme |

> **Anti-règle** : ne JAMAIS afficher le mot « Engagement » dans l'app agent terrain. Le terrain voit *Mission → Checklist → Photo → Validation*. Point.

### Le wording adapté par audience

| Audience | Terme utilisé | Pourquoi |
|---|---|---|
| Resp. AO + Direction | « Engagement » | C'est le mot juridique précis |
| Resp. exploitation | « Engagement » ou « Promesse » selon contexte | Bilingue acceptable |
| Client (rapport) | « Promesse contractuelle » ou « Prestation engagée » | Plus relationnel |
| Agent terrain | (jamais mentionné) | Invisible |

---

## 7. Navigation produit complète

### Architecture des modules MemorIA

```
┌─────────────────────────────────────────────────────────────┐
│ TOP NAV : Tenders | Library | Contracts | Reports | Admin   │
└─────────────────────────────────────────────────────────────┘
       │            │           │           │
       ▼            ▼           ▼           ▼

[TENDERS]      [LIBRARY]   [CONTRACTS]   [REPORTS]
- Liste AOs    - Items     - Liste       - Rapports mensuels
- Detail AO    - Eng. ext. - Detail      - Dashboard direction
  - Synthèse                 - Sites
  - Analyse                  - Engagts
  - Mémoire                  - Missions
  - Copilote                 - Interventions
  - Eng. extraits            - Compliance
```

### Nouveaux écrans

```
/tenders/[id]                        ← existant
/tenders/[id]/engagements            ← NOUVEAU — engagements extraits
/tenders/[id]/convert-to-contract    ← NOUVEAU — wizard

/contracts                           ← NOUVEAU — liste
/contracts/[id]                      ← NOUVEAU — overview
/contracts/[id]/sites                ← NOUVEAU — sites du contrat
/contracts/[id]/engagements          ← NOUVEAU — engagements actifs + compliance
/contracts/[id]/missions             ← NOUVEAU — recettes
/contracts/[id]/interventions        ← NOUVEAU — exécutions
/contracts/[id]/reports              ← NOUVEAU — rapports mensuels

/missions/[id]                       ← NOUVEAU — détail + édition checklist
/interventions/[id]                  ← NOUVEAU — exécution agent + validation
/interventions/[id]/photos           ← NOUVEAU — galerie

/m/                                  ← NOUVEAU — mobile agent (hub simple)
/m/[interventionId]                  ← NOUVEAU — exécution mobile

/dashboard                           ← NOUVEAU — direction multi-contrats
```

---

## 8. UX flows critiques détaillés

### Flow 1 — Wizard `Convertir AO en contrat` (Resp. AO)

Déclenché depuis la page tender quand `tender.status === 'won'` et que le bouton « Convertir en contrat » est cliqué.

```
ÉTAPE 1/4 — Identification du contrat
├── Nom du contrat (auto-prefilled depuis tender.title)
├── Client (auto)
├── Date de début
├── Date de fin (optionnel)
├── Multi-tenant scope (si org multi-établissements)
└── [Suivant]

ÉTAPE 2/4 — Curation des engagements ← LE MOMENT CRITIQUE
├── Vue split 50/50 :
│   ┌────────────────────────┬────────────────────────┐
│   │ SOURCE                 │ ENGAGEMENTS DÉTECTÉS   │
│   │                        │                        │
│   │ AO clauses (extraits)  │ ☑ Sanitaires 2x/j      │
│   │  → click une clause    │   « page 12 §3.2 »     │
│   │    surligne celle      │   freq.  conf. 0.94    │
│   │    extraite            │                        │
│   │                        │ ☑ Écolabel obligatoire │
│   │ Mémoire technique      │   « page 18 §4.1 »     │
│   │  → engagements pris    │   quality  conf. 0.87  │
│   │                        │                        │
│   │                        │ ☐ Audit hebdomadaire   │
│   │                        │   « page 22 »          │
│   │                        │   compliance conf. 0.62│
│   │                        │                        │
│   │                        │ ... (24 au total)      │
│   └────────────────────────┴────────────────────────┘
│   
│   Bulk : [Tout cocher] [Tout décocher]
│           [Filtrer par catégorie ▾]
│   
│   Engagement avec confiance < 0.7 → fond ambré (alerte)
│   Engagement avec confiance < 0.5 → décoché par défaut
│
└── [Précédent] [Skip cette étape] [Suivant : 18/24 sélectionnés]

ÉTAPE 3/4 — Sites du contrat
├── Saisie manuelle ou import CSV
├── Pour chaque site : nom, adresse, contact
└── [Précédent] [Suivant]

ÉTAPE 4/4 — Création des missions (suggestions)
├── Pour chaque engagement de catégorie 'frequency', MemorIA propose 1 mission
│   ┌────────────────────────────────────────────────┐
│   │ ☑ Suggestion : Mission "Sanitaires quotidiens" │
│   │   Cadence : daily                              │
│   │   Couvre : Sanitaires 2x/j + Écolabel          │
│   │   Sites : tous (12) ou personnaliser           │
│   │   Checklist suggérée :                         │
│   │     ☐ Désinfection sanitaires (avant + après)  │
│   │     ☐ Vérification écolabel produits           │
│   │   [Éditer]                                     │
│   └────────────────────────────────────────────────┘
├── Mode "Skip — je créerai mes missions plus tard"
└── [Précédent] [Créer le contrat]
```

> **Risque UX flagué** : si l'utilisateur skip l'étape 4, il devra créer ses missions manuellement plus tard. Pas bloquant mais friction. Le skip doit être un bouton secondaire, pas dominant.

### Flow 2 — Resp. exploitation : édition d'une mission avec engagement linkage

```
[/missions/[id] — Mission Editor]

Mission "Nettoyage CHU Tour B"
├── Header
│   ├── Site : CHU Tour B
│   ├── Cadence : daily
│   ├── Équipe par défaut : Mehdi + Karim
│
├── Engagements couverts (multi-select)
│   ☑ Sanitaires 2x/j avec écolabel
│   ☑ Audit qualité hebdomadaire
│   ☐ Reporting J+1
│   [+ Ajouter un engagement ▾]
│
├── Checklist template
│   ┌──────────────────────────────────────────────────┐
│   │ ☐ Vidage poubelles                               │
│   │   ↳ engagement : (aucun) [Lier ▾]                │
│   │                                                  │
│   │ ☐ Désinfection sanitaires                        │
│   │   ↳ engagement : Sanitaires 2x/j ✓               │
│   │   ↳ photos requises : avant + après              │
│   │                                                  │
│   │ ☐ Nettoyage couloir                              │
│   │   ↳ engagement : (aucun) [Lier ▾]                │
│   │                                                  │
│   │ ☐ Aération                                       │
│   │   ↳ engagement : (aucun) [Lier ▾]                │
│   │                                                  │
│   │ ☐ Vérification écolabel produits                 │
│   │   ↳ engagement : Écolabel obligatoire ✓          │
│   └──────────────────────────────────────────────────┘
│
├── Couverture des engagements (read-only, calculée)
│   ✓ Sanitaires 2x/j      → couvert (1 item)
│   ✓ Écolabel             → couvert (1 item)
│   ⚠ Audit hebdomadaire   → NON COUVERT par cette mission
│
└── [Sauvegarder]
```

> **Détail clé** : la couverture est affichée **read-only**, c'est un soft warning. L'utilisateur n'est PAS bloqué s'il oublie un engagement. Mais il voit le trou.

### Flow 3 — Agent terrain (engagements totalement invisibles)

```
[/m/intervention/[id]]

← CHU Tour B · 8h00-10h00

Checklist :
  ☐ Vidage poubelles
    📷 [photo après]
    
  ☐ Désinfection sanitaires
    📷 [avant]  📷 [après]
    
  ☐ Nettoyage couloir
    📷 [photo après]
    
  ☐ Aération
    [✓ valider sans photo]
    
  ☐ Vérification écolabel produits
    📷 [photo des produits]

[⚠ Anomalie]    [✓ Mission terminée]
```

L'agent **ne voit jamais** les mots « Engagement », « Sanitaires 2x/j », « Écolabel obligatoire ». Il voit des tâches concrètes. Le mapping est silencieux.

### Flow 4 — Génération du rapport mensuel client (Resp. exploitation)

```
[/contracts/[id]/reports/new]

Générer un rapport mensuel
├── Contrat : CHU Toulouse
├── Période : Mai 2026
├── [Générer]

(quelques secondes — calcul aggregates SQL)

[Aperçu du rapport — Mai 2026 — CHU Toulouse]
─────────────────────────────────────────────────────────────────

Synthèse exécutive
  • 22 jours d'intervention sur 22 prévus (100%)
  • 18 engagements suivis, 17 conformes (94%)
  • 1 engagement partiellement compromis : Audit hebdomadaire (2/4)
  • 134 preuves photos · 3 anomalies · 0 incident grave

─────────────────────────────────────────────────────────────────

ENGAGEMENTS SUIVIS (18)

  1/ Sanitaires 2x/jour avec écolabel              ✅ 100%
     Source : Mémoire technique §3.2
     22/22 interventions · 134 photos · 0 anomalie
     Score qualité : 4.7/5
     [Voir 6 photos sélectionnées ▾]

  2/ Audit qualité hebdomadaire                    ⚠ 50%
     Source : AO clause 4.7.1
     2/4 audits réalisés
     ⚠ Audits manqués : S22 (4 mai), S25 (25 mai)
     Cause documentée : indisponibilité auditeur (S22), férié (S25)
     [Détails →]

  ... (16 autres)

─────────────────────────────────────────────────────────────────

ANOMALIES TRAITÉES (3)
  • Eau coupée — site Tour B, 12 mai, résolu en 2h30
  • Matériel cassé — site Tour A, 18 mai, remplacé J+1
  • Accès bloqué — site Annexe, 26 mai, intervention reportée

─────────────────────────────────────────────────────────────────

[Édition libre intro/conclusion]
[Inclure dans le rapport ▾]    [Générer PDF]    [Envoyer au client]
```

Le rapport est **structuré par engagement**, c'est sa colonne vertébrale. Le client voit la promesse + la preuve, alignées. C'est le livrable visible de la boucle.

### Flow 5 — Le moat se ferme (V1.2) : nouvelle réponse AO

```
[Tender Editor — nouvelle réponse AO en cours]

Mémoire technique → section sur les sanitaires

L'utilisateur tape : « Notre approche pour le nettoyage des sanitaires...»

MemorIA détecte la similarité avec un engagement passé.

┌────────────────────────────────────────────────────────────────┐
│ 💡 Évidence disponible — basée sur vos contrats passés          │
│                                                                │
│ ─ Sanitaires 2x/jour écolabel                                  │
│   • 3 contrats · 36 mois cumulés · 780 interventions          │
│   • 4.7/5 score qualité moyen                                  │
│   • 1 anomalie résolue en 24h                                  │
│   • 412 photos preuves disponibles                             │
│                                                                │
│ Insertion proposée (paragraphe rédigé) :                       │
│ « Nous avons l'expérience pratique de cette exigence : sur     │
│   nos 3 derniers contrats sanitaires (CHU Toulouse, École Jean │
│   Jaurès, Banque Centrale), nous avons réalisé 780 inter-      │
│   ventions de désinfection biquotidienne avec produits         │
│   écolabel sur 36 mois, avec un score qualité moyen de 4.7/5   │
│   et un seul incident résolu sous 24h. Photos preuves          │
│   disponibles sur demande. »                                   │
│                                                                │
│ [Insérer dans le mémoire]    [Voir les preuves]    [Ignorer]   │
└────────────────────────────────────────────────────────────────┘
```

Click "Insérer" → le paragraphe est ajouté au mémoire technique avec citations cliquables vers les engagements passés. **C'est ça le moat**.

---

## 9. Dashboard direction (cockpit multi-contrats)

```
[/dashboard]

Mes contrats actifs : 12

┌──────────────────────────────────────────────────────────────────────┐
│ Contrat        │ Engagts │ Compliance │ Score │ Anomalies │ Statut   │
│ CHU Toulouse   │  24     │ ████████░░ │ 4.7/5 │     1     │ ✅ OK    │
│ École JJ       │  18     │ ███████░░░ │ 4.5/5 │     2     │ ✅ OK    │
│ Banque         │  12     │ █████░░░░░ │ 4.2/5 │     5     │ ⚠ Watch  │
│ Médiathèque    │  20     │ ███░░░░░░░ │ 3.8/5 │    11     │ 🔴 ALERT │
│ ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘

⚠ Alertes (3)
  • Médiathèque : 6 audits manqués sur 12 (« Audit qualité hebdo »)
  • Banque : 4 anomalies récurrentes Eau coupée
  • CHU Toulouse : score qualité en baisse 4 sem. (4.9 → 4.7 → 4.5)

📊 Capital preuves accumulé
  • 1247 photos validées sur 12 mois
  • 18 engagements types prouvés
  • Disponibles pour réponses AO futures
```

> **Compliance** est calculée comme la **moyenne géométrique** des 5 ratios (PROMIS × PLANIFIÉ × EXÉCUTÉ × PROUVÉ × VALIDÉ). Une alerte rouge déclenchée à 70% ou moins.

---

## 10. Règles métier critiques

### R1 — Pas de modification d'engagement actif
Une fois `status = 'active'`, les champs source/category/label sont immuables. Pour changer : archiver et recréer.

### R2 — Engagement non couvert = soft warning
Un engagement actif sans aucune mission liée est signalé visuellement (jaune) mais ne bloque rien. Un compteur « N/M engagements couverts » est visible dans le dashboard contrat.

### R3 — Hérédité engagement_id immuable après création intervention
Quand une intervention est créée depuis un mission template, ses `checklist_items` héritent de `engagement_id`. Cette valeur est figée à la création de l'intervention. Si la mission template change après, les futures interventions reflètent le nouveau template, mais les anciennes restent intactes.

### R4 — Photo héritage par checklist_item_id
Une photo prise sur un `checklist_item` qui a un `engagement_id` est implicitement preuve pour cet engagement. Pas de champ `photo.engagement_id` direct — éviter la dénormalisation source de bugs.

### R5 — Anomalie peut directement référencer un engagement
Différent du flux normal : si un agent lève une anomalie qui touche un engagement précis (sans passer par checklist), il peut le déclarer. Mais dans 90% des cas, l'anomalie est juste liée à l'intervention.

### R6 — Cross-tender matching (V1.2) scope tenant uniquement
Le matching engagement-similar entre AO ne traverse JAMAIS la frontière tenant. Un client A ne voit jamais les engagements d'un client B.

### R7 — Rapport mensuel = snapshot
Une fois un rapport généré (`monthly_reports` row créée), il est immuable. Si la donnée sous-jacente change, le rapport ne change pas automatiquement. Un nouveau rapport peut être généré pour la même période en remplacement (ancien archivé).

### R8 — Validation = 1 superviseur, 1 timestamp, 1 commentaire optionnel
Pas de signature e-IDAS. Pas de workflow multi-niveau. Juste : qui a validé, quand, avec un commentaire libre. Suffisant pour l'audit ISO9001.

---

## 11. Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Extraction IA produit > 30 engagements ou bruit | Moyenne | Élevé | Prompt engineering ciblé + bulk delete + filtre confiance |
| Curation step trop lourde → abandon | Élevée | Élevé | Bulk actions + save-resume + skip optionnel |
| Engagement non-couvert silencieusement | Moyenne | Moyen | Soft warning visible mais pas bloquant |
| Granularité mismatch (1 engagement → N items) | Moyenne | Faible | Multi-many au niveau mission acceptable |
| Cold start (nouveau client = 0 historique) | Certaine | Moyen | Communication produit transparente : « valeur compose dans le temps » |
| Cross-tender matching trop bruyant V1.2 | Probable | Moyen | TF-IDF basique + seuil ajustable + insertion 1-clic mais pas auto |
| Le mot "Engagement" dans l'app agent | Faible | Élevé (UX) | Code review + tests linting du wording côté agent UI |
| Performance des aggregates au scale | Faible (court terme) | Moyen | Index DB ciblés, vue matérialisée à 1000 contrats |

---

## 12. MVP scope — phases concrètes

### Phase 1 — Fondations + extraction (4-6 semaines)
- Migration DB : 10 tables (incluant `engagements`)
- Extraction engagements IA (nouvel agent ou augmentation Lecteur AO)
- UI curation engagements (page tender)
- Wizard conversion AO → contrat (4 étapes)
- Dashboard contract minimal

### Phase 2 — Field MVP (6-8 semaines)
- Sites + Missions + Interventions + Checklist
- Photo upload avec contexte
- Anomalies + Validations
- App agent web responsive (3 écrans)

### Phase 3 — Liaison engagements ↔ field (2-3 semaines)
- Mission Editor : multi-select engagements
- Checklist template : engagement_id par item
- Hérédité auto vers interventions

### Phase 4 — Restitution (3-4 semaines)
- Rapport mensuel structuré par engagement
- Vue compliance par engagement (cockpit 5 états)
- Dashboard direction multi-contrats

### Phase 5 — Le moat (V1.2 — 4-6 semaines)
- Cross-tender engagement matching (TF-IDF)
- Insertion 1-clic dans mémoire technique
- Bibliothèque preuves consolidée

**Total MVP complet : 19-27 semaines (5-7 mois).**

---

## 13. Hors scope — ce qu'on REFUSE explicitement

### Refus produit

- ❌ Sub-engagements / arbre d'engagements
- ❌ Modification d'un engagement actif
- ❌ Engagement library cross-tenant (benchmark)
- ❌ Score auto-pénalisant sans contrôle humain
- ❌ Workflow d'approbation multi-étapes pour curation
- ❌ Versionning chain des engagements
- ❌ Le mot « Engagement » dans l'UI agent terrain
- ❌ Engagement « live » sans source documentaire
- ❌ Rapport client en temps réel (asynchrone toujours)

### Refus architectural

- ❌ Tables de cache prématurées (compliance, metrics)
- ❌ Vector embeddings pour matching V1.2 (TF-IDF d'abord)
- ❌ Soft-delete des engagements
- ❌ Triggers DB pour calculs de compliance (calcul à la demande)
- ❌ ML pour catégorisation auto (LLM suffit)

### Refus UX

- ❌ Mention « engagement » sur le rapport client (« promesse contractuelle » à la place)
- ❌ Notifications push sur breach engagement (alerte dashboard suffit)
- ❌ Drill-down infini (max 3 niveaux de profondeur dans la nav)
- ❌ Wizards plus longs que 4 étapes
- ❌ Curation forcée (toujours optionnelle)

---

## 14. Décisions tracées

Validées avec l'utilisateur le 2026-05-10 :

| # | Décision | Choix |
|---|---|---|
| 1 | Engagement = entité de premier niveau | ✅ Table dédiée |
| 2 | Liaison checklist_item ↔ engagement | ✅ One-to-many (1 item = 1 engagement max) |
| 3 | Liaison mission ↔ engagement | ✅ Many-to-many |
| 4 | Création engagements | ✅ Hybride : extraction précoce, activation au gain |
| 5 | Curation obligatoire | ✅ Optionnelle |
| 6 | Engagement non couvert | ✅ Soft warning |
| 7 | Cross-tender matching V1.2 | ✅ TF-IDF d'abord |
| 8 | Génération rapport | ✅ Resp. exploitation + direction (manuelle MVP) |
| 9 | Engagement invisible terrain | ✅ Règle cardinale |
| 10 | Distinction Promis/Planifié/Exécuté/Prouvé/Validé | ✅ 5 dimensions de compliance |

---

## 15. Le 30-secondes-test — protocole de démo

Démo type pour un prospect cleaning company :

```
[10s] Module AO
"Voici votre dernier AO gagné. 7 agents IA l'ont analysé en 2 min.
 Cliquez sur Mémoire technique → généré, prêt à exporter."

[10s] Engagements extraits
"MemorIA a extrait 18 promesses de votre mémoire technique.
 Vous validez en bulk — 5 minutes max. Une fois fait, votre contrat
 est mobilisable."

[10s] Cockpit compliance
"Voici 6 mois plus tard. Pour chaque promesse :
 → Promis ? oui (100%)
 → Planifié ? 100%
 → Exécuté ? 94%  ← un trou
 → Prouvé ? 88%   ← deux trous
 → Validé ? 88%
 Le rapport client mensuel est généré automatiquement, structuré par promesse.
 Le client voit ce qu'on lui a promis et la preuve photo."

[Bonus 10s — V1.2] Le moat
"Et regardez : nouveau AO. Lecteur AO détecte une clause
 'sanitaires écolabel'. MemorIA cite automatiquement vos preuves passées :
 412 photos, 18 mois, score 4.7/5. Insertion en 2 clics dans le mémoire technique.
 Aucune autre solution sur le marché ne fait ça."
```

Si cette démo convainc en 30 secondes, le produit est défensible.

---

## 16. Conventions techniques

- Toutes nouvelles tables : indexes sur `tenant_id`, `contract_id`, `tender_id`, `created_at`
- RLS Postgres pour isolation multi-tenant stricte
- Pas de cascade delete sur `engagements` — soft archive uniquement
- Server Actions Next.js pour mutations
- React Server Components par défaut, client uniquement si interactif
- Wording cible : « Engagement » côté ops, « Promesse » côté client, jamais côté terrain

---

## 17. Validation

Spec validé pour conception par l'utilisateur le 2026-05-10 sur les 10 décisions du § 14.

**Prochaine étape recommandée** : invoquer `superpowers:writing-plans` pour produire le plan d'implémentation détaillé Phase par Phase, en commençant par Phase 1 (extraction engagements + wizard conversion AO → contrat).

Avant ce plan : creuser éventuellement les sous-thèmes B (format photo détaillé) ou C (app agent terrain) si besoin de précision avant codage.
