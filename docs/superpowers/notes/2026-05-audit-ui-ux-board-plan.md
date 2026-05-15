# Audit UI/UX traité par l'Agent Board — plan d'exécution

> Companion de [`2026-05-audit-ui-ux-pro-max.md`](./2026-05-audit-ui-ux-pro-max.md).
> Application du board (`docs/superpowers/agents/agent-board.md`) sur les 22 recommandations de l'audit.
> Objectif : qui possède quoi, dans quel ordre, avec analyse doctrinale là où il y a tension.

---

## 1. Mapping agent ↔ recommandation

L'audit a été produit par `ui-ux-pro-max-skill`. La majorité des recos lui appartiennent — mais certaines débordent sur d'autres agents du board, et c'est là que le board prend son sens.

| # | Reco | Owner principal | Co-owner | Notes |
|---|---|---|---|---|
| QW1 | `MobileSheetMenu` à brancher | `ui-ux-pro-max-skill` | — | Pure UI |
| QW2 | `Sparkles` → `LayoutDashboard` sur `/dashboard` | `ui-ux-pro-max-skill` | — | Pure UI |
| QW3 | `Card` `ring-1` → `border` | `ui-ux-pro-max-skill` | — | Design system |
| QW4 | `/m` `max-w-md mx-auto` desktop fallback | `mobile-field-reviewer` | `ui-ux-pro-max-skill` | Mobile en premier |
| QW5 | Supprimer tokens statut morts | `ui-ux-pro-max-skill` | — | Hygiène CSS |
| 2.1a | Compteur photos hiérarchisé | `ui-ux-pro-max-skill` | — | |
| 2.1b | Empty state plus court | `ui-ux-pro-max-skill` | `copy-voice-reviewer` | Copy à valider |
| 2.1c | `CardTitle` compteur → sous-titre | `ui-ux-pro-max-skill` | — | |
| 2.2a | Card action "Préparer dossier" en haut | `ui-ux-pro-max-skill` | — | |
| 2.2b | Anomalies en `bg-amber-50/50` si >0 | `ui-ux-pro-max-skill` | `doctrine-reviewer` | **Tension légère — voir §3** |
| 2.2c | Extraire `formatDuration` → `lib/format.ts` | `ui-ux-pro-max-skill` | — | Refacto trivial |
| 2.3a | Section "Demandent attention" encadrée | `ui-ux-pro-max-skill` | `doctrine-reviewer` | **Tension légère — voir §3** |
| 2.3b | Compact dots `w-3 h-3` | `ui-ux-pro-max-skill` | — | |
| 2.4a | Ajouter h1 dans main `/tenders/[id]` | `ui-ux-pro-max-skill` | — | |
| 2.4b | `text-rose-600 (J-7)` → `text-amber-700` | `ui-ux-pro-max-skill` | `doctrine-reviewer` | **Aligne explicitement la doctrine — voir §3** |
| 2.5a | Légende `m`/`a`/`s` pied de grille | `ui-ux-pro-max-skill` | `copy-voice-reviewer` | Wording légende |
| 2.5b | Hint scroll mobile | `ui-ux-pro-max-skill` | — | |
| 2.5c | ID semaine en `?debug=true` | `ui-ux-pro-max-skill` | — | |
| 2.6a | FAB "Photo libre" sur intervention | `mobile-field-reviewer` | `ui-ux-pro-max-skill` | Mobile-first |
| 2.6b | `text-rose-500` astérisque → muted | `mobile-field-reviewer` | `doctrine-reviewer` | **Aligne doctrine — voir §3** |
| 2.6c | PhotoCaptureButton `minHeight: 52` | `mobile-field-reviewer` | — | Terrain |
| 2.7a | Layout `/p/[token]` encadré | `ui-ux-pro-max-skill` | `security-privacy-reviewer` | Vue publique = security touche |
| 2.7b | Sous-header "Identités masquées par défaut" | `ui-ux-pro-max-skill` | `security-privacy-reviewer` + `copy-voice-reviewer` | Crucial : signal d'anonymisation |
| §3 transverse | Brand vs Primary token | `ui-ux-pro-max-skill` | — | Design system |
| §3 typo h1 | Standardiser `text-2xl font-semibold` | `ui-ux-pro-max-skill` | — | |
| §4 a11y | Focus visible AppSidebar | `ui-ux-pro-max-skill` | — | A11y owned par ui-ux ici |
| §4 a11y | Skip-links | `ui-ux-pro-max-skill` | — | |
| §4 dnd | `KeyboardSensor` dnd-kit | `ui-ux-pro-max-skill` | `test-smoke-reviewer` | Vérifier que ça marche |
| §5 perf | Promise.all `/dashboard` N+1 | `perf-query-reviewer` | — | Owner clair |
| §5 skel | Skeletons manquants | `ui-ux-pro-max-skill` | — | |
| §6 mob | `manifest.ts:8` `start_url: '/m'` | `mobile-field-reviewer` | `test-smoke-reviewer` | Bug fonctionnel + PWA |

