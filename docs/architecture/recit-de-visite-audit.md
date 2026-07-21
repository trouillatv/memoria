# Audit d'architecture fonctionnelle — la Visite comme récit vérifiable

> Commandé par Vincent, 2026-07-21. **Aucun code n'a été écrit pour cet audit.**
> Tout ce qui suit est lu dans le dépôt : les tables, les colonnes et les
> read-models cités existent aux emplacements indiqués.

---

## 0. Le constat qui commande tout le reste

Le produit mêle **Visite**, **Compte-rendu** et **Chantier**. Ce n'est pas un
accident : historiquement, la visite *servait à produire* le chantier. Elle en
était le formulaire d'entrée. MemorIA est devenu un moteur d'analyse ; la visite
doit maintenant exister pour elle-même.

Le diagnostic technique de cet audit tient en une phrase :

> **La provenance existe déjà en base. Aucun read-model ne s'en sert pour
> raconter ce qu'une visite a produit.**

Ce n'est donc pas un chantier de modèle de données. C'est un chantier de
**lecture**.

---

## 1. Cartographie des objets métier

Quatre natures, pas trois. Chacune a sa table et son cycle de vie.

### La CAPTURE — la vérité brute

| | |
|---|---|
| Table | `visit_capture` (mig 165) |
| Porte | `kind`, `body`, `lat/lng`, `created_at`, `status`, `triage_intent` |
| Cycle | `captured` → `kept` \| `discarded`. **Jamais modifiée, jamais supprimée.** |

Elle ne change pas. Écarter une capture ne l'efface pas : elle reste consultable
comme preuve (`status = 'discarded'`, cf. G4).

### La VISITE — l'événement

| | |
|---|---|
| Table | `site_reports` (mig 099), `origin` non-null = visite terrain |
| Porte | l'objectif, les bornes temporelles, le motif, l'analyse en cache |
| Répond à | *que s'est-il passé pendant cette visite ?* |

C'est un **événement daté**. Il relie des captures, une analyse, des validations
humaines et un document.

### Le COMPTE-RENDU — le document

| | |
|---|---|
| Table | `report_documents` (mig 120), `template_key = 'cr_visite.v1'` |
| Porte | `sections` (source de vérité), `ai_content` par section, `concretisations` |
| Cycle | `draft` → `validated` → `exported` (mig 228 : qui, quand) |
| Répond à | *qu'est-ce qui a été écrit, relu et signé ?* |

Depuis l'Étape A, c'est un **document humain**, plus une projection de l'IA.

### LE CHANTIER — l'état courant

| | |
|---|---|
| Table | `sites` + ses objets |
| Répond à | *où en est le chantier aujourd'hui ?* |

Il ne raconte pas l'histoire. Il dit l'état.

### LES OBJETS MÉTIER — ce qui vit

| Objet | Table | Lien à la visite |
|---|---|---|
| Action | `site_actions` | `report_id`, `source_capture_id` (mig 183) |
| Réserve | `site_reserve` (mig 110) | `report_id` |
| Décision | `site_decisions` (mig 136) | `report_id` |
| Échéance | `site_deadlines` (mig 215) | `report_id` |
| Intervenant | `site_intervenants` (mig 137) | *(aucun)* |
| Mémoire | `captured_knowledge` (mig 170) | `source_type='visit'` + `source_id` |
| Proposition | `site_report_proposals` (mig 099) | `report_id` |

**Ils survivent aux visites.** Une action peut traverser dix visites ; c'est
pour ça qu'elle appartient au chantier, pas à l'événement qui l'a suggérée.

---

## 2. Responsabilité de chacun — la règle en une ligne

| Objet | Sa responsabilité | Ce qu'il ne doit PAS faire |
|---|---|---|
| Capture | prouver | interpréter |
| Visite | raconter un moment | porter l'état courant |
| Compte-rendu | fixer ce qui a été écrit et signé | dupliquer les objets |
| Chantier | dire l'état d'aujourd'hui | raconter comment on y est arrivé |
| Objets métier | porter le travail | dépendre d'une visite pour exister |

---

## 3. Les duplications réelles

### 3.1 — La même information dite quatre fois dans le CR

`resume`, `decisions`, `a_savoir`, `actions`, `echeances` viennent tous de la
même analyse, au même niveau hiérarchique. « La dépose est lancée » y figure
quatre fois. **Ce n'est pas un défaut de contenu, c'est un défaut de hiérarchie.**

### 3.2 — Le verbatim comme faux objet métier

`doc.points.reserve` (`lib/db/visits.ts`) est le **corps brut** des captures
taguées. Corrigé pour le PDF (`fe20e4b6`), mais le motif demeure : *une
intention de tri n'est pas un objet métier*.

### 3.3 — « Ce qu'a produit la visite » compté deux fois, et jamais par provenance

| Read-model | Ce qu'il compte | Défaut |
|---|---|---|
| `buildVisitProduction` (visits.ts:1393) | captures par `triage_intent` | compte des **intentions**, pas des objets créés |
| `buildVisitImpact` (visits.ts:597) | objets créés **dans la fenêtre temporelle** | une **heuristique de temps**, pas un lien causal |

