# Graphe Acteurs V2 — « Explorer des acteurs » · audit & cadrage

> Cadrage AVANT tout code (discipline Vincent). La V2 ne doit pas être « plus de
> nœuds » : elle transforme le graphe en **outil d'interrogation interactif, temporel
> et explicatif** — *qui agit, avec qui, où, quand, autour de quels sujets*.
> Jamais mélangé au graphe Mémoire (même moteur, deux histoires).
> Fondé sur deux audits du code réel (2026-07-28) : inventaire ExplorerWorkspace
> vs ActorsGraphCanvas + sources de vérité temporelles.

## 0. Décision structurante
La duplication temporaire V1 ne tient plus face à l'ambition V2 : **on extrait un
moteur partagé `ForceGraphWorkspace`**, configuré par `MemoryGraphConfig` et
`ActorsGraphConfig`. Chaque graphe garde ses nœuds, relations, couleurs, panneaux,
filtres ; ils partagent la mécanique (physique, zoom/pan/drag, hit, sélection,
chronologie, rendu configurable).

---

## 1. Inventaire Explorer — ce qui est déjà réutilisable (audit A)

### Déjà dans ExplorerWorkspace (~1000 l.) — candidates moteur partagé
| Fonctionnalité | Implémentation (fichier:ligne) | Verdict moteur |
|---|---|---|
| Physique N-body + ressorts + friction | `step()` l.213-233 (répulsion 4200/d², ressort 0.022, friction 0.8) | ✅ générique |
| Zoom molette (bornes 0.45–2.6, centré curseur) | l.383-389 | ✅ générique |
| Pan / drag nœud / **pin** (`E.pinned`, conservé entre sélections) | l.333-344, 229, 365 | ✅ (pin = option) |
| Double-clic recentrer + zoom 1.35 | l.375-381 | ✅ (option) |
| Hit nœud **et arête** (dist. segment, tolérance 8px) | l.292-311 | ✅ générique |
| Hover nœud/arête + tooltip (label + `why` + date du lien) | l.346-357 | ✅ (contenu via config) |
| **Replay temporel** : champ `t` par nœud + slider + ▶ Rejouer (1100 ms/jour) + filtre `timeMax` dans `visible()` | l.93-97, 162-165, 559-572 | ✅ (nodeDate via config) |
| Fade alpha in/out **asymétrique** (0.12 in / 0.14 out) | l.211-212 | ✅ (préserver tel quel) |
| Depth 1/2 (Isoler/Étendre) | l.66-67, 468-469 | À paramétrer (prédicat visible) |
| Mode enquête (propagation `dependencySet`) | l.450-453, 967-981 | ❌ métier Mémoire |
| Légende interactive = filtres types (hidden/revealed, compteurs contextuels) | l.491-523, 105-123 | À paramétrer |
| Preuves repliées (PROOF/GLOBAL_DEFAULT) | l.48, 52 | ❌ métier Mémoire (concept générique « types repliés par défaut » paramétrable) |
| Labels adaptatifs (`labelVisible()` selon contexte) | l.239-241 | À paramétrer (prédicat) |
| Trail / fil d'Ariane de navigation | l.64, 397, 535-547 | ✅ (option) |
| Panneau droit 3 modes (fiche / récit 20 s / « Aujourd'hui ») | l.591-732 | ❌ métier — le moteur offre un **slot** `panelContent` |
| Seed / placeNew / kick (apparition progressive) | l.186-206 | ✅ générique |
| Recherche dans le graphe | — | ❌ **n'existe pas** (ni Mémoire ni Acteurs) → à créer |
| Boutons +/− , « ajuster à l'écran », mini-carte | — | ❌ n'existent pas → à créer (mini-carte : reporter) |

### ActorsGraphCanvas V1 (~370 l.) — apports propres
Libellés de relation au survol du lien, hiérarchie des tailles par type, couleur =
attentionState, `focusId` centrage, `onSelectActor` (naviguer DANS le réseau),
rayon de hit adapté au zoom. Tout le reste (pin, arête-tooltip, replay, depth,
filtres, labels adaptatifs, trail) **manque** vs Explorer.

**Conclusion audit A : le moteur partagé ≈ 70-80 % d'Explorer** (physique, gestes,
hit, rendu, replay, état center/pinned/view). Les 20-30 % restants sont métier
(générateurs de phrases, enquête, gaps, panneau) et restent dans chaque config.

---