**Bilan owner** :
- `ui-ux-pro-max-skill` : ~21 recos
- `mobile-field-reviewer` : 4 recos
- `perf-query-reviewer` : 1 reco
- `doctrine-reviewer` : 4 co-ownerships (analyse §3)
- `copy-voice-reviewer` : 3 co-ownerships
- `security-privacy-reviewer` : 2 co-ownerships
- `test-smoke-reviewer` : 2 co-ownerships
- `db-rls-reviewer` : **0** — aucune migration touchée, normal

---

## 2. Items hors doctrine `ui-ux-pro-max-skill`

Les recos suivantes ne devraient **pas** être traitées par `ui-ux-pro-max-skill` seul. Le board les rattache à un agent plus pertinent.

### 2.1 — `manifest.ts:8` `start_url: '/missions'` bug
**Bon owner** : `mobile-field-reviewer` + `test-smoke-reviewer`.
**Pourquoi pas ui-ux** : ce n'est pas un problème visuel, c'est un bug fonctionnel PWA qui route le chef d'équipe vers une route admin. `ui-ux-pro-max-skill` l'a vu en passant, mais l'audit terrain est l'owner légitime.

### 2.2 — `dashboard/page.tsx:125-127` N+1 queries
**Bon owner** : `perf-query-reviewer`.
**Pourquoi pas ui-ux** : c'est du SQL/DB, pas du visuel. `ui-ux-pro-max-skill` a flaggé "perf perçue" mais le diagnostic complet (Promise.all × N contrats × 3-4 queries DB) appartient à `perf-query-reviewer`.

### 2.3 — `/p/[token]` sous-header anonymisation
**Bon owner** : `security-privacy-reviewer` + `copy-voice-reviewer`.
**Pourquoi pas ui-ux** : le wording de cette mention engage juridiquement (RGPD, perception client). `ui-ux-pro-max-skill` peut proposer le placement et le composant, mais le texte exact ("Identités masquées par défaut" vs "Confidentialité préservée" vs "Anonymisation active") doit passer par `copy-voice-reviewer`, et le contrat de confidentialité par `security-privacy-reviewer`.

### 2.4 — Empty state `/preuves` plus court
**Co-owner** : `copy-voice-reviewer`.
**Note** : `ui-ux-pro-max-skill` propose de couper la 2e phrase ; `copy-voice-reviewer` validera que ce qui reste respecte le ton "calme/pro/rassurant/non-bureaucratique".

### 2.5 — `KeyboardSensor` dnd-kit
**Co-owner** : `test-smoke-reviewer`.
**Note** : ajouter le sensor est trivial. Mais **vérifier** que le drag clavier fonctionne réellement (focus → flèches → entrer) demande un smoke test, pas une review visuelle.

---

## 3. Tensions doctrinales — analyse 4-points

L'audit n'a flaggé aucune violation doctrinale. Mais 4 recos touchent à des zones sensibles. Voici l'analyse formelle.

### Tension #1 — Anomalies en `bg-amber-50/50` si `>0` (reco 2.2b)

**Contexte** : aujourd'hui les 4 stats de la Meta band sur `/preuves/[id]` sont visuellement identiques. La reco propose d'encadrer la stat Anomalies en ambre si `count > 0`.

