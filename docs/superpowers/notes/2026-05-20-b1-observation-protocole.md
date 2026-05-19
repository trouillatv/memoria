# B1 — Protocole d'observation réelle (gate B2)

**Date :** 2026-05-20
**Statut :** B1 livré (commit `913a854`), B2 GATÉ — pas de code avant validation des métriques ci-dessous.
**Spec :** [`docs/superpowers/specs/2026-05-20-niveau-b-documents-memoire-relationnelle.md`](../specs/2026-05-20-niveau-b-documents-memoire-relationnelle.md)

---

## Pourquoi ce protocole

B1 est une PoC déterministe lien-fort. Sa valeur n'est pas démontrable en
tests unitaires (qui prouvent la doctrine, pas l'utilité terrain). Avant
toute extension (B2 cross-store), il faut observer en réel :

- **Volume utile** : produit-on des résonances ? trop ? pas assez ?
- **Bruit** : quel taux de `dismissed` ?
- **Plafond atteint** : quels sites saturent /3 ? sur-représentation ?
- **Pertinence subjective** : Vincent juge 5 exemples concrets pertinents
  ou non. C'est le seul critère doctrinal.

---

## 1. Requête SQL de contrôle B1

À coller dans Supabase SQL Editor. Sept blocs indépendants — exécuter
chacun isolément (pas un seul `SELECT` géant).

### 1.1 Cardinalités par algorithme × status

```sql
SELECT
  algorithm_version,
  status,
  COUNT(*) AS n
FROM site_reading_candidates
WHERE algorithm_version LIKE 'b1_doc_%'
GROUP BY algorithm_version, status
ORDER BY algorithm_version, status;
```

**Lecture :** Si `b1_doc_access_v1 / active = 0` ET zéro candidat tout
status confondu après une semaine d'usage normal → filtres trop stricts
OU pas de docs `plan_acces|securite` rattachés à des sites avec
incidents récents. À investiguer (vérifier 1.5).

### 1.2 Sites distincts touchés

```sql
SELECT
  algorithm_version,
  COUNT(DISTINCT site_id) AS sites_touches
FROM site_reading_candidates
WHERE algorithm_version LIKE 'b1_doc_%'
  AND status = 'active'
GROUP BY algorithm_version
ORDER BY algorithm_version;
```

**Lecture :** Concentration vs dispersion. Si 1 site capte tout, B1
n'est pas généralisable (artefact d'une note bavarde / d'un doc unique).

### 1.3 Âge moyen des résonances actives

```sql
SELECT
  algorithm_version,
  ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - generated_at)) / 86400)::numeric, 1)
    AS age_moyen_jours,
  MIN(EXTRACT(EPOCH FROM (NOW() - generated_at)) / 86400)::int AS age_min,
  MAX(EXTRACT(EPOCH FROM (NOW() - generated_at)) / 86400)::int AS age_max
FROM site_reading_candidates
WHERE algorithm_version LIKE 'b1_doc_%'
  AND status = 'active'
GROUP BY algorithm_version;
```

**Lecture :** Si âge moyen → 30j (expires), les résonances vieillissent
sans être ré-générées (signal de stagnation : documents pas relancés).

### 1.4 Sites au plafond /3 (anti-bruit déclenché)

```sql
SELECT
  src.site_id,
  s.name AS site_name,
  COUNT(*) AS n_actives_b1
FROM site_reading_candidates src
LEFT JOIN sites s ON s.id = src.site_id
WHERE src.algorithm_version LIKE 'b1_doc_%'
  AND src.status = 'active'
GROUP BY src.site_id, s.name
HAVING COUNT(*) >= 3
ORDER BY n_actives_b1 DESC, s.name;
```

**Lecture :** Sites où le plafond mord. Si la liste est longue → seuil
/3 trop bas OU notes terrain trop verbeuses produisant beaucoup de
bigrammes faciles.

### 1.5 Taux de dismissed (signal de bruit)

```sql
WITH counts AS (
  SELECT
    algorithm_version,
    SUM((status = 'active')::int)    AS n_active,
    SUM((status = 'stale')::int)     AS n_stale,
    SUM((status = 'dismissed')::int) AS n_dismissed,
    COUNT(*)                         AS n_total
  FROM site_reading_candidates
  WHERE algorithm_version LIKE 'b1_doc_%'
  GROUP BY algorithm_version
)
SELECT
  algorithm_version,
  n_active, n_stale, n_dismissed, n_total,
  ROUND(100.0 * n_dismissed / NULLIF(n_total, 0), 1) AS taux_dismissed_pct
FROM counts
ORDER BY algorithm_version;
```

**Seuils de lecture (proposition, non doctrine) :**
- `< 15 %` dismissed → B1 utile, candidat à B2.
- `15–30 %` → utilité ambiguë, examiner les exemples avant B2.
- `> 30 %` → B1 produit trop de bruit, ne PAS passer à B2 — affiner d'abord.

### 1.6 Échantillon d'exemples concrets pour jugement humain

```sql
SELECT
  src.id,
  src.site_id,
  s.name AS site_name,
  src.algorithm_version,
  src.status,
  src.generated_at,
  src.fragment,
  src.source_ids
FROM site_reading_candidates src
LEFT JOIN sites s ON s.id = src.site_id
WHERE src.algorithm_version LIKE 'b1_doc_%'
ORDER BY src.generated_at DESC
LIMIT 20;
```

**Lecture :** Vincent juge 5–10 fragments. **Critère unique :** "Si on
me montre cette phrase sur la page site, est-ce que je trouve l'écho
juste, ou est-ce que ça parasite ?". Pas de score, pas de note — un
verdict binaire par fragment + commentaire libre.

### 1.7 Vérification défensive : visibility des documents-source

Cette requête confirme qu'**aucune résonance active n'a pour source
primaire un document `admin_only` ou `manager`** (défense en profondeur
déjà appliquée à l'indexation, mais on vérifie qu'aucune n'a fuité).

```sql
SELECT
  src.id AS resonance_id,
  src.algorithm_version,
  d.id AS doc_id,
  d.document_type,
  d.visibility_level
FROM site_reading_candidates src
JOIN documents d ON d.id = (src.source_ids->0->>'id')::uuid
WHERE src.algorithm_version LIKE 'b1_doc_%'
  AND src.status = 'active'
  AND d.visibility_level NOT IN ('operations', 'field');
```

**Lecture attendue : 0 ligne.** Toute ligne = bug doctrinal. À traiter
en P0 avant B2.

---

## 2. Mini-protocole de test réel

Six scénarios, ~30 min total. Exécuter dans cet ordre. Cocher au fur et
à mesure.

### Préalable

- [ ] Site test choisi : ____________________ (ID : ________________)
- [ ] Contrat associé connu
- [ ] Compte manager+ pour upload, compte field pour vérif lecture

### Scénario A — Accès, cas positif

**But :** Vérifier que la règle 1 (plan_acces ↔ incident) produit
une résonance.

1. [ ] Uploader un PDF `plan_acces` (ou `securite`) avec
   `visibility_level='operations'` ou `'field'`.
2. [ ] Lier le doc au site test (document_links target_type='site').
3. [ ] Attendre la fin de l'analyse (`analysis_status='ready'`).
4. [ ] Si pas d'incident d'accès récent sur le site, en créer un via
   l'UI access events (type='incident', date ≤ aujourd'hui).
5. [ ] Réanalyser le doc (bouton "Réanalyser" si l'incident est postérieur).
6. [ ] Ouvrir `/sites/[id]` : la section "Résonances" doit afficher
   *"Le plan d'accès rattaché [doc:…] documente l'accès du site — un
   incident d'accès a été signalé le …"*.

**Critère succès :** 1 résonance B1 visible, fragment cite `[doc:id]`,
date de l'incident correcte.

### Scénario B — Procédure, cas positif

**But :** Vérifier que la règle 2 (procedure ↔ bigramme note) produit
une résonance.

1. [ ] Uploader un PDF `procedure` (ou `protocole`) avec
   `visibility_level='operations'`. Le texte doit contenir une
   expression de 2 mots métier (ex. "PC sécurité", "couloir principal",
   "salle blanche").
2. [ ] Lier au site test.
3. [ ] Attendre `analysis_status='ready'`.
4. [ ] Créer une note terrain (`a_savoir` ou `note`) sur le site,
   contenant la même expression (ex. *"Hier le PC sécurité ne
   répondait pas"*).
5. [ ] Réanalyser le doc.
6. [ ] Ouvrir `/sites/[id]` : section "Résonances" doit afficher *"La
   procédure rattachée [doc:…] mentionne « pc securite » — une note
   terrain du … cite ce terme."*.

**Critère succès :** 1 résonance B1 visible, le bigramme cité est bien
celui partagé (lowercased + sans diacritiques — normal, c'est le
matching qui s'affiche).

### Scénario C — Juridique, cas négatif (filtre type)

**But :** Vérifier que les types juridiques n'entrent JAMAIS dans B1.

1. [ ] Uploader un PDF `avenant` (ou `contrat`, `litige`, `facture`)
   avec n'importe quelle visibilité.
2. [ ] Lier au site test (même site que A/B).
3. [ ] Attendre `analysis_status='ready'`.
4. [ ] Ouvrir `/sites/[id]`.

**Critère succès :** AUCUNE résonance issue de ce doc. Le filtre type
exclut d'office. Vérifier en SQL :
```sql
SELECT * FROM site_reading_candidates
WHERE algorithm_version LIKE 'b1_doc_%'
  AND source_ids->0->>'id' = 'ID_DU_DOC_AVENANT';
-- attendu : 0 ligne
```

### Scénario D — admin_only, cas négatif (filtre visibility)

**But :** Vérifier le verrou visibility (défense en profondeur).

1. [ ] Uploader un PDF `procedure` avec `visibility_level='admin_only'`
   (ou `'manager'`).
2. [ ] Lier au site test.
3. [ ] Créer une note partageant un bigramme (comme Scénario B).
4. [ ] Réanalyser.

**Critère succès :** AUCUNE résonance. Vérifier en SQL via la
requête 1.7 (doit rester à 0 ligne).

### Scénario E — Dismiss + audit

**But :** Vérifier le geste humain dans la boucle.

1. [ ] À partir d'une résonance produite en A ou B, déclencher
   `dismissResonanceAction` (depuis l'UI si bouton présent, sinon via
   appel direct Server Action ou requête manuelle).
2. [ ] Vérifier en SQL :
   ```sql
   SELECT id, status FROM site_reading_candidates WHERE id = 'ID_RESONANCE';
   -- attendu : status='dismissed'
   ```
3. [ ] Vérifier la trace d'audit :
   ```sql
   SELECT * FROM activity_logs
   WHERE entity_type = 'site'
     AND action = 'updated'
     AND metadata->>'kind' = 'resonance_dismissed'
   ORDER BY created_at DESC LIMIT 5;
   ```
4. [ ] Rafraîchir `/sites/[id]` : la résonance dismissed ne s'affiche
   plus (cohérent SiteReadingsList lit `status='active'`).

**Critère succès :** statut basculé + ligne d'audit avec
`candidate_id`, `reading_type='resonance'`, `algorithm_version='b1_doc_*'`.

### Scénario F — Idempotence

**But :** Vérifier que ré-analyser un même doc ne crée pas de doublons.

1. [ ] Repartir d'un état après Scénario A (1 résonance active).
2. [ ] Cliquer "Réanalyser" sur le doc.
3. [ ] Attendre `analysis_status='ready'`.
4. [ ] Compter :
   ```sql
   SELECT status, COUNT(*)
   FROM site_reading_candidates
   WHERE site_id = 'ID_SITE'
     AND algorithm_version LIKE 'b1_doc_%'
     AND source_ids->0->>'id' = 'ID_DOC'
   GROUP BY status;
   ```

**Critère succès :** Au plus 1 ligne `active` par (site, doc, algo).
Les anciennes basculent en `stale`.

---

## 3. Gate B2 — critères d'acceptation

**B2 (cross-store cosine documents ↔ traces site) n'est pas codé tant que
TOUTES ces conditions ne sont pas satisfaites :**

1. **Volume non vide.** Au moins **10 résonances B1 actives** produites
   en conditions réelles, sur au moins **3 sites distincts**.
   *Source : requêtes 1.1 + 1.2.*

2. **Bruit acceptable.** Taux de `dismissed` < **30 %** sur les
   résonances jugées (Scénario E répété en réel).
   *Source : requête 1.5.*

3. **Pertinence jugée par humain.** Vincent juge **≥ 60 %** des
   fragments de l'échantillon 1.6 comme "écho juste" (verdict binaire).
   Les fragments rejetés sont collés ici avec leur motif :

   ```
   - [fragment dismissed 1] — motif :
   - [fragment dismissed 2] — motif :
   - ...
   ```

4. **Aucune fuite de visibilité.** Requête 1.7 reste à **0 ligne** sur
   toute la période d'observation.

5. **Plafond /3 examiné.** Si ≥ 5 sites atteignent /3 (requête 1.4),
   re-discuter le seuil AVANT B2 (raffinement Vincent : plafond peut
   bouger, doctrine non).

**Si une condition échoue → on n'écrit pas une ligne de B2.** On
re-discute B1 d'abord : filtres, types, visibility, plafond. La
discipline "ouvertures payantes" (cf. memoire `doctrine-openings-pay-cost`)
s'applique aussi à l'amplification d'un PoC.

---

## 4. Journal d'observation (à remplir au fil de l'eau)

```
Date | Site | Scénario | Résultat attendu | Résultat observé | Commentaire
-----|------|----------|------------------|------------------|------------
     |      |          |                  |                  |
```

---

## 5. Ce que ce protocole NE fait PAS

- Pas de benchmark IA, pas de mesure de latence (B1 est déterministe,
  pas d'enjeu coût).
- Pas de comparaison vs un baseline « sans résonance » (B1 est additif,
  zéro régression possible — déjà prouvée par baseline tests).
- Pas de mesure satisfaction utilisateur quantitative (verdict humain
  binaire suffit en α — pas de NPS, pas d'enquête).
- **Pas de proposition B2 dans ce document.** B2 reste à étudier le
  jour où le gate ci-dessus est passé.
