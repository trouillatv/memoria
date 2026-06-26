# Visites terrain — la session orientée objectif

> **Cadrage validé 2026-06-26 (Vincent, 9,7/10).** Base de travail figée pour le sprint
> « Visites terrain ». **Aucun code fonctionnel n'est écrit tant que ce document n'est pas
> stabilisé.** Cette brique est structurante : elle touche `site_reports`, `interventions`,
> le mobile, les sujets, réserves, obligations, preuves, le briefing, et les futurs QR /
> GPS / tokens externes. Elle mérite une trace stable plutôt qu'une conversation.
>
> ⚠️ **Invariant cardinal à tenir pendant TOUTE l'implémentation** : une visite qualifie
> un **lieu / un ouvrage / un sujet**, JAMAIS une personne ni une entreprise. Tout agrégat,
> résultat ou statistique qui se rattache à un individu est un **score RH déguisé** et est
> interdit. C'est cette frontière qui garde la feature du bon côté de la
> [doctrine RH](../../foundations/doctrine-rh.md) et du [refus ERP/pointage/GPS].

---

## Ce que devient le produit — la définition

> **Principe central — une visite ne sert pas à produire un document. Elle sert à faire
> progresser la mémoire du chantier. Le document n'est qu'une conséquence éventuelle.**
>
> C'est cette phrase qui explique tout le reste : pourquoi le PV est optionnel, pourquoi une
> visite peut ne produire qu'une photo ou un vocal, pourquoi le **sujet** compte plus que le
> rapport. C'est devenu la philosophie centrale de MemorIA.

MemorIA n'est plus centré sur la **Réunion**. Il devient centré sur l'**événement terrain**,
dont la réunion et la visite ne sont que deux **motifs**. La phrase qui résume le pivot :

> **MemorIA = assistant de terrain, pas seulement générateur de comptes-rendus.**

Une visite n'est pas un timestamp. C'est une **session de travail terrain orientée
objectif** : elle a un **début** (une intention), un **déroulé** (des captures et des
objets produits) et une **fin** (un résultat et une capitalisation).

```
INTENTION              DÉROULÉ                  CRISTALLISATION
objectif + cible  →  briefing ciblé        →  résultat  →  artefact(s)
   (→ sujet)         prepare(scope)            (1 clic)     CR | preuve | rien
                     captures / objets
```

---

## 0. Décision d'architecture — un concept, deux moteurs

**On ne crée pas de troisième objet.** Il existe déjà deux moteurs de « session » et ils
ne se recouvrent pas :

