# 14 — PL3-0a : la preuve avant la migration

> Demandé : « documente l'index actuel, exécute la requête de détection des
> doublons (notamment `slot IS NULL`), prouve qu'aucun doublon n'existe, propose
> la migration, analyse son impact. **Ne code pas `materializeOccurrence` avant
> validation.** »
>
> Tout ci-dessous est mesuré **contre la base réelle** (PostgreSQL 17.6,
> 2026-07-13). **Aucune migration n'a été créée. Aucun code n'a été écrit.**

## LE FAIT QUI CHANGE LA PRIORITÉ

```
interventions issues d'un RYTHME (template_id NOT NULL) ........  0
      dont slot NULL (le cas dangereux) .........................  0
interventions PONCTUELLES (template_id NULL) ................... 42
                                                          TOTAL   42

templates de rythme ACTIFS ...................................... 0
```

**Le moteur de récurrence n'a AUCUNE donnée en production.** Zéro rythme actif,
zéro intervention générée. Les 42 interventions existantes ont toutes été créées
**à la main** (`template_id NULL`) — elles échappent d'ailleurs entièrement à
l'index unique, dont le prédicat est `WHERE template_id IS NOT NULL`.

Trois conséquences honnêtes :

1. **Le problème de matérialisation est aujourd'hui THÉORIQUE.** `materializeOccurrence`
   ne servirait à rien tant que personne ne crée de rythme.
2. **La migration est gratuite** : 0 ligne à nettoyer, 0 doublon, 0 conflit.
   C'est **le meilleur moment** pour la poser — exactement ton raisonnement.
3. **PL3a fonctionne quand même** : il détecte les conflits sur les interventions
   **matérialisées**, or les 42 le sont. Le signal est donc bien vivant.

> **La vraie question produit** que cela soulève, et qui t'appartient : Guillaume
> n'utilise pas les rythmes. Soit il ne les a pas trouvés, soit ils ne
> correspondent pas à sa façon de planifier (il pense en **présences**, cf.
> `audit/10-planning-pl0.md`). Cela ne bloque pas PL3-0a — mais cela questionne
> l'urgence de PL3-0b.

## 1. L'index actuel — définition exacte

```sql
CREATE UNIQUE INDEX idx_interventions_template_unique
  ON public.interventions USING btree (template_id, scheduled_for, slot)
  WHERE (template_id IS NOT NULL);
```

**Pas de `NULLS NOT DISTINCT`.** Postgres traite donc deux `NULL` comme
**distincts** : deux lignes `(template, date, NULL)` seraient **toutes deux
acceptées**. Le « filet anti-course » n'en est pas un dans ce cas.

## 2. Détection des doublons — la preuve

| Requête | Résultat |
|---|---|
| Doublons sur `(template_id, scheduled_for, slot)` — tous | **0** |
| Doublons avec **`slot IS NULL`** (le cas dangereux) | **0** |
| Doublons bloquant la création du futur index | **0** |
| Même template, même jour, même slot, **heures différentes** | **0** |

**Aucun doublon. La migration passera sans conflit.**

## 3. Qui crée des interventions ? (les appels à vérifier)

Trois points d'insertion, et trois seulement :

| Fichier:ligne | Rôle | `template_id` ? |
|---|---|---|
| `lib/db/intervention-templates.ts:427` | génération glissante (7 j) — **bulk** | **oui** ← le seul concerné par l'index |
| `lib/db/interventions.ts:315` | `createIntervention` — planification manuelle | non |
| `lib/db/spontaneous-intervention.ts:131` | intervention spontanée (terrain) | non |

Seul le **premier** est protégé (ou non) par l'index. Les deux autres créent des
interventions **ponctuelles**, hors prédicat. `materializeOccurrence` serait un
**quatrième** point d'insertion — et le second à porter un `template_id`.

## 4. La migration proposée (NON CRÉÉE — elle attend ta validation)

```sql
-- 198 — Identité d'une occurrence : deux NULL, c'est le MÊME créneau.
--
-- Constat (PL3-0a, vérifié en base) : l'index unique existant est en
-- NULLS DISTINCT (défaut Postgres). Deux lignes (template, date, NULL) sont
-- donc TOUTES DEUX acceptées — or `slot` EST null pour un rythme sans heure
-- et sans créneau. Le filet anti-course n'en est pas un dans ce cas, et
-- l'idempotence de la future matérialisation à la demande serait FAUSSE.
--
-- Vérifié avant écriture : 0 doublon existant, 0 intervention issue d'un
-- rythme, 0 rythme actif. La reconstruction de l'index est donc SANS RISQUE
-- et ne peut échouer sur aucune donnée.
--
-- Idempotente (rejouée par db-reproducibility.yml). Rollback : recréer
-- l'index sans `nulls not distinct`.

drop index if exists public.idx_interventions_template_unique;

create unique index if not exists idx_interventions_template_unique
  on public.interventions (template_id, scheduled_for, slot)
  nulls not distinct
  where template_id is not null;
```

> `NULLS NOT DISTINCT` est supporté depuis **PostgreSQL 15** ; la base est en
> **17.6**. Aucun souci de version.

### Impact sur les heures précises

**Aucun.** L'index ne porte pas sur l'heure : il porte sur le **créneau dérivé**.
Deux rythmes différents (06:00 et 09:00) ont deux `template_id` différents →
deux clés différentes → **les deux prestations coexistent**, avant comme après.
Mesuré : **0 cas** de même template / même jour / même slot avec des heures
différentes. La migration ne peut donc rien casser de ce côté.

### Impact sur `occurrenceKey`

**Aucun changement de code.** `occurrenceKey` (`lib/planning/projection.ts:233`)
produit déjà `templateId|date|slot` avec `'∅'` pour un slot null — c'est-à-dire
qu'**il traite déjà deux NULL comme identiques**. La migration ne fait
qu'**aligner la base sur ce que le code croit déjà**. Aujourd'hui, les deux
divergent : c'est précisément le bug.

## 5. Les tests attendus (à écrire avec la migration, pas avant)

**Idempotence** (unitaire, pur — passe en CI) :
- deux appels identiques → **une** ligne, deux réponses identiques, `created: false` au second ;
- clé avec `slot = null` → **même** identité (aujourd'hui, non).

**Concurrence** (intégration — vraie base, **hors CI**, à déclarer dans
`tests/integration-tests.ts`) :
- deux `INSERT` simultanés sur la même clé, `slot` **non null** → un gagnant, l'autre
  reçoit `23505` et **relit** la ligne existante ;
- **le même test avec `slot = null`** → aujourd'hui **il échouerait** (deux lignes
  créées). C'est le test qui **prouve le bug**, et qui passera au vert après la
  migration. À écrire **avant** elle.

## 6. Ce que je recommande

Poser la migration **maintenant** : elle est gratuite (0 ligne), elle aligne la
base sur le code, et elle sera **impossible à poser sans risque** le jour où des
rythmes existeront vraiment.

Mais **différer `materializeOccurrence` (PL3-0b)** : il n'a aucun usage tant
qu'aucun rythme n'existe. Le construire maintenant, ce serait bâtir une fondation
sous une maison que personne n'habite.

**Aucune migration n'a été créée. Aucun code n'a été écrit. Ce document attend ta
décision.**
