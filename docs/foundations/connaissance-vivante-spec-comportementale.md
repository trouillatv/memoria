# Connaissance vivante — spec **comportementale** (draft)

> **Statut** : draft de réflexion, 2026-06-30. **Comportement gelé, nom NON gelé.**
> Ce document décrit *ce que fait* l'objet, pas comment le coder. Pas de schéma SQL
> exhaustif, pas d'API. Aucune ligne de code n'est engagée : gated post-pilote,
> validation « écho juste » sur une vraie visite avant toute implémentation.
>
> **Nom (provisoire)** : on parle de « connaissance vivante » dans l'UX et les docs.
> Le **support physique reste `captured_knowledge`** (mig 170) — pas de rename SQL
> tant qu'il ne se mérite pas (churn interne, l'utilisateur ne voit jamais le nom).

**Cœur du modèle :**

```
connaissance vivante  =  captured_knowledge (le support, l'identité durable)
                       +  revision_events    (la trajectoire : comment elle a évolué)
```

L'identifiant ne change **jamais** pendant toute la vie de l'objet. Ce qui change,
c'est son **état** et la **nature** qu'on lui comprend — et chaque changement laisse
une trace dans son journal.

---

## 1. Qu'est-ce qu'une connaissance vivante ?

Une **unité de connaissance opérationnelle** qui *vit* : elle naît d'une observation
terrain, accumule des preuves, change de nature à mesure que la compréhension
progresse, peut engendrer des objets métier (action / réserve / décision…) **sans les
remplacer**, et reste **traçable jusqu'à sa clôture**.

Ce n'est pas un fait figé ni un résumé. C'est une **croyance qui évolue** — et dont on
garde le **chemin**, pas seulement le point d'arrivée. Sa valeur n'est pas « le
résultat » mais « ce qu'on a cru, sur quelles preuves, et comment ça a changé ».

**Elle décrit le CHANTIER, jamais une personne.** Pas « Guillaume était inquiet » mais
« ce point présente une incertitude / une contrainte / un risque ». Neutralité par
construction (cf. garde-fou plus bas).

**Ce que ce n'est PAS :**
- pas un *god-objet* qui avale réserve / action / décision (ils restent typés et
  auditables — c'est le moat de preuve) ;
- pas une courbe de confiance continue (illisible) — on garde les **inflexions
  saillantes**, pas chaque micro-variation ;
- pas un score de confiance *déclaré* (« 82 % ») — la confiance s'**exhibe en
  fondements** (combien de preuves, observé vs inféré) ;
- pas de l'IA temps réel pendant la visite (capture d'abord, réflexion ensuite).

---

## 2. Comment elle naît ?

Toujours **avec au moins une preuve reliée**. Jamais d'orphelin.

Deux origines, **distinctes et marquées** (la provenance compte) :

| Origine | Déclencheur | Confiance initiale |
|---|---|---|
| **Flaggée par l'humain** | ⭐ « important » / ❓ « à vérifier » sur le terrain | haute (l'humain a dirigé son faisceau) |
| **Détectée par le système** | signal déterministe (état fragile, récurrence, contradiction…) | à confirmer |

À la naissance, l'état est **`émergente`** : *« quelque chose mérite l'attention »* —
rien de plus. On ne lui force pas une nature (risque ? réserve ?) tout de suite.

---

## 3. Comment elle évolue ?

Par **événements de révision saillants** (`revision_events`), append-only. Chaque
événement enregistre : le **nouvel état**, la **ou les preuves** qui le motivent, la
**provenance** (humain / système), une **note** optionnelle, l'**horodatage**.

États possibles :

```
émergente → renforcée → confirmée
        ↘ remise en question → abandonnée
        ↘ transformée (→ engendre un objet métier)
        ↘ résolue (clarifiée, plus rien à suivre)
```

- **émergente** : on commence à croire qu'il y a quelque chose.
- **renforcée** : une nouvelle preuve va dans le même sens.
- **remise en question** : une preuve la contredit.
- **abandonnée** : l'hypothèse tombe (« ce n'était pas la toiture »).
- **confirmée** : la nature est établie.
- **transformée** : elle engendre un objet métier typé (voir §4).
- **résolue** : clarifiée, plus rien à suivre (le BET a envoyé les plans).

Les transitions sont **réversibles** et **datées**. Le récit lisible (« en avril on
pensait la toiture, abandonné après ouverture des plafonds, cause réelle = chéneau »)
est une **projection du journal** — voir la règle majeure.

---

## 4. Comment elle se relie aux preuves et aux objets métier ?

