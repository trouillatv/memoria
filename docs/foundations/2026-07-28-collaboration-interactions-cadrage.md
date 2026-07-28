# Cadrage — Modèle d'interaction & force de collaboration (graphe Acteurs V3)

Statut : **cadrage, sans code.** Décisions à trancher en fin de document.
Date : 2026-07-28.

## 1. Intention

Passer du **contexte** (V2.2 — les dernières interactions datées d'un acteur avec un
chantier) au **réseau** : avec qui un acteur travaille *réellement*, à quelle
fréquence, dans quels contextes, si la relation est forte ou occasionnelle, et
comment elle évolue dans le temps.

Doctrine (inchangée) : **entièrement explicable par les faits.** Jamais un score
opaque ; toute « force de relation » se déplie en interactions datées, chacune
rattachée à un objet métier réel.

## 2. Principe : définir l'INTERACTION avant le SCORE

Une **interaction élémentaire** = un fait STRUCTUREL daté reliant DEUX acteurs. La
**force de relation** = agrégation pondérée d'interactions. On fige d'abord la
grammaire (ce document) ; le score devient alors presque trivial et justifiable.

## 3. Grammaire d'interaction (ancrée sur la donnée réelle)

Acteurs = personne (`company_contacts`), entreprise (`companies`), équipe (`teams`).

### Signaux STRUCTURELS FIABLES (base du score)

| # | Interaction | Relie | Source (FK) | Date | Durée | Confiance |
|---|---|---|---|---|---|---|
| 1 | **Co-casting chantier** | entreprise↔entreprise (et personne↔personne via `main_contact`, personne↔entreprise) | `site_intervenants` : même `site_id`, liens actifs/clôturés | `effective_from` | oui (`effective_to`) | HAUTE |
| 2 | **Co-équipe** | personne↔personne | `team_field_members` : même `team_id` | `joined_at` | oui (`left_at`) | HAUTE |
| 3 | **Co-assignation action** | personne (référent) ↔ entreprise (responsable) | `site_actions` : même action (`assigned_contact_id` + `assigned_company_id`) | `created_at` | ponctuelle | HAUTE |

- **#1 est le signal-pivot** des « entreprises qui travaillent ensemble » (écosystème).
- **#2** porte « qui collabore régulièrement » sur le terrain.
- **#3** capte la collaboration concrète sur un sujet (référent ↔ entreprise responsable).

### Relations de STRUCTURE (contexte, pas fréquence)

- **Appartenance** personne→entreprise (`company_contacts.company_id`), personne→équipe.
  Ce sont des *rattachements* durables, déjà les arêtes du graphe. Ils cadrent la
  lecture mais n'alimentent pas un compteur de fréquence.

### Signaux FLOUS — EXCLUS du score fiable

| # | Signal | Pourquoi flou | Traitement |
|---|---|---|---|
| 4 | **Co-présence visite/réunion** | `site_reports.participants` = JSONB de **noms** (rattachement lexical, aucune FK vers `company_contacts`) | Exclu du score. Réclame d'abord une **liaison structurelle report↔acteur** (lot data dédié). |
| 5 | **Même décision** | `site_decisions` n'a qu'UN `decisionnaire_contact_id` → pas de co-décision structurelle | Sans objet en l'état. |

**Pont structurel partiel existant** : `site_intervenants.source_report_id` relie un
casting au CR qui l'a fait naître. On sait donc *quels acteurs ont été rattachés
depuis le CR R* — mais pas *qui a assisté à la visite R*. C'est un signal partiel et
de confiance moyenne (utilisé en V2.2 pour « Cité dans »), pas une présence.

### Conséquence d'honnêteté (à assumer)

Le mockup « 12 visites communes, 8 réunions » **n'est pas calculable de façon fiable
aujourd'hui**. Un « 42 interactions avec Guillaume » v1 se construira sur
**co-casting + co-équipe + co-action** — pas sur les visites/réunions. Les « visites
communes » exigent d'abord la liaison structurelle report↔acteur (lot data séparé).

## 4. Anatomie d'une interaction (enregistrement)

```
Interaction {
  a, b            // paire d'acteurs, NON ordonnée (symétrique)
  type            // 'co_casting' | 'co_team' | 'co_action'
  siteId?         // contexte chantier quand il existe
  date            // début (YYYY-MM-DD)
  endDate?        // fin si durée (casting clôturé, départ d'équipe)
  sourceType,     // objet métier réel (traçabilité, cf. V2.2)
  sourceId
  weight          // poids du type
  confidence      // 'high' pour les 3 fiables
}
```

## 5. Agrégation → force de relation

```
strength(a,b) = Σ interactions( poids × décote_temporelle )
```
+ métadonnées entièrement dépliables :
`nInteractions`, `parType`, `firstSeen`, `lastSeen`, `chantiersPartagés`,
`tendance` (récent vs ancien).

**Libellé qualitatif** dérivé (très forte / régulière / récente / occasionnelle),
toujours accompagné du détail — jamais un chiffre nu.

**Poids proposés (À VALIDER)** : co-action **3**, co-casting **2** (par chantier
partagé), co-équipe **2** (durable). **Décote temporelle** : pondérer par récence
(demi-vie ~12–18 mois) pour que « travaillent *toujours* ensemble » ≠ « ont
travaillé ensemble il y a 3 ans ».

## 6. Dimensions temporelles

- `lastSeen` / `firstSeen` (première & dernière interaction).
- `tendance` : hausse / stable / baisse, via comparaison fenêtre récente (6 mois)
  vs précédente. Permet « collaboration en baisse », « n'ont plus collaboré depuis
  longtemps ».

## 7. Ce que produira la V3 (cible)

- Inspecteur, section **« Travaille principalement avec »** : liste triée par force,
  libellé qualitatif + n interactions.
- Clic → **« Pourquoi proche ? »** : ventilation par type + chantiers partagés
  (100 % traçable, chaque ligne mène à l'objet réel).
- Vue **Écosystème** : graphe entreprise↔entreprise, **épaisseur = force** (co-casting
  pondéré) — enfin la « force » des relations, pas leur simple existence.

## 8. Ordre de mise en œuvre (= celui de Vincent)

1. ✅ **CE DOCUMENT** — modèle d'interaction (grammaire + données réelles + confiance).
2. **Interactions élémentaires** : read model **PUR calculé à la volée** (pas de table
   matérialisée d'abord → toujours frais, zéro migration) dérivant co-casting /
   co-équipe / co-action des tables existantes.
3. **Agrégation → force** (poids + décote validés).
4. **Dimensions temporelles** (récent / ancien / tendance).
5. **Branchements UI** : inspecteur « travaille avec », vue Écosystème pondérée,
   épaisseur des liens.
6. *(Lot data séparé, plus tard)* : liaison structurelle **report↔acteur**
   (table de participation avec FK) → débloque la co-présence visite/réunion fiable.

## 9. Décisions

- **D1 — Périmètre v1 : TRANCHÉ (Vincent, 2026-07-28) → v1 = 3 signaux structurels
  fiables uniquement** (co-casting / co-équipe / co-action). La co-présence
  visite/réunion est différée à une liaison structurelle report↔acteur (§8.6). On ne
  bâtit pas de score sur du rattachement lexical (doctrine « une mention n'est pas une
  identité »).
- **D2 — Forme :** read model calculé à la volée d'abord, table matérialisée plus tard
  si la perf l'exige. *(reco retenue : calculé)*
- **D3 — Poids & décote :** ordres de grandeur proposés (co-action 3, co-casting 2,
  co-équipe 2 ; demi-vie 12–18 mois) — à affiner à l'étape 3.
