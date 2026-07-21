# Où est la vérité de la validation ?

> Note de conception commandée par Vincent, 2026-07-21, avant N2.
> Déclenchée par une observation du récit de visite (N1) : **44 propositions,
> aucune `confirmed`, et pourtant des objets créés.** Le produit raconte deux
> histoires.

---

## 1. Les faits

### Deux portes mènent au chantier

```
PORTE A — la proposition                 PORTE B — le compte-rendu
site_knowledge_proposals (mig 212)       report_documents · cr_visite.v1
proposed → confirmed | dismissed         content corrigé par l'humain
       │  | superseded                            │
       │ promoteProposal()                        │ concrétisation (Étape B)
       ▼                                          ▼
   objet du chantier                        objet du chantier
```

**Elles ne couvrent pas les mêmes familles.**

| Famille | Porte A | Porte B |
|---|---|---|
| action · échéance · décision · mémoire | ✅ | ✅ |
| vigilance | ✅ | ❌ (raconte, ne crée pas) |
| **intervenant** | ✅ **seule porte** | ❌ (un nom ne porte pas de rôle) |

Elles sont donc **complémentaires**, pas redondantes — mais rien ne le dit, et
les deux peuvent créer la même action.

### Ce que `superseded` signifie vraiment

`markObsoleteProposals` (knowledge-proposals.ts:252) passe en `superseded` les
propositions `proposed` d'une **analyse antérieure** que la lecture courante ne
redit plus. Les 10 intervenants `superseded` de Guillaume ne sont donc pas un
rejet humain : c'est une **régénération d'analyse**. Aucune décision n'a été
prise sur eux.

### La protection anti-doublon est asymétrique

- **B connaît A** : la concrétisation relit le chantier (`listSiteActionsByReport`,
  `listSiteDeadlines`, `listDecisionsByReport`, `listCapturedKnowledgeBySource`).
  Un objet né d'une proposition porte `report_id` → B le voit et ne le recrée pas.
- **A ne connaît pas B** : confirmer une proposition après avoir concrétisé la
  même ligne **peut créer un doublon**. Aucun garde-fou.

C'est le seul défaut *technique* du carrefour. Le reste est un défaut de sens.

---

## 2. Pourquoi `confirmed` est vide

Parce que la concrétisation **ne passe jamais par les propositions**. Elle lit le
texte corrigé du compte-rendu et crée directement. Une proposition reste donc
`proposed` (ou `superseded`) même quand l'objet qu'elle annonçait existe.

Le récit ne ment pas : il révèle que **`understood.status` ne mesure rien de la
validation réelle**.

---

## 3. La décision

> **Le compte-rendu est le contrat. La proposition est le matériau. Le geste
> humain est la validation — d'où qu'il vienne. Et il n'existe qu'UN journal.**

Trois conséquences, qui se tiennent :

### 3.1 — Le contrat est le document

C'est déjà vrai partout ailleurs, et c'est cohérent avec les Étapes A, B et C :
le texte corrigé fait foi, le PDF l'imprime, la finalisation le signe. Le
compte-rendu est ce qui **engage**.

### 3.2 — La proposition ne prétend plus être une validation

`proposed`, `superseded`, `dismissed` décrivent la vie du **matériau**, pas la
décision métier. Le récit ne doit donc **jamais** présenter le compte des
`confirmed` comme « ce que l'humain a validé ». À corriger dans N1 :
`validated` se lit sur le **document** (statut, sections corrigées, cycle de
vie) et sur le **registre**, pas sur les statuts de propositions.

### 3.3 — Un seul journal : le registre de concrétisation

Les deux portes restent ouvertes — l'intervenant n'en a qu'une — mais **elles
écrivent au même endroit**. `report_documents.sections[].concretisations` porte
déjà `item_key`, `entity_type`, `entity_id`, `created_at`, `source_text`.

Quand la porte A crée un objet, elle doit **inscrire au registre**, exactement
comme la porte B. Alors :

- `produced` devient complet, quelle que soit la porte ;
- A hérite de l'anti-doublon de B, et l'asymétrie du §1 disparaît ;
- le récit n'a plus qu'une seule histoire à raconter.

C'est **la modification la moins coûteuse** qui referme le carrefour : aucune
table, aucune migration, un appel à ajouter dans `promoteProposal`.

---

## 4. Ce que cela change pour la suite

| Lot | Impact |
|---|---|
| **N1** (livré) | corriger `validated` : lire le document + le registre, pas les statuts de propositions |
| **N2** | inchangé dans son principe — mais la provenance de l'intervenant devient **une écriture au registre**, pas une table nouvelle. Le trou du §3.4 de l'audit se referme tout seul |
| **N4** | la chaîne à l'écran devient racontable : capture → proposition → **geste** → objet, avec une seule source pour le dernier maillon |

---

## 5. Ce que je n'ai pas retenu, et pourquoi

**Option A — la proposition devient le contrat** (`proposed → confirmed →
produced`). Séduisante, cohérente sur le papier. Rejetée parce qu'elle
obligerait le compte-rendu à repasser par des propositions pour créer quoi que
ce soit — alors que le CR est justement devenu un **texte humain**, corrigé
librement, dont les lignes n'ont plus de correspondance avec une proposition.
Il faudrait ré-attribuer chaque ligne corrigée à une proposition d'origine :
une inférence, la faute que le produit refuse.

**Option « une seule porte »** — tout passe par la concrétisation du CR.
Rejetée parce que l'intervenant ne peut pas naître d'une ligne de texte : son
rôle ne s'y lit pas. C'est exactement ce que G2 vient de résoudre en posant la
question.

---

## 6. La question qui reste ouverte

Si un jour une porte doit fermer, ce sera **A pour les quatre familles que B
couvre déjà** — pour ne garder A que là où elle est indispensable (intervenant,
vigilance). Ce n'est pas urgent : tant que le journal est unique, les deux
portes ne se contredisent plus.