**Vers les preuves (amont)** — *link-preserving* : chaque état et chaque révision
pointe vers les captures qui le justifient (photos, vocaux, notes, plan, réponse
d'entreprise…). On peut toujours remonter de l'affirmation à la preuve.

**Vers les objets métier (aval)** — *gravitation, pas absorption* : la connaissance
vivante est le **fil** ; action / réserve / décision sont des **perles** enfilées
dessus.
- L'objet typé engendré porte un **pointeur vers sa connaissance d'origine**.
- La connaissance garde dans son journal **ce qu'elle est devenue** (« transformée en
  réserve R-12 le 14/04 »).
- L'objet typé **garde son identité propre** (la réserve reste une réserve
  contractuelle, auditable). La connaissance ne le remplace pas.

C'est ça la trace rare : *« ce qui méritait l'attention → ce que c'est devenu »*.

---

## 5. Qui a le droit de confirmer / abandonner / transformer ?

> **Le système peut PROPOSER. L'humain CONFIRME les actes conséquents.**

| Acte | Système (autonome) | Humain (requis) |
|---|:---:|:---:|
| Créer une connaissance émergente (depuis ⭐/❓ ou signal) | ✅ | — |
| Renforcer (preuve qui va dans le même sens) | ✅ (réversible) | — |
| Proposer une nature inférée (« semble un risque ») | ✅ (interne, réversible) | — |
| Signaler une contradiction (remise en question) | ✅ (propose) | — |
| **Abandonner** une hypothèse | propose | ✅ confirme |
| **Confirmer** la nature | propose | ✅ confirme |
| **Transformer** en objet contractuel (réserve / décision) | propose | ✅ **confirme** |

Principe : la **dérive de nature inférée** est libre, interne, réversible (pas cher).
La **promotion en objet à poids juridique** (réserve, décision) est un **acte humain**,
jamais un flip LLM silencieux. Dans la trajectoire, « cru par le système » et « tranché
par l'humain » restent **distincts**.

---

## Règle majeure

```
Le système peut proposer.
L'humain confirme.
Le récit ne s'invente jamais : il RACONTE le journal.
```

Le récit (« on pensait… puis abandonné… ») est une **projection** des
`revision_events` : chaque phrase remonte à un événement enregistré et relié à sa
preuve. Le LLM **narre** le journal ; il ne **fabrique** pas le raisonnement. Une
fausse trajectoire *cohérente* serait plus dangereuse qu'un fait faux — d'où ce
verrou.

## Garde-fou (non négociable)

```
Pas de psychologie.
Jamais « Guillaume était inquiet ».
Toujours « ce point présente une incertitude / contrainte / risque ».
```

Le sujet est le **lieu / l'ouvrage / le point** — jamais l'état mental d'une personne.
La neutralité est **dans l'objet**, pas seulement dans le wording.

---

## Mapping sur `captured_knowledge` — le déjà-là vs le à-construire

| Comportement attendu | Déjà dans `captured_knowledge` (mig 170) | À construire |
|---|---|---|
| Primitive **neutre**, qualifiée par `kind` extensible | ✅ | — |
| **Reliée** (site / sujet / action / zone) + `source_capture_ids` | ✅ | — |
| Cycle de vie | partiel : `active / resolved / obsolete / dismissed` | jeu d'états enrichi (émergente / renforcée / remise en question / abandonnée / transformée…) |
| **Trajectoire** (comment elle a évolué) | ❌ | `revision_events` (append-only, preuve + provenance par événement) |
| Lien-retour depuis l'objet typé engendré | ❌ (la matérialisation existe, le pointeur retour non) | pointeur réserve/action/décision → connaissance d'origine |
| Provenance **humain vs système** par révision | ❌ | champ de provenance sur l'événement |
| Récit = projection du journal | ❌ | générateur de récit borné au journal |

Conclusion : on **muscle une primitive existante**, on ne crée pas de table-univers.

---

## Porte de validation (avant tout code)

Test **écho juste** sur **une seule vraie visite** déjà captée : les connaissances
vivantes remontées — et leur **trajectoire** — correspondent-elles à ce qui a
réellement compté et évolué pendant la visite ? Jugé par ≥ 2 personnes (gate « test
humain de compréhension »).

- ✅ → on industrialise (`revision_events`, projection du récit, promotions humaines).
- ❌ (mé-groupe / invente une trajectoire) → on l'apprend sur un proto d'un jour, pas
  sur six mois de pipeline.

**Rien n'est codé avant le feu vert.** L'hypothèse risquée n'est pas la plomberie,
c'est la **justesse de la compréhension**.
