# Architecture d'adressage de la mémoire — MemorIA

> **Doc de cadrage à VALIDER avant Sprint 2-B. Aucun code tant que non validé.**
> Objectif : figer l'ossature longue durée — l'adressage hiérarchique de la mémoire —
> qui rend les réponses de plus en plus précises **sans augmenter le coût IA**
> (le scope est un filtre déterministe appliqué AVANT l'IA).

---

## Ce que devient MemorIA — la définition

MemorIA n'est plus « photos + anomalies + réunions + IA ». MemorIA devient :

> **un système qui permet de poser des questions à n'importe quel niveau de mémoire
> d'une organisation.**

Conséquence : photos, réunions, comptes-rendus, documents, contrats, équipements
deviennent des **sources**. Le produit n'est plus aucune de ces choses — le produit est
**l'adressage et l'exploitation de la mémoire accumulée**. Toute feature future se juge
à : *« ajoute-t-elle une source, ou un niveau d'interrogation ? »*

---

## 0. Principe directeur — LA PROFONDEUR EST OPTIONNELLE

Le modèle doit accepter les deux extrêmes **sans friction** :

```
Petit site   :  Site → événements
Gros chantier:  Site → VRD → Réseau EP → Regard EP-17 → événements
```

La précision est **disponible quand il en faut, jamais imposée quand il n'en faut pas.**
C'est ce qui rend l'architecture forte : elle ne tue pas le terrain. Tout contenu
PEUT rester au niveau Site ; l'affiner est un **bonus**, pas un prérequis.

---

## 0bis. Règle d'existence d'un nœud (anti-explosion)

> **Un nœud n'existe que s'il apporte une valeur d'INTERROGATION.**

Sans cette règle, on explose : 50 sites × 100 sous-périmètres × 300 objets = 15 000 nœuds
ingérables. Le filtre :
- ❌ pas de nœud par vis, par ampoule, par tâche ;
- ✅ un nœud **parce qu'un humain dira un jour** *« que sait-on sur cet élément ? »*.

Conséquence UX : on ne crée **jamais** de nœuds en masse ni automatiquement en profondeur.
Un nœud apparaît quand quelqu'un **nomme** une chose qui mérite d'être interrogée. Couplé
au §0, la majorité du contenu reste au Site ; les nœuds émergent à la demande.

---

## 1. Le modèle récursif des scopes

Pas de niveaux fixes (sinon on se cogne au 6ᵉ niveau). Un **arbre récursif** :

```
Organisation
  └─ Site
       └─ Nœud (parent)
            └─ Nœud (enfant)
                 └─ … profondeur arbitraire
```

- Un **scope** = un nœud adressable :
  ```
  scope(id, organization_id, site_id, parent_scope_id?, scope_type_id, label, …)
  scope_types(id, key, label, industry_template)
  ```
- Récursion via `parent_scope_id`. Organisation et Site sont les ancrages ; les
  « sous-périmètres / objets » sont les nœuds enfants.
- `Médipôle → VRD → Réseau EP → Regard EP-17` = 4 nœuds parent→enfant, **pas 4 tables**.
- On n'« ajoute jamais un niveau » : l'arbre est déjà infiniment profond.
- **`scope_type_id` n'est pas que du vocabulaire — c'est la clé de l'agrégation
  TRANSVERSALE.** Un type « VRD » existe sur Médipôle, l'Aéroport, le Port. Le type
  permet de retrouver TOUS les nœuds VRD, tous sites confondus (cf. §3, axe TYPE).

---

## 2. Scope ≠ Contenu (la distinction qui rend tout propre)

- **Scope** = l'endroit / le contexte adressable. → un **arbre**.
- **Contenu** = ce qui s'y passe : événement, intervention, photo, réserve, action,
  note, **document**. → attaché à **un** nœud.
- Un contenu porte le `scope_id` **le plus précis connu**. Par l'arbre, il appartient
  AUSSI à tous les ancêtres de ce nœud.
- **Non destructif** : le contenu existant garde son rattachement actuel (site /
  intervention) ; `scope_id` est une **précision optionnelle** ajoutée par-dessus.

---

## 3. La règle de question

- Toute question s'attache à **n'importe quel nœud** (org, site, ou nœud profond).
- La réponse **agrège le sous-arbre** sous ce nœud.

```
Que sait-on sur l'entreprise ?      → sous-arbre de l'Organisation
Que sait-on sur Médipôle ?          → sous-arbre du Site
Que sait-on sur le lot VRD ?        → sous-arbre du nœud VRD
Que sait-on sur le Réseau EP ?      → Réseau EP + ses descendants (Regard EP-17…)
Que sait-on sur le Regard EP-17 ?   → ce nœud
```

- **Même moteur** (retrieval + briefs + recherche + résonances) ; seul le **scope** change.
- **Précision↑ sans coût IA↑** : le scope réduit le corpus *avant* l'IA → meilleure
  réponse + moins de tokens. Lève aussi les surfaces sans IA (FTS, « ce qui revient »).
**Deux axes d'agrégation orthogonaux — même moteur :**
- **Axe SOUS-ARBRE** (vertical) : tout ce qui est sous un nœud → *« que sait-on sur le
  Réseau EP **de Médipôle** »*.
- **Axe TYPE** (transversal, via `scope_type_id`) : tous les nœuds d'un même type, tous
  sites confondus → *« que sait-on sur **les** VRD »*, *« nos Réseaux EP partout »*.
  Débloque l'expertise (« qui connaît l'étanchéité ? ») gratuitement.