## 2. Différences de sémantique Mémoire vs Acteurs (à ne jamais mélanger)
| | Graphe Mémoire | Explorer Acteurs V2 |
|---|---|---|
| Question | Pourquoi en est-on arrivé là ? | Qui agit, avec qui, où, quand, sur quoi ? |
| Nature des liens | **Causaux** (provenance, `why` prouvé) | **Organisationnels** (FK, membership, casting, responsabilité) |
| Nœuds | 10 types (visite, memo, photo, action, ech, dec, vigilance, acteur, know, site) | 5-7 types (personne, entreprise, équipe, chantier, action ; + visite/réunion en focale Activité si fiable) |
| Portée | Site-scopé | Org-scopé |
| Couleur | Par type | Par **attentionState** (rouge/orange/bleu/gris) |
| Temps | Replay narratif (apparition des faits) | Chronologie de **période** (relations actives pendant [t1,t2]) |
| Spécifique | Enquête causale, preuves repliées, récit 20 s | Focales, filtres d'attention, navigation d'acteur en acteur |

⚠️ Le replay Mémoire (« rejouer l'histoire ») et la chronologie Acteurs (« quelles
relations existaient pendant la période ») sont **deux usages du même mécanisme
`nodeDate/edgePeriod + filtre temporel`** — le moteur porte le mécanisme, chaque
config son sens.

---

## 3. Architecture partagée proposée

```
components/graph/ForceGraphWorkspace.tsx      ← moteur (nouveau)
├── physique (step) · zoom/pan/drag/pin · hit nœud+arête · seed/placeNew/kick
├── état : center, view, pinned, hover, timeWindow, hidden/revealed
├── chronologie (slider période + replay optionnel)
├── recherche (sur nodes fournis, → centrage + sélection)
├── toolbar (zoom +/−, ajuster, recentrer, réorganiser)
└── slots : panelContent(sélection), legend(config), toolbar extra

app/(dashboard)/sites/[id]/views/explorer/    ← MemoryGraphConfig (types, couleurs,
   ExplorerWorkspace devient un CLIENT           PROOF/GLOBAL_DEFAULT, enquête, récit,
                                                 gaps, panneau Mémoire)
app/(dashboard)/intervenants/graph/           ← ActorsGraphConfig (5-7 types,
   ActorsExplorer devient un CLIENT              attentionState, focales, filtres,
                                                 panneau d'inspection Acteurs)
```

### Contrat `GraphWorkspaceConfig` (extrait, à figer en V2.0)
```ts
interface GraphWorkspaceConfig<N, E> {
  nodes: N[]; edges: E[]
  nodeId(n): string; edgeEnds(e): { a: string; b: string }
  nodeColor(n): string; nodeRadius(n): number; nodeLabel(n): string
  edgeLabel?(e): string | null            // « travaille chez », « intervient sur »…
  nodeVisible?(n, ctx): boolean           // depth / focale / filtres / période
  nodeDate?(n): string | null             // replay Mémoire
  edgePeriod?(e): { from: string|null; to: string|null } | null  // chronologie Acteurs
  onSelectNode?/onSelectEdge?/panelContent?/legend?/features?: { pin, dblClickCenter, trail, timeline, search }
}
```

### Contrat des nœuds/liens Acteurs V2 (read model)
```ts
type ActorNodeKind = 'person'|'company'|'team'|'site'|'action'|'visit'   // visit ≥ focale Activité
interface ActorNode { id; kind; label; sub; level: AttentionLevel; historical: boolean }
interface ActorEdge {
  a; b
  rel: 'belongs_to'|'member_of'|'mobilized_on'|'intervenes_on'|'referent_of'
     | 'responsible_of'|'main_contact_of'|'confirmed_by'|'created_by_visit'|'participated_in'
  label: string
  certainty: 'structural' | 'declared'    // declared → pointillé + libellé, JAMAIS plein
  period?: { from: string|null; to: string|null }   // si source ✅ (cf. §5)
  provenance?: { kind: 'fk'|'casting'|'membership'|'action_event'|'report'; reportId?: string }
}
```
Le champ `certainty` matérialise la doctrine : **relations structurelles = trait
plein ; relations déclarées/textuelles = exclues de la V2 initiale** (ou pointillé
« à confirmer » dans un lot ultérieur explicitement validé).

---

## 4. Sources de vérité temporelles (audit B) — ce que la chronologie PEUT montrer

