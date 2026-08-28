# Audit READ-ONLY — qualité des 12 « nouveaux » sujets Bella (révélés par #230)

**Question centrale.** Les 12 `business_subject` classés « nouveaux » entre les 2 PV Bella
sont-ils 12 identités métier durables, ou l'extraction/canonicalisation a-t-elle promu des
faits/contextes/noms de chantier/formulations au rang de sujets ? Test : *« identité métier
que David pourrait raisonnablement vouloir retrouver et suivre dans les prochains PV ? »*.
Classification indépendante de `knowledge_fact` (famille d'occurrence ⊥ nature durable, #228).

**Aucune écriture. Aucune fusion. Aucun renommage. Aucun UPDATE. Aucune migration.**
Sondes : `scripts/audit-bella-12-identify.ts`, `audit-bella-12-enrich.ts`,
`audit-bella-transversal.ts`, `audit-ocef-all.ts`.

## 1. Les 12 (source : PV import « Visite 2025-07-17 », commission de sécurité, page 1)

| # | canonical_subject | label canonique | occ | state_key / status | classification | info vraie ? | doit être CS ? |
|---|---|---|---|---|---|---|---|
| 1 | 8815498b | Largeur de passage des dégagements réduite (par frigos) | 1 | observation / unknown | **A** | oui | oui |
| 2 | 0bcc588c | Portes CF non conformes | 1 | knowledge_fact / resolved | **B** (libellé) | oui | oui |
| 3 | 1de36dcb | Contrôles climatisation | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 4 | e76e4cf9 | Plans et consignes | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 5 | e8929f5e | Récupération des huiles usagées | 1 | knowledge_fact / open | **A** | oui | oui |
| 6 | 4fd7b99f | Formation sécurité du personnel | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 7 | c7b3a0c4 | Têtes de Sprinkler dégagées | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 8 | c33683c7 | Réaction au feu du mobilier d'aménagement intérieur | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 9 | ffa39d5a | Largeur de passage de la distribution | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 10 | aaec7f76 | Parois CF (traversées) | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 11 | f27e3439 | Arrêt d'urgence | 1 | knowledge_fact / resolved | **A** | oui | oui |
| 12 | cc12fce6 | Contrôle éclairage de sécurité | 3 | knowledge_fact→action→field_visit | **A** (témoin fort) | oui | oui |

**Catégories** : A DURABLE_SUBJECT · B DURABLE_BUT_BAD_LABEL · C FACT_NOT_SUBJECT · D SITE_OR_DOCUMENT_CONTEXT ·
E ACTOR_MISCLASSIFIED · F DUPLICATE_OR_FRAGMENT · G UNCERTAIN.

**Résultat : 11 A + 1 B. Zéro C/D/E/F/G.** Les 12 sont de vrais points de contrôle d'une
commission de sécurité (dégagements, portes CF, sprinklers, arrêt d'urgence, éclairage de
sécurité, formation…), exactement le type de sujet qu'un exploitant suit d'une inspection à
l'autre. Aucun n'est un fait éphémère, un nom de chantier, un titre de document ni un acteur.

- **B unique — #2 « Portes CF non conformes »** : le sujet (portes coupe-feu) est durable, mais
  le libellé canonique fige un verdict **« non conformes »** alors que l'occurrence source dit
  **« non applicables »** (sens opposé). Défaut de LIBELLÉ, pas d'identité. Aucun correctif ici.
- **#12 « Contrôle éclairage de sécurité »** = meilleur témoin de légitimité : 3 occurrences
  reliant un contrôle 2024 (Bureau Véritas), un état « à refaire » 2025, et une programmation en
  visite terrain 2026 — une vraie ligne de vie longitudinale multi-sources.

**Pas de F** : aucun des 12 ne double l'un des 9 `business_subject` pré-existants (électrique,
extincteurs, cuisson, nettoyage, extraction, issue de secours, dégagement mall, registre
sécurité, séparation flux, extinction friteuse) — domaines distincts. Occurrences uniquement
au PV 2025 → « nouveaux » authentiques (le PV 2024 ne portait pas ces points).

## 2. Témoin obligatoire — « BELLA NAPOLI »