---

## 4. L'attribution sans friction (LE verrou)

Le contenu doit atterrir sur le bon nœud **sans saisie lourde**. Sources, du plus sûr
au plus souple :

1. **QR du nœud** (collé sur le Regard EP-17, la CTA 4…) → scope direct, zéro saisie.
2. **Mission / intervention** : porte déjà un corps d'état / périmètre → hérité.
3. **Contexte d'ouverture** : dernier site/nœud ouvert sur `/m` → pré-rempli.
4. **Suggestion IA au dépôt** : « cette photo concerne-t-elle le Réseau EP ? » —
   **proposée, jamais imposée**.
5. **Défaut** : le nœud le plus précis connu du contexte ; sinon le **Site**.

> **Jamais** de tag obligatoire à 4 niveaux. Rester au Site est toujours valide.

---

## 5. Exemples métiers (le sous-périmètre/objet est universel)

| Métier | Arbre type |
|---|---|
| **VRD** | Médipôle → VRD → Réseau EP → Regard EP-17 |
| **BTP** | Médipôle → Gros œuvre → Bâtiment B → Voile Nord |
| **Maintenance** | Hôpital → CVC → CTA 4 → Ventilateur |
| **Nettoyage** | Site → Bloc opératoire / Chambres / Hall / Cuisine |
| **Immobilier** | Immeuble → Toiture / Façade / Parties communes / Ascenseurs |

Convergence (concept seulement) : **EquipPass** = ADA → Parc → Utilitaires → Master
AB-123-CD → événements. Même arbre, contenu = **actifs** (vs **opérations** pour MemorIA).

---

## 6. Comment le catalogue 2-B se branche

- `organizations.industry_template` ∈ { cleaning, construction, maintenance,
  facility_management, industrial, **generic** }.
- `org_catalog(kind, key, label, description, icon, color, sort_order, active, metadata jsonb)`
  porte le vocabulaire. Les entrées de `kind ∈ {corps_etat, objet, zone}` **SONT** les
  `scope_types` (à fusionner ou relier — à trancher à l'impl ; `industry_template` les seede).
- **L'arbre porte les INSTANCES** : `scope.scope_type_id` → un type ; `scope.label` → le nom.
- C'est `scope_type_id` qui rend l'**axe TYPE** (§3) possible : agrégation transversale.

> Catalogue = **vocabulaire / types** (métier-aware). Arbre = **réalité / instances**.
> Le catalogue rend l'arbre adapté au métier ; il ne porte pas la hiérarchie elle-même.

---

## 7. Ce qu'on NE fait PAS maintenant

- ❌ **Pas de fusion EquipPass / MemorIA** — on converge le *concept*, pas le *code*.
- ❌ **Pas de « plateforme mémoire universelle » abstraite** — abstraction prématurée
  tant qu'un 2ᵉ client MemorIA n'est pas gagné.
- ❌ **Pas d'arbre obligatoire profond** — profondeur optionnelle (cf. §0).
- ❌ **Pas d'ERP** : un nœud **scope** la mémoire ; il ne porte ni planning, ni
  facturation, ni réception/cycle de vie contractuel.

---

## Test de validation (critère Vincent)

> *« Une question peut-elle être posée à chacun de ces niveaux ? »*

Si oui pour Organisation / Site / Sous-périmètre / Objet → l'architecture tient
**plusieurs années**. À partir de là, on n'ajoute plus des fonctionnalités : on ajoute
des **niveaux de mémoire adressable** — beaucoup plus difficile à copier qu'un écran de
compte-rendu ou qu'un prompt Gemini.

---

## Séquence (rappel)

Sprint 1 RLS (mig 114, à appliquer) → **VALIDER CE DOC** → Sprint 2-B (catalogue) conçu
*en cohérence avec l'arbre* → puis nœuds de scope + attribution inférée → puis brancher
les surfaces (briefs / recherche / résonances) sur le scope.