| Relation | Début | Fin | Classe |
|---|---|---|---|
| personne↔équipe (`member_of`) | `team_field_members.joined_at` / `team_members.joined_at` | `left_at` | ✅ |
| entreprise/personne↔chantier (`intervenes_on`, casting) | `site_intervenants.effective_from` (+ `source_report_id` = visite de confirmation) | `effective_to` | ✅ |
| action (cycle de vie complet) | `site_actions.created_at` + **journal `site_action_events`** (assigned/unassigned/due_date_changed/completed, `occurred_at`, `actor_id`) | `done_at` | ✅ |
| visite→action/décision/casting (provenance) | `report_id` / `source_report_id` + date du CR | — | ✅ |
| personne(user)↔intervention (`participated_in`) | `intervention_participants` (FK **users**) + `interventions.scheduled_for` | ponctuel | ✅ |
| décision | `date_decision`/`created_at` | ❌ pas d'événements | ⚠️ |
| équipe↔mission (`mobilized_on`) | ❌ aucune date d'affectation (created_at = création de la recette) | ❌ | ⚠️ |
| personne↔entreprise (`belongs_to`) | ❌ (`created_at` = création de la fiche, pas l'embauche) | ❌ | ⚠️ |
| participants de **visite/réunion** (contacts) | ❌ JSONB/texte libre, aucune FK | ❌ | ❌ |
| « relation plus vue depuis N mois » | ❌ aucun flux d'événements par relation | ❌ | ❌ |

### Conséquences honnêtes pour la V2
- **Chronologie V2.3 = réaliste** sur : casting (from/to ✅), équipes (joined/left ✅),
  actions (journal complet ✅), visites (dates CR ✅), interventions (dates ✅).
  Les liens **sans dates** (`belongs_to`, `mobilized_on`) restent **toujours visibles**
  pendant la période, avec mention « période inconnue » — jamais une date inventée.
- **Focale Activité = périmètre réduit et STRUCTUREL uniquement** :
  `confirmed_by` (casting←visite), `created_by_visit` (action/décision←CR),
  `participated_in` (user↔intervention). Les « participants de réunion » et les
  « citée dans » textuels sont **exclus de la V2 initiale** (doctrine).
- « Interaction cette semaine » n'est possible que via ces mêmes sources (événements
  d'action, interventions, CR) — pas de flux générique par personne.
- Évolutions BDD **optionnelles** (hors V2, à décider séparément) :
  `site_intervenant_events` (append-only), `meetings`+`meeting_participants` FK,
  dates d'affectation mission.

---

## 5. Les focales (modes de lecture explicites)
| Focale | Question | Nœuds | Liens | Notes |
|---|---|---|---|---|
| **Organisation** | Comment est-on organisé ? | personnes, entreprises, équipes, chantiers | belongs_to, member_of, mobilized_on, intervenes_on, main_contact_of | actions masquées par défaut |
| **Travail** | Qui porte quoi actuellement ? | + actions ouvertes | + referent_of, responsible_of | retards mis en avant |
| **Attention** | Où se concentrent les sujets ? | acteurs level≠ok + leurs objets | tous | « À jour » atténués/masqués ; **la plus utile au quotidien** |
| **Activité** | Qui a participé à quoi récemment ? | + visites/CR (interventions) | confirmed_by, created_by_visit, participated_in | STRUCTUREL only (cf. §4) |
| **Chantier** | Qui entoure ce chantier ? | centré chantier | tous | proche de l'Explorer actuel |
| **Acteur** | Le réseau de X ? | ego-graph prof. 1→2 (3 sur demande) | tous | remplace l'ego-graph V1 |

Filtres cumulatifs : types de nœuds · état d'attention (+ raccourci « seulement ce
qui demande attention ») · statut temporel (actuel/historique/terminé) · chantier(s)
· entreprise(s) · équipe(s) · nature de relation.