Trace : `canonical_subject` **d911ab4e**, `kind=actor`, **0 occurrence**, `creation_source=null`,
aucun lien company/contact. **Le nom du site N'EST PAS devenu un `business_subject`** : c'est un
nœud **acteur vide et inerte**. Conséquence : exclu du pool métier (#228) ET sans occurrence →
**invisible dans l'Aperçu, l'attention et l'activité #230**. Il n'a jamais pollué les compteurs.
Nature : contexte (nom d'établissement) promu au rang d'acteur — catégorie D exprimée comme
acteur vide. Impact réel = nul aujourd'hui (0 occurrence, actor-exclu). Premier endroit où le
système aurait pu ne pas le créer : la passe d'identification d'acteurs. **Aucun correctif.**

## 3. Transversalité (READ-ONLY) — OCEF / PETRO

| Site | id | CS (actor / business) | personnes en business | nom du site en business | verdict |
|---|---|---|---|---|---|
| Lycée PETRO ATTITI | 75bd3d23 | 27 business | 0 | 0 | **propre** |
| OCEF Compostage (prod, récent) | 06c62e48 | 57 (22 / 35) | 0 | 0 | **propre** (reconc. 17→25 août) |
| **OCEF Compostage (recette)** | **2c939e67** | **425 (22 / 403)** | **10 ⚠️** | **5 ⚠️** | **POLLUÉ** |
| OCEF — Recette Chemin B | fae6149d | 113 (19 / 94) | 0 | 0 | propre |
| OCEF6 / Ocef4 | 655edb00 / ba4f3567 | 86 / 29 | 0 | 0 | propre |

Le pattern redouté (personnes, nom de chantier promus `business_subject`, fragmentés) **existe**,
mais **concentré sur une fixture de recette `2c939e67`** : « Mme DOUYERE » ×6, « Mme ROUSSEL » ×4,
« OCEF » ×5 — **tous créés le 2026-08-02** (fragments/doublons = catégorie E + F). Les sites
reconciliés plus récemment (06c62e48 : 17→25 août) présentent un split actor/business sain et
**zéro** personne ou nom de site en `business_subject`.

## 4. Dette historique vs défaut du workflow actuel

- **Bella (les 12)** : **pas un défaut**. Résidu historique légitime — #230 a simplement révélé
  que l'ancien « 2 nouveaux » masquait une commission de sécurité 2025 entière (12 vrais points).
- **Pollution personnes/nom-de-site OCEF** : **dette historique (A)**, datée du **2026-08-02**,
  antérieure aux correctifs de typage acteur (#228 / actor-auto-link / insertion orphan-actor
  `kind:'actor'`). Le reconcile le plus récent (06c62e48) type les personnes en `actor` (22
  acteurs, 0 fuite) → **pas de reproduction observée**. Réserve : le chemin de clustering des
  orphelins (`canonical-subject-historical-reconcile.ts:369`, création `kind:'business_subject'`
  derrière une porte Gemini `isDurableSubject`) reste probabiliste ; une preuve définitive de
  non-récurrence demanderait un replay ciblé d'un PV riche en personnes (hors périmètre, HARD STOP).

## 5. Synthèse

**12 nouveaux Bella = 11 durables + 1 mauvais libellé + 0 fact-not-subject + 0 contexte +
0 acteur + 0 fragment + 0 incertain.** Combien devraient réellement être racontés à David comme
« nouveaux sujets » ? **Les 12** (tous de vrais points de contrôle de la commission 2025), avec
une réserve de restitution : plusieurs portent un état « conforme/OK » — légitimes comme sujets,
mais « nouveau sujet » peut sur-vendre un simple verdict positif (nuance de récit, pas de mémoire).

**La mémoire canonique de Bella est SAINE.** Le défaut de constitution (personne/nom-de-site →
`business_subject`) est réel mais **circonscrit à une fixture de recette du 2 août**, pas au
workflow courant ni à Bella. Priorité de réparation éventuelle (sur décision) : **libellé #2
(Portes CF)** sur Bella, et **nettoyage données** de la fixture `2c939e67` — jamais avant d'avoir
tranché « dette vs récurrence » par un replay ciblé.

**Interdits respectés** : aucun filtre knowledge_fact #230, aucune modif #228, aucun masquage,
fusion, suppression, renommage, modif extraction/canonicalisation, aucune règle Bella.
**HARD STOP — diagnostic seul.**