Or `report_id` existe sur les actions, réserves, décisions, échéances ; le
registre `concretisations` (mig 120 + Étape B) porte même `entity_id`. **La
provenance exacte est disponible et inutilisée.**

### 3.4 — L'intervenant, seul objet sans lien à la visite

`site_intervenants` ne porte aucun `report_id`. On ne peut donc pas dire « cette
visite a fait entrer Clim Expert au casting ». C'est le seul **trou réel du
modèle** trouvé par cet audit.

---

## 4. Ce que la visite doit montrer — sans recopier le chantier

La ligne de partage, sur le point où Vincent nuance à juste titre : la visite
montre **la chaîne**, pas les objets.

```
Photo 3  →  MemorIA propose une action  →  Guillaume confirme  →  Action créée
[preuve]        [interprétation]            [validation]          [lien sortant]
```

- **Dans la visite** : les quatre maillons, et le lien.
- **Hors de la visite** : l'historique de l'action, son avancement, ses relances.

Un clic sur « Action créée » ouvre la fiche Action. **La visite ne réimplémente
jamais la fiche.**

Corollaire : ce qui appartient au chantier (état d'une réserve, échéance
replanifiée) n'a pas à être rafraîchi dans la visite. La visite dit *ce qui
s'est passé ce jour-là* — elle n'est pas une fenêtre sur le présent.

---

## 5. Read-model proposé — `VisitNarrative`

Un objet, quatre couches, **aucune table nouvelle**.

```
VisitNarrative
├── contexte      qui · où · quand · objectif · durée
├── captured[]    ce qui a été capturé
│     ├─ capture (kind, heure, GPS, corps)
│     ├─ statut de tri (retenue / écartée) et intention
│     └─ transcription si vocal
├── understood[]  ce que MemorIA en a compris
│     ├─ proposition (type, libellé, confiance, rationale)
│     └─ état : proposée · acceptée · écartée
├── validated[]   ce que l'humain a tranché
│     ├─ geste (confirmer / corriger / ignorer), auteur, date
│     └─ correction apportée le cas échéant
└── produced[]    ce que la visite a fait naître DANS le chantier
      ├─ type + id de l'objet + libellé
      ├─ provenance : report_id · section · item_key
      └─ lien sortant vers la fiche
```

**Sources, toutes existantes :**

| Couche | Source |
|---|---|
| `captured` | `visit_capture` (y compris `discarded`, marquées) |
| `understood` | `site_report_proposals` + `debrief_analysis` |
| `validated` | `proposals.status` + `activity_logs` + `report_documents.validated_by/at` |
| `produced` | `report_documents.sections[].concretisations` **et** `report_id` sur les 4 familles |

Deux limites à assumer, plutôt qu'à masquer :

1. **L'intervenant n'a pas de lien** (§3.4) → soit `produced` ne le liste pas,
   soit une migration additive ajoute `report_id` à `site_intervenants`.
2. **Les objets créés avant l'Étape B** n'ont pas de registre → la couche
   `produced` retombe sur `report_id`, moins précis mais réel.

---

## 6. Découpage en lots indépendants

Chaque lot est livrable seul et n'attend pas le suivant.

| Lot | Objet | Dépend de | Risque |
|---|---|---|---|
| **N1** | `VisitNarrative` — le read-model, pur, testé, sans écran | rien | faible |
| **N2** | Combler le trou : `report_id` sur `site_intervenants` (migration additive) | rien | faible |
| **N3** | **Desktop, la salle d'enquête** : la timeline des captures, le vocal lié à la photo, la transcription, ce que MemorIA en a tiré | N1 | moyen |
| **N4** | La chaîne de transformation à l'écran : capture → proposition → validation → objet, avec liens sortants | N1, N3 | moyen |
| **N5** | Hiérarchie du CR : « ce qu'il faut retenir » / « ce qui doit être décidé » / « ce qui a été créé » — supprime les répétitions §3.1 | N1 | moyen |
| **N6** | Prompt : récit chronologique et **causal** plutôt qu'état futur | rien | élevé (qualité IA) |
| **N7** | Design éditorial du PDF (les 10 points en attente) | N5 | faible |

**Ordre recommandé** : N1 → N2 → N3 → N4, puis N5 → N7, et N6 en dernier.

Raison : N1 et N2 sont du modèle — ils ne se voient pas, mais tout le reste
s'appuie dessus. N6 vient en dernier parce que changer un prompt sans read-model
pour en juger le résultat, c'est régler un moteur sans banc d'essai.

---

## 7. Ce que cet audit ne tranche pas

- **Faut-il un `report_id` sur `site_intervenants` ?** C'est une décision de
  modèle : un intervenant *entre* dans un casting, il n'est pas *produit* par
  une visite. Le lien serait « première mention », pas « propriété ».
- **Le CR doit-il rester un document unique par visite ?** Aujourd'hui oui, et
  le versionnement a été écarté volontairement. Le récit ne le remet pas en
  cause, mais N5 le frôle.
- **Que devient `buildVisitProduction` ?** Il compte des intentions. Soit il
  disparaît au profit de `VisitNarrative.produced`, soit il est renommé pour
  dire ce qu'il compte vraiment.