## 6. Panneau d'inspection (V2.1 — le cœur)
Sélection d'un **nœud** → fiche contextuelle complète dans le panneau droit sans
quitter le graphe. Réutilisation directe de l'existant : `PersonFicheBody`,
`CompanyFicheBody`, `getTeamActorInsight` (équipe), fiche action = `action-fiche.ts`
(résumé + lien), chantier = résumé + lien cockpit. Sélection d'un **lien** → le lien
devient un objet : nature (`label`), période (si ✅), source (`provenance` : casting,
FK, visite du JJ/MM, événement d'action), statut (actif/clôturé). Actions du panneau :
Centrer · Ouvrir la fiche complète · Afficher uniquement son réseau · Développer les
voisins · Masquer ce type de relation.

## 7. Lisibilité progressive & rendu
- Labels par paliers de zoom : faible = chantiers/entreprises/nœuds d'attention ;
  moyen = + personnes/équipes ; fort = + actions/libellés de relation. (Généralise le
  `labelVisible()` d'Explorer en prédicat config.)
- Couleur = attention (inchangé) ; **forme/icône = type** (nouveau, à dessiner dans le
  canvas : cercle/carré/hexagone ou pictos) ; taille = type + nœud focal plus grand ;
  jamais une note de performance. Degré de connexion borné = option ultérieure.
- Contrôles : molette, +/−, ajuster à l'écran, recentrer, réorganiser, pan, drag, pin.
  Mini-carte : **reportée** (aucun existant, coût réel, utilité à prouver).

---

## 8. Risques de régression (refactor Explorer → moteur partagé)
1. **Aucun test sur le canvas Explorer** (seul `site-graph.test.ts` couvre le read
   model). Mitigation : V2.0 extrait le moteur **sans changement visuel**, Explorer
   devient client à iso-comportement ; ajouter des tests unitaires sur les purs
   extraits (visible(), hit, sous-graphe temporel) + recette visuelle Vincent
   obligatoire sur /sites/[id]?tab=explorer avant merge.
2. Subtilités à préserver tel quel : alpha in/out asymétrique (0.12/0.14), condition
   « fading » de relance, `pinned` conservé entre sélections mais purgé au
   « Réorganiser », hit ignorant les nœuds alpha<0.5, reset des `revealed` à chaque
   sélection, tooltip d'arête avec `why`+date.
3. Différences V1 à arbitrer dans le moteur : rayon de hit adapté au zoom (Acteurs)
   vs fixe (Explorer) → option config ; bornes de zoom différentes → config.
4. Périmètre : le refactor touche une surface centrale de Mémoire → **niveau 3**
   (revue du diff + recette fonctionnelle des deux graphes).

---

## 9. Plan en lots & critères de sortie

### V2.0 — Architecture partagée (fondation, AUCUN changement visuel)
Extraire `ForceGraphWorkspace` + contrat `GraphWorkspaceConfig` ; ExplorerWorkspace
et ActorsGraphCanvas deviennent des clients à iso-comportement.
**Sortie :** les deux graphes rendent comme avant (recette visuelle Vincent),
tests purs sur le moteur extrait, typecheck/lint/build verts, zéro changement de
read model.

### V2.1 — Panneau d'inspection nœuds/liens (le plus de valeur)
Panneau droit : fiches contextuelles par type (réutilise FicheBody existants),
**sélection de lien** (nature/période/source/statut via `certainty`+`provenance`+
`period` ajoutés au read model), actions du panneau, mise en évidence du voisinage,
recentrage.
**Sortie :** cliquer tout nœud/lien affiche une explication complète sans quitter le
graphe ; le lien est un objet (« Clim Austral responsable de X · depuis le 24/07 ·
contact référent Joseph · ouverte »).

### V2.2 — Focales & filtres
6 focales + filtres cumulatifs + raccourci attention. Read model étendu
(main_contact_of ; nœuds visite pour Activité, STRUCTUREL only).
**Sortie :** changer de question sans quitter la surface ; chaque focale documentée
par sa question ; les relations textuelles n'apparaissent nulle part en trait plein.

### V2.3 — Chronologie
Barre de période (raccourcis 7j/30j/3m/1an/tout + Aujourd'hui), `edgePeriod` sur les
liens datés (✅ du §4), atténuation hors période, événements ponctuels sur leur date,
« période inconnue » assumée pour belongs_to/mobilized_on.
**Sortie :** « qui était présent en mars ? » répondable ; jamais de date inventée.

### V2.4 — Recherche & navigation avancée
Recherche (personne/entreprise/équipe/chantier/action/fonction/rôle) → centre +
sélectionne + ajuste les filtres si la cible est masquée ; développer voisins ;
profondeur 1→2→3 ; trail.
**Sortie :** tout acteur trouvable en ≤ 3 frappes + Entrée, visible même si filtré.

### V2.5 — Consolidation & performance
Suppression du code dupliqué V1 restant, alignement UX des deux graphes,
labels progressifs finalisés, perf (fetch ciblé de l'ego-graph au lieu de
reconstruire l'org — dette V1 notée), non-régression Mémoire.
**Sortie :** un seul moteur, deux configs ; dette de duplication soldée.

---

## 10. Décisions à valider avant V2.0 (code)
1. **Ordre** : V2.0 (fondation) d'abord, ou V2.1 (panneau, plus de valeur visible)
   sur le moteur V1 puis refactor ? Reco : **V2.0 d'abord** — tout le reste
   s'appuie sur le contrat, et refactorer après V2.1 doublerait le travail.
2. Focale **Activité** en V2.2 avec le périmètre réduit STRUCTUREL (§4), ou reportée
   après les évolutions BDD optionnelles (meetings FK, événements casting) ?
3. Icônes/formes par type de nœud : dessin canvas simple (cercle/carré/losange) ou
   pictogrammes (coût rendu) ?
4. Mini-carte : confirmée reportée ?
5. Évolutions BDD optionnelles (site_intervenant_events, meetings+participants FK) :
   ouvrir un lot données séparé ou s'en tenir aux sources actuelles pour toute la V2 ?

**Arrêt ici — aucun code avant validation.**