| | `interventions` | `site_reports` |
|---|---|---|
| Rattachement | `mission_id` → mission (recette) | `site_id` directement |
| Centre de gravité | **preuve** : checklist, photos, validation signée par token | **mémoire** : audio/photo/texte → IA → propositions → curation |
| Produit | items cochés, preuves horodatées, signature | actions, décisions, sujets, anomalies, **et** le PV |
| Crée des objets de mémoire | non | oui (sa raison d'être) |

La « visite spontanée » décrite par le terrain (j'arrive, je prends des photos + un vocal,
je crée une réserve / action / décision, à la fin je choisis si je génère un CR) **est
déjà, à 80 %, un `site_report`**. Forcer tout dans `interventions` reconstruirait
`site_reports` à l'intérieur d'`interventions`. Créer un `field_sessions` neuf créerait un
silo par-dessus deux moteurs qui marchent.

**Règle retenue :**

- **Côté utilisateur : un seul mot, « Visite ».** Un seul bouton, un seul flux mental
  (*je démarre → je fais → je clôture*). « Intervention » évoque l'exécution de travaux
  (artisan, entreprise) ; un maître d'œuvre (BECIB) **visite, contrôle, réunit, réceptionne**.
- **Côté moteur : le MOTIF route vers le moteur existant adapté.**

```
Motif de la visite
│
├─ Contrôle / Inspection / Avancement / Réunion / Constat / Expertise / Visite libre
│     └──> moteur site_reports   (capture → mémoire → CR optionnel)
│
└─ Levée de réserves / Réception / Maintenance
      └──> rail intervention      (preuve, checklist, validation signée par token)
```

`site_reports` est **généralisé** : il passe de « compte-rendu de réunion » à « session
terrain dont le PV n'est qu'**une** sortie possible ». L'intervention planifiée reste le
rail preuve et peut être **rattachée** à une visite quand une signature est requise.

> **`field_sessions` (table parapluie dédiée) = repli explicite, NON construit.** Seul
> déclencheur qui le justifierait un jour : un besoin prouvé de visites **multi-jours** ou
> **multi-artefacts**. On ne l'anticipe pas (anti-surconstruction).

---

## 1. Définition d'une visite

> Une **Visite** est un événement horodaté et situé pendant lequel une personne capture
> de la matière brute et la transforme — éventuellement — en objets de mémoire et en
> documents, **au service d'un objectif explicite**.

- **vs Intervention** : l'intervention *exécute une recette planifiée* (mission) et produit
  une *preuve*. La visite *observe un état* et produit de la *mémoire*. L'intervention peut
  être le bras armé d'une visite (levée de réserves signée), pas l'inverse.
- **Origine** = métadonnée, pas un type : `planifiée | spontanée | qr | gps`. L'origine ne
  change ni les écrans ni les permissions, seulement *comment on est entré*.
- **Motif** = le vrai pivot : il détermine le briefing, la checklist, les champs et le
  document de sortie. La checklist n'est **pas configurée**, elle est **déduite du motif**.

---

## 2. L'intention — objectif + cible au démarrage

Avant le briefing, deux questions courtes.

### 2.1 Objectif — un objet mémoire de premier rang
« Pourquoi venez-vous ? » → motif, puis un champ libre court (« contrôler les enrobés »).
**L'objectif n'est pas une étiquette de session : il se rattache à un sujet.**

> « Contrôler les enrobés » → la visite se relie au **sujet** *Enrobés* (`subjects`, mig124).
> Six mois après, la question n'est plus « visite du 12 juin » mais
> « les 4 fois où on est venu pour les enrobés ». **La continuité est portée par le sujet,
> la visite n'en est qu'un jalon.** (cf. doctrine Vue Sujet.)

### 2.2 Cible — « que venez-vous voir ? » (LE différenciateur)
La cible transforme le briefing générique en briefing **ciblé**, et la brique technique
existe déjà : `getSubjectTimeline` (mig143) reconstitue l'historique daté/situé d'un sujet.

```
Je viens voir : ○ Enrobés
        ↓
Enrobés — 3 décisions · 2 actions · 1 réserve · 4 photos · 1 obligation
⚠ température de pose jamais relevée
```

Cibles possibles : `subject | action | reserve | obligation | zone | free`. Aucune table
neuve : on réutilise les objets existants.

---

## 3. Le moteur générique `prepare(scope)` — 1 source, N surfaces

> Le moteur de préparation est **toujours le même**, seule la **présentation** change.

```
prepare(scope) → signaux  (lib/db/site-memory-signals.ts, 100 % déterministe, zéro LLM)
   scope = { site }              → briefing chantier (visite libre)
   scope = { site, motive }      → briefing par motif (contrôle, réception…)
   scope = { site, subject }     → briefing ciblé (« que venez-vous voir »)
   scope = { site, date }        → briefing du soir (déjà livré)
```

« Préparer la réunion », « préparer la réception », « préparer le contrôle » ne sont pas
N features : ce sont N **scopes** du même moteur. Chaque nouveau « préparer X » est une
**ligne de config, pas un module** — c'est ce qui empêche l'usine à gaz. Les 5 briques du
« plan de visite » (À contrôler / À vérifier / À revoir / À photographier / À discuter)
sont exactement les détecteurs déterministes de `site-memory-signals` réordonnés par scope.

---

## 4. Le déroulé — captures (existant, inchangé)

Pendant la visite : photo / note / vocal / réserve / action / décision — **exactement les
surfaces de capture actuelles** de `site_reports`, filtrées par permission (§7). Aucune
nouvelle surface. Captures stockées via `site_report_attachments` (audio/photo/file, déjà
idempotent via `client_uuid`). Les objets de mémoire restent rattachés au **`site_id`** et
**citent** le report d'origine via `report_id` (la mémoire survit à la session).

---

## 5. La cristallisation — résultat + gravité + artefact

### 5.1 Résultat global (`outcome`) — au MVP, 1 clic, qualifie le lieu
À la clôture, une question simple et optionnelle :

```
Résultat de la visite :
○ RAS
○ Conforme
○ Conforme avec réserves
○ Non conforme
○ À revoir
○ Information uniquement
```

**Invariant dur (CI) :** le résultat qualifie **la zone / l'ouvrage / le sujet**, jamais
la personne ni l'entreprise.
- ❌ « Guillaume fait 80 % de visites conformes » → score de performance = RH déguisé.
- ✅ « Zone nord : dernière visite = conforme avec réserves » → état du lieu, légitime.

### 5.2 Gravité (`severity`) — DÉRIVÉE, jamais demandée
On ne demande pas à l'utilisateur de classer chaque visite (friction + cran vers
l'anxiogène = « mort par surconstruction »). **MemorIA déduit, l'utilisateur agit.**

```
réserve bloquante produite  → gravité haute
anomalie ouverte            → surveillance
aucun problème              → RAS
« urgence » (seul cas saisi manuellement, rare, justifié) → urgence
```

Seule « urgence » est déclarable à la main, parce qu'elle doit pouvoir court-circuiter le
briefing du lendemain.

### 5.3 Résolution — l'affaire est-elle close ? (distincte du résultat)
Une visite peut être **terminée** sans que le **sujet** soit résolu (« je constate un
problème, j'attends les essais, je repars sans pouvoir conclure »). La résolution est un axe
**orthogonal** à l'`outcome` (état de l'ouvrage) et au statut de visite (§6) :

```
La cible / l'objectif est-il traité ?
○ Résolue
○ À suivre
○ Recontrôle nécessaire
```

- Affichée **seulement** si la visite avait un objectif / une cible (sinon on ne la demande
  pas — discipline d'apparition). 1 clic, optionnelle.
- **Qualifie le sujet / la cible, jamais la personne** (même invariant que l'outcome).
- **Elle nourrit la suite** : `recontrôle nécessaire` → pré-remplit la prochaine visite
  (§5.4) et garde le sujet ouvert ; `résolue` → propose de clore le sujet ; `à suivre` → le
  sujet reste ouvert, sans visite forcée.

### 5.4 Artefact + suite — aiguillage, pas une fin
```
Que voulez-vous faire ?
○ Rien (trace seule, reste interrogeable)
○ Générer une fiche visite
○ Générer un compte-rendu (PV)
○ Créer des actions
○ Programmer une nouvelle visite       ← pré-remplie si « recontrôle nécessaire »
○ Créer une réunion
○ Ajouter au journal du chantier
```

**Le PV n'est pas obligatoire.** « Rien » est un état de clôture légitime. La clôture est un
**aiguillage** : le moment de cristalliser un artefact ET/OU d'amorcer la suite (prochaine
visite / réunion / action) — Guillaume ne pense pas « je fais un rapport », il pense « je
reviendrai mardi ». Une visite programmée réutilise le rail planning existant et réapparaît
dans « Visites planifiées ». Réutilise les pipelines existants (génération CR = pipeline
`site_reports` ; validation signée = pipeline `intervention_tokens`).

---

## 6. Cycle de vie

```
ouverte ──> en_cours ──> clôturée ──┬─> (CR généré)      site_report curated
                                    ├─> (preuve validée) intervention validated
                                    └─> (rien)           trace seule, archivée
        └─> abandonnée (timeout sans capture)
```

Chaque étage de la boucle doit **gagner sa place au test 4 questions** (incertitude réelle /
erreur si absent / action concrète / rareté). Objectif (oui), cible (oui), captures (oui,
existant), résultat (oui, 1 clic), capitalisation/apprentissage (**différé**, cf. §9).

**Deux axes orthogonaux à ne pas confondre** : le *statut de la visite* (ouverte → clôturée)
et la *résolution de l'affaire* (le sujet/la cible est-il clos ?, cf. §5.3). Une visite peut
être **terminée** alors que le sujet ne l'est pas. Le statut décrit la session ; la
résolution décrit le sujet — et c'est la résolution qui alimente la suite (prochaine visite,
clôture de sujet), pas le statut.

---

## 7. Permissions — on ne bloque pas l'entrée, on borne l'intérieur

Tous les rôles **peuvent démarrer** une visite ; ce sont les **objets créables pendant**
qui sont gated.

- **Authentifiés** (admin / manager / chef_equipe) : via les RLS existantes
  (`current_user_role`, `current_user_org_id`).
- **Externes sans compte** (sous-traitant, contrôleur technique, expert) : via un **token
  de visite** — on généralise `intervention_tokens` (permissions `['read','comment',
  'validate']`) au `kind='visit'`. Un sous-traitant peut *photographier + cocher + dire
  « terminé »*, mais **pas** créer une décision ni clôturer le chantier. Garde-fou
  **serveur** non négociable (pattern existant `app/i/[token]/actions-public.ts`).
- **Client** : mode très restreint (photos + remarques), opt-in org.

---

## 8. Modèle de données

Aucune nouvelle table dans la version retenue — on étend `site_reports` :

```sql
-- migration 162 (le plus récent dispo = 161)
alter table site_reports
  add column kind          text default 'meeting',  -- 'meeting' | 'visit'
  add column visit_motive  text,                     -- cf. §10 (null pour 'meeting')
  add column origin        text,                      -- planned | spontaneous | qr | gps
  add column objective     text,                      -- "contrôler les enrobés"
  add column target_kind   text,                      -- subject|action|reserve|obligation|zone|free
  add column target_id     uuid,                       -- polymorphe (null si free / zone libre)
  add column outcome       text,                       -- RAS|conforme|avec_reserves|non_conforme|a_revoir|info
  add column severity      text,                        -- DÉRIVÉ au close (cache) ; 'urgence' seul saisi
  add column resolution    text,                        -- resolue|a_suivre|recontrole (si objectif/cible) — qualifie le SUJET
  add column started_at    timestamptz,
  add column ended_at      timestamptz,
  add column captured_lat  double precision,             -- one-shot opt-in, JAMAIS re-suivi
  add column captured_lng  double precision,
  add column linked_intervention_id uuid references interventions(id),  -- rail preuve
  add column author_role   text;                          -- producteur|porteur|consommateur (mémoire, PAS un score)
```

- `objective` + `target_kind='subject'` renseigne aussi `subject_id` (déjà prévu côté report).
- `target_id` réutilise les objets existants (`subjects`, `site_actions`, `site_reserve`,
  `site_obligation`). La « zone » reste du texte libre au MVP (`target_kind='zone'`,
  `target_id` null) — à formaliser plus tard si l'usage le réclame.
- `captured_lat/lng` = instantané opt-in **au démarrage**, jamais un suivi (cf. §11).

---

## 9. Apprentissage — explicitement différé (gated volume)

La comparaison **objectif ↔ résultat** → apprentissage des visites récurrentes →
recommandations futures est juste, mais c'est le territoire **intelligence
cross-chantier / apparition adaptative** déjà gelé jusqu'au volume réel. On ne le code pas.
Garde-fou posé dès maintenant pour qu'il reste codable sans dette :

- l'apprentissage se fait sur **sujets / motifs / zones**, JAMAIS sur **personnes** ;
- gated par **volume** (post-pilote), pas par anticipation.

`objective` et `outcome` sont stockés dès le MVP **pour que la donnée existe** quand on
pourra l'exploiter — mais on n'exploite rien avant.

---

## 10. Motifs — paramétrables par org (doctrine multi-métier)

Liste universelle (verbes métier, cross-secteur VRD / bâtiment / industrie / maintenance /
énergie) :

```
Inspection · Contrôle · Réunion · Avancement · Réception ·
Levée de réserves · Constat · Expertise · Maintenance · Visite libre
```

Implémentée comme **catalogue système + override org** (pattern `industry_template +
org_catalog` de la mémoire adressable). Un métier ajoute « ronde de sécurité » ou « relevé »
sans toucher au code. **On fige le mécanisme, pas la liste.** Le motif porte aussi le
routage moteur (§0) : `Maintenance`, `Réception`, `Levée de réserves` → rail intervention ;
les autres → `site_reports`.

### Comportement par motif (table déterministe, zéro IA)

| Motif | Briefing (scope) | Sortie par défaut | Rail |
|---|---|---|---|
| Contrôle / Inspection | réserves + actions retard + obligations + journal photo | CR léger ou rien | report |
| Avancement | dernières photos, sujets chauds | journal photo + CR | report |
| Réunion | participants, ordre du jour, décisions/actions ouvertes | PV | report |
| Levée de réserves | réserves ouvertes (photo avant/après) | preuve signée | **intervention** |
| Réception | DOE, contrôles, PV réception, réserves finales | preuve signée | **intervention** |
| Maintenance | équipements, obligations récurrentes | preuve / fiche | **intervention** |
| Constat / Expertise | historique, photos datées | fiche constat | report |
| Visite libre | briefing complet condensé | au choix | report |

---

## 11. Les trois moments UX + origines

**Ouverture** — objectif + cible, puis le briefing s'affiche **avant** la première capture
(`prepare(scope)` filtré par motif/cible).

**Pendant** — surfaces de capture existantes, filtrées par permission.

**Clôture** — résultat (1 clic) + aiguillage artefact (§5).

**Origines** (cran 2, sauf « spontanée ») :
- **Planifiée** : pré-remplit si une visite/intervention était prévue ce jour pour ce site.
- **Spontanée** : choix manuel du chantier (**seule origine du MVP**).
- **GPS** : `< 150 m` d'un site (lat/lng déjà sur `sites`) → « Démarrer une visite ici ? ».
  **One-shot, opt-in, jamais stocké en continu.**
- **QR** : scan d'un QR site/ouvrage → ouvre la visite avec scope pré-rempli.

Page d'accueil cible : « ▶ Démarrer une visite » en bouton principal, puis *Visites
planifiées / Chantiers proches / Alertes / Briefings*. Remplace le titre « Interventions du
jour » (`app/(dashboard)/aujourdhui/page.tsx`). **Ne pas supprimer** la vue planifiée — la
déclasser sous le bouton principal.

---

## 12. Garde-fous CI (doctrine « ouvertures payantes » — livrés dans le même changement)

1. **Résultat / apprentissage qualifient un lieu, jamais une personne** — test interdisant
   tout agrégat `outcome` / récurrence rattaché à un individu ou une entreprise.
2. **`captured_lat/lng`** — usage borné à « proposer le site à l'ouverture ». Aucun
   historique de positions, aucune durée-de-présence exploitée (= pointage déguisé).
   Test 4 questions « est-ce RH déguisé ? » à passer.
3. **Gravité dérivée** — pas de sélecteur de gravité imposé ; seule « urgence » est saisie.
4. **Discipline d'apparition** — le briefing d'ouverture passe le test 4 questions ou ne
   s'affiche pas.
5. **`author_role`** sert la mémoire (qui a observé), pas un score.

---

## 13. Phasage

- **MVP (1 sprint)** : `kind/visit_motive/origin/objective/target/outcome/severity(dérivée)/
  resolution/started_at/ended_at` sur `site_reports` ; bouton « Démarrer une visite » +
  objectif + cible ; briefing ciblé `prepare(scope)` ; clôture-aiguillage avec **résolution**
  + « programmer une nouvelle visite ». **Origine spontanée seule.**
  Pas de GPS, pas de QR, pas de token externe nouveau. → C'est presque tout du réassemblage
  d'existant ; le différenciateur (briefing ciblé par sujet) est dans ce périmètre.
- **Cran 2 (gated usage)** : GPS one-shot + QR ; token de visite externe ; rail intervention
  pour réserves / réception / maintenance.
- **Différé (gated volume, jamais par personne)** : comparaison objectif ↔ résultat,
  apprentissage récurrence, recommandations.

---

## 14. Ce que l'on ne fait PAS

- Créer `field_sessions` maintenant (silo, anti-ERP).
- Forcer la visite dans `interventions` (reconstruit `site_reports`).
- Rendre le PV obligatoire à la clôture.
- Demander la gravité à chaque visite (on la dérive).
- Toucher au GPS au-delà du one-shot opt-in.
- Exploiter objectif/résultat avant d'avoir le volume réel.

---

## 15. Les trois invariants qui tiennent la ligne

Le pivot « événement → session orientée objectif » est juste, mais le même mouvement, poussé
d'un cran de trop, fait basculer vers la « mort par surconstruction ». La feature reste du
bon côté **si et seulement si** :

1. **Tout ce qui peut être dérivé n'est pas demandé** (gravité).
2. **Tout résultat qualifie un lieu, jamais une personne** (frontière anti-RH, CI).
3. **L'intelligence sur les visites est gated par le volume réel, pas anticipée**
   (apprentissage différé).

---

## 16. Document compagnon (fonctionnel)

Ce cadrage est **technique** (porté par les développeurs). Sa contrepartie **fonctionnelle**
— 10 scénarios réels Guillaume/Émeline, sans jargon — vit dans
[`2026-06-26-visites-terrain-scenarios.md`](../scenarios/2026-06-26-visites-terrain-scenarios.md).
Ce sont les scénarios qui révèlent les derniers détails ergonomiques qu'une spec ne fait pas
apparaître. **La brique n'est considérée « figée » qu'après leur passage** — c'est le dernier
gate avant développement.