| Axe | Évaluation |
|---|---|
| **1. Valeur** | Hiérarchie de lecture pour le superviseur. Une anomalie a un poids juridique (preuve d'incident). +UX, +confiance superviseur. |
| **2. Risque doctrinal** | Léger drift vers "alerte". Mais ambre (pas rouge) + condition `>0` + sans pictogramme alarmiste = reste calme. Pas de gamification, pas de KPI agent, pas de surveillance. |
| **3. Coût technique** | Trivial. Ternaire sur className. |
| **4. Verdict** | ✅ **Aligné doctrine** sous condition : pas de rouge, pas d'animation, pas de "!" décoratif. Garder le compteur factuel. |

### Tension #2 — Encadrer "Demandent attention" sur `/dashboard` (reco 2.3a)

**Contexte** : la section critique du cockpit a le même style que "En bonne progression". La reco propose un encadré dédié avec `<AlertTriangle>` ambre.

| Axe | Évaluation |
|---|---|
| **1. Valeur** | Le DG voit immédiatement ce qui requiert son attention. +UX, +confiance, +effet wedge (cockpit lisible = produit qui se respecte). |
| **2. Risque doctrinal** | Tension : "attention" peut glisser vers "alerte". Mais le pattern proposé (AlertTriangle ambre + texte calme) reste posé. Le filtre booléen `needsAttention` existe déjà côté DB — c'est juste sa surface visuelle. |
| **3. Coût technique** | S — wrapping CardHeader. |
| **4. Verdict** | ✅ **Aligné** sous condition : interdiction stricte d'ajouter par-dessus un score numérique ("Santé contrat 73%") ou un badge clignotant. Le wedge du dashboard reste factuel. |

### Tension #3 — `text-rose-600` deadline AO → `text-amber-700` (reco 2.4b)

**Contexte** : `TenderSidebar.tsx:133` affiche `J-7` en rose vif. La reco propose de descendre en ambre.

| Axe | Évaluation |
|---|---|
| **1. Valeur** | Aligne la sidebar AO sur la doctrine "calme". Évite l'effet "compte à rebours stressant". Le superviseur voit l'info sans pic d'anxiété. |
| **2. Risque doctrinal** | **Inversé : c'est la version actuelle qui tend la doctrine.** Le changement la renforce. |
| **3. Coût technique** | Trivial. |
| **4. Verdict** | ✅ **Aligné**, change explicitement à faire. Garder la couleur rose interdite sur tous les compteurs de deadline. |

### Tension #4 — `text-rose-500` astérisque obligatoire en mobile (reco 2.6b)

**Contexte** : `checklist-mobile.tsx:170` rose pour marquer une tâche obligatoire. La reco propose `text-muted-foreground font-bold`.

| Axe | Évaluation |
|---|---|
| **1. Valeur** | Discret, lisible, sobre. Pas de pic visuel sur l'écran mobile (où l'agent passe 4h par jour). |
| **2. Risque doctrinal** | Aucun (la version actuelle est légèrement contraire à la doctrine). |
| **3. Coût technique** | Trivial. |
| **4. Verdict** | ✅ **Aligné**, change à faire. Règle générale qui en sort : **le rouge/rose vif est banni de toute UI agent terrain** (l'agent ne doit pas vivre dans la peur). |

---

## 4. Règle implicite révélée par le board

L'analyse fait émerger une **règle transverse** que la doctrine peut absorber :

> **Sur tout écran MemorIA, le rouge vif (`rose-500/600`, `red-*`) est réservé à `destructive` (action destructive confirmée). Tout autre signal d'attention utilise `amber-700` ou `muted-foreground bold`.**

Cette règle découle des tensions #1, #3, #4. À documenter dans `docs/superpowers/doctrines/` ou en commentaire de `components/ui/status-badge.tsx`.

---

## 5. Plan d'exécution séquencé

Respectant la règle board "1-2 agents max par slice" et l'ordre d'activation officiel.

### Sprint 1 — Quick Wins UI (1 jour) — `ui-ux-pro-max-skill` seul
- QW2, QW3, QW5, 2.3b (compact dots), 2.4a (h1 tenders), §3 typo h1, §3 brand vs primary

Pourquoi seul : pas d'écran fonctionnel changé, pas de DB, pas de mobile, pas de copy nouveau. Pur design system. 1 PR.

### Sprint 2 — Mobile field (1.5 jour) — `mobile-field-reviewer` → `doctrine-reviewer` review courte
- QW4 (`/m` desktop fallback), 2.6a (FAB photo), 2.6b (rose → muted, valide la règle §4), 2.6c (button height 52), `manifest.ts:8` (start_url), checkmark unicode → lucide

Pourquoi cet ordre : `mobile-field-reviewer` valide ergonomie terrain en premier. `doctrine-reviewer` audite uniquement la règle §4 quand elle est appliquée (≤30 min). Pas de `ui-ux-pro-max-skill` ici sauf si `mobile-field-reviewer` flagge un doute.

### Sprint 3 — `/preuves` (1 jour) — `ui-ux-pro-max-skill` → `copy-voice-reviewer` sur empty state
- 2.1a (compteur photos), 2.1b (empty state — `copy-voice-reviewer`), 2.1c (CardTitle), 2.2a (card action en haut), 2.2b (Anomalies amber), 2.2c (extraire formatDuration)

Pourquoi cet ordre : écran cœur produit. Polish + un seul item copy (empty state).

### Sprint 4 — `/dashboard` (1 jour) — `ui-ux-pro-max-skill` + `perf-query-reviewer` parallèle
- 2.3a (section attention), `dashboard/page.tsx:125-127` N+1 (`perf-query-reviewer`), §3 densité `max-w-4xl`

Pourquoi en parallèle : `perf-query-reviewer` travaille sur la couche data (Promise.all), `ui-ux-pro-max-skill` sur le visuel — pas de collision. Exception au "1-2 agents max" car les sujets ne se touchent pas.

### Sprint 5 — `/tenders` + `/semaine` (1 jour) — `ui-ux-pro-max-skill` + `copy-voice-reviewer`
- 2.4b (rose deadline → amber), 2.5a (légende m/a/s — `copy-voice-reviewer` valide), 2.5b (hint scroll), 2.5c (debug ID), skeleton `/tenders` + `/semaine`

### Sprint 6 — `/p/[token]` (0.5 jour) — `security-privacy-reviewer` → `copy-voice-reviewer` → `ui-ux-pro-max-skill`
- 2.7a (layout encadré), 2.7b (sous-header anonymisation)

Pourquoi cet ordre strict : 
1. `security-privacy-reviewer` cadre l'engagement (qu'est-ce qu'on garantit ?).
2. `copy-voice-reviewer` finalise le wording.
3. `ui-ux-pro-max-skill` implémente la surface.

### Sprint 7 — A11y + smoke (0.5 jour) — `ui-ux-pro-max-skill` → `test-smoke-reviewer`
- Focus visible AppSidebar, skip-links, `KeyboardSensor` dnd-kit + smoke test clavier

### Total
**~5 jours**. Cohérent avec le sprint "design polish 3-5j" recommandé par l'audit.

---

## 6. Ce que le board interdit explicitement

En appliquant le board, ces 3 tentations sont écartées :

- ❌ **Ne PAS lancer un `doctrine-reviewer` plénier sur l'audit complet**. Il n'a sa place que sur les 4 tensions identifiées en §3.
- ❌ **Ne PAS appeler `db-rls-reviewer`**. L'audit ne touche aucune migration ni RLS.
- ❌ **Ne PAS confier la N+1 dashboard à `ui-ux-pro-max-skill`**. Owner = `perf-query-reviewer`. Sortir du périmètre = dilution.

---

## 7. Sortie attendue à la fin du sprint polish

- 7 PR (1 par sprint), chaque PR ≤ 10 fichiers modifiés, chaque PR validée par 1-2 agents max.
- 1 mise à jour `docs/superpowers/doctrines/` avec la règle §4 (interdiction du rouge vif sauf destructive).
- 1 smoke test ajouté sur drag clavier `/semaine`.
- `manifest.ts:8` corrigé, validé sur Android installé en PWA.
- Pas de nouveau composant créé hormis `<SectionLabel>` (extraction du pattern eyebrow).

Vincent valide chaque PR avant merge. Pas d'auto-merge agent.
