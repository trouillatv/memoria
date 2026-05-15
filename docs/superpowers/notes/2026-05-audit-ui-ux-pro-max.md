# Audit UI/UX MemorIA — pré-pilote terrain (2026-05-12)

> Audit produit par un agent UI/UX senior, doctrine V2 respectée (sobriété calme, anonymisation, chaîne immuable, planning = preuve).
> À utiliser comme base pour la phase "design polish" pré-pilote terrain.
> Source : prompt `ui-ux-pro-max-skill` exécuté en mode manuel (skill installée mais non chargée dans la session).

---

## Section 1 — Top 5 Quick Wins (effort S, impact fort)

### QW1 — Topbar dashboard non-mobile-friendly : ajouter le `MobileSheetMenu` qui dort dans le repo
- **Fichiers** : `components/layout/AppTopbar.tsx:6`, `app/(dashboard)/layout.tsx:23-27`
- **Problème** : sur <768px, `md:pl-60` cache la sidebar mais aucun trigger dans la topbar mobile. `MobileSheetMenu.tsx` existe mais n'est jamais importé.
- **Solution** : `<MobileSheetMenu role={role} className="md:hidden" />` à gauche du nom dans `AppTopbar`. Aligner la NAV de `MobileSheetMenu.tsx:9-15` avec `AppSidebar.tsx:12-23` (il manque `/dashboard`, `/semaine`, `/equipes`, `/preuves`, `/contracts`).

### QW2 — `Sparkles` emerald sur `/dashboard` casse la sobriété
- **Fichier** : `app/(dashboard)/dashboard/page.tsx:142-145`
- **Problème** : icône "magique" en vert sur un cockpit factuel. `Sparkles` est l'icône IA — la réserver aux écrans copilote.
- **Solution** : `<LayoutDashboard className="h-5 w-5 text-muted-foreground" />`.

### QW3 — `Card` shadcn en `ring-1 ring-foreground/10` cause du double-trait
- **Fichier** : `components/ui/card.tsx:15` vs ~12 occurrences de `rounded-lg border bg-card` inline (`dashboard/page.tsx:191`, `contracts/[id]/page.tsx:143`, `semaine/page.tsx:152`…)
- **Solution** : passer `Card` en `border border-border/60` (suppression de `ring-1`).

### QW4 — `/m` desktop fallback : layout flotte à gauche sur grand écran
- **Fichier** : `app/(field)/layout.tsx:21-43`
- **Solution** : wrapper header et main dans `max-w-md mx-auto`. Pas de redesign desktop dédié.

### QW5 — Tokens statut morts dans `globals.css`
- **Fichier** : `app/globals.css:14-21` (`--color-pending-bg`, etc.) — aucune occurrence dans le code. Le vrai mapping vit dans `status-badge.tsx:63-94`.
- **Solution** : supprimer les 8 lignes.

---

## Section 2 — Audit par écran

### 2.1 `/preuves` (liste) — `app/(dashboard)/preuves/page.tsx`

**Diagnostic**
- **P0** Le compteur photos (`page.tsx:234`) en `text-xs text-muted-foreground` au même rang que anomalies/validations — pas de hiérarchie. Or c'est le cœur de la preuve.
- **P1** `CardTitle` du compteur de résultats (`page.tsx:129`) en `text-base` — devrait être un sous-titre discret.
- **P2** Empty state trop verbeux (`page.tsx:80-87`).

**Recommandations**
- Compteur photos à droite de la row en `text-sm font-medium` séparé. **S**
- Empty state : couper la 2e phrase. **S**
- Remplacer `CardTitle` par `<div className="text-sm text-muted-foreground px-6 py-2 border-b">…</div>`. **S**

### 2.2 `/preuves/[id]` (détail)

**Diagnostic**
- **P0** Meta band (`page.tsx:123-149`) : 4 stats identiques alors qu'Anomalies a un poids juridique différent de Durée.
- **P1** Card action "Préparer dossier" tout en bas (`page.tsx:228-239`) — action métier #1, à remonter.
- **P2** `formatDuration` dupliqué entre `/preuves/[id]/page.tsx:273-278` et `/p/[token]/page.tsx:356-361` → `lib/format.ts`.

**Recommandations**
- Card action en haut (sticky sur mobile). **S**
- Encadrer la stat Anomalies en `bg-amber-50/50 rounded-md p-2` si `>0` (jamais rouge). **S**

### 2.3 `/dashboard` (cockpit exécutif)

**Diagnostic**
- **P0** 3 sections (Demandent attention / En bonne progression / Inactifs) ont le **même style de row** — pas de poids visuel pour la section critique.
- **P0** Voir QW2.
- **P1** `EngagementCompliance` `size="compact"` 5 dots à droite (`page.tsx:189-207`) : illisible sur row 80px.
- **P2** `opacity-70` sur inactifs : sec. Préférer `bg-muted/20 border-border/50`.

**Recommandations**
- Section "Demandent attention" dans un `Card` avec header `<AlertTriangle className="h-4 w-4" />` en `text-amber-700` (jamais rouge). **M**
- Compact dots → `w-3 h-3`. **S**
- 🚨 **Risque doctrine évité** : ne PAS ajouter de score "Santé contrat 73%".

### 2.4 `/tenders/[id]` — mémoire AO + EvidencePanel

**Diagnostic**
- **P0** Le header de page vit **dans la sidebar** (`TenderSidebar.tsx:111-116`), pas dans le main. Vue mémoire commence par un `<h3 text-sm text-muted-foreground>` — hiérarchie cassée.
- **P0** `TenderSidebar.tsx:133` : `text-rose-600` pour J-7 — borderline doctrine (alerte rouge sur deadline).
- **P1** `Sparkles` `text-emerald-600` cohérent ici (IA). ✅
- **P2** CTA "Convertir en contrat" en vert émeraude saillant en bas (`TenderSidebar.tsx:340-346`) — hiérarchie à valider.

**Recommandations**
- Ajouter h1 dans le main pour chaque vue (mémoire/synthèse/analyse). **S**
- 🚨 `text-rose-600 (J-7)` → `text-amber-700`. **S**

### 2.5 `/semaine`

**Diagnostic**
- **P0** Labels créneaux (`m`/`m+a`/`m+a+s`) en `font-mono text-[11px]` (`WeekGridCell.tsx:191-198`) cryptiques sans légende.
- **P0** `WeekGrid.tsx:62` : scroll horizontal sur mobile sans indication.
- **P1** Cellule vide `—` OK. `text-amber-700/80 italic "Non-affecté"` ✅ doctrine.
- **P2** Identifiant `2026-W19` (`page.tsx:142`) en mono pollue l'UI prod.

**Recommandations**
- Légende pied de grille : `m=matin · a=après-midi · s=soir`. **S**
- Hint scroll mobile. **S**
- ID semaine cachée sauf `?debug=true`. **S**
- 🚨 **Risque doctrine évité** : ne PAS ajouter "% complétion semaine".

### 2.6 `/m` (mobile chef d'équipe)

**Diagnostic**
- **P0** Pas de FAB "Photo libre" sur intervention en cours — c'est l'action principale terrain, perdue en bas (`checklist-mobile.tsx:208-216`).
- **P1** 🚨 `<span className="text-rose-500">*</span>` (`checklist-mobile.tsx:170`) pour tâche obligatoire — rouge agressif.
- **P1** PhotoCaptureButton `minHeight: 44` (`photo-capture-button.tsx:63`) — minimum iOS strict, viser 52-56px (gants, doigts mouillés).
- **P2** Checkmark `✓` Unicode (`m/intervention/[id]/page.tsx:127`) vs lucide ailleurs.

**Recommandations**
- FAB "Photo libre" en bas droite quand `isInProgress`. **M**
- `text-rose-500` → `text-muted-foreground font-bold`. **S**
- PhotoCaptureButton `minHeight: 52`. **S**

### 2.7 `/p/[token]` (vue publique)

**Diagnostic**
- **P0** Layout `bg-muted/20 min-h-screen` (`layout.tsx:23-46`) : sur grand écran le contenu flotte sans cadre. Pour un client mécontent qui vérifie, on veut un effet "document officiel encadré".
- **P0** Footnote expiration nue (`page.tsx:319-322`) — devrait être un encart avec icône `Clock`.
- **P1** Asymétrie : bandeau présent uniquement si override admin (`page.tsx:144-153`). Cas anonymisé par défaut → aucune mention. Ajouter un sous-header `ShieldCheck • Identités masquées par défaut`.

**Recommandations**
- Wrapper enfants dans `<div className="bg-card border border-border rounded-xl shadow-sm p-6 md:p-8">`. **S**
- Sous-header anonymisation + encart expiration. **S**

---

## Section 3 — Design system transverse

**Cohérence tokens**
- 🟡 **Brand vs Primary** : `--color-brand-*` (bleu) et `--primary` (bleu HSL) cohabitent. Doublon non intentionnel. Verdict : utiliser `--primary` partout, garder `brand-*` pour l'identité (logo, séparateur sidebar active). À documenter.
- 🔴 **Tokens statut morts** : voir QW5.

**Composants doublons/manquants**
- `Card` réimplémentée inline ~12 fois — voir QW3.
- `Avatar` shadcn présent mais **jamais utilisé** (cohérent doctrine anonymisation — à supprimer ou documenter "réservé /equipes admin").
- `MobileBottomNav.tsx:7-19` a **3 liens identiques vers `/missions`** (bug copy-paste, composant mort).
- Pattern eyebrow `<h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">` répété 5+ fois → composant `<SectionLabel>` à extraire.

**Dark mode**
- CSS complet ✅, toggle dans topbar ✅, mais **absent de `/m`** — utile en intervention de nuit.

**Typographie** (h1 incohérents)

| Écran | h1 actuel |
|---|---|
| `/dashboard:142` | `text-2xl font-semibold` |
| `/preuves:152` | `text-2xl font-bold` |
| `/preuves/[id]:81` | `text-2xl font-bold` |
| `/semaine:132` | `text-2xl font-bold` |
| `/m:114`, `/m/intervention:92` | `text-xl font-semibold` |
| `/tenders/[id]` mémoire | **aucun h1** |

**Reco** : standardiser desktop `text-2xl font-semibold`, mobile `text-xl font-semibold`. Bannir `font-bold` (casse la sobriété).

**Densité**
- `/dashboard` `max-w-5xl` trop large → `max-w-4xl`.
- `/preuves` rows OK desktop, à vérifier mobile.

---

## Section 4 — Accessibilité

- ✅ Contrastes statuts amber/emerald/sky `bg-*-50 text-*-800` passent AA (~6.8-7.2).
- 🟡 `text-rose-600` sur sidebar (~5.1) — AA limite. À surveiller (déjà flagué 2.4 P0).
- ✅ Focus visible sur `Button` shadcn et `WeekGridCell`.
- 🔴 **AppSidebar liens : aucun focus visible** (`AppSidebar.tsx:40`). Ajouter `focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`. **S**
- ⚠️ **`KeyboardSensor` dnd-kit non vérifié** — drag clavier sur `WeekGridClient` probablement impossible. À tester.
- ⚠️ `<details>` natif dans `TenderSidebar.tsx:353-394` sans `aria-expanded` → migrer vers `DropdownMenu` shadcn.
- ✅ `lang="fr"` présent.
- 🔴 **Skip-links absents** — ajouter `<a href="#main" className="sr-only focus:not-sr-only">` en haut du layout dashboard. **S**

---

## Section 5 — Performance perçue

- ✅ Skeletons réutilisables (`skeleton-patterns.tsx`).
- 🟡 **Manquants** : pas de skeleton pour `/tenders/[id]`, `/semaine`, `/m/intervention/[id]`.
- 🟡 `WeekNavigation.tsx`, `ViewModeToggle.tsx` marqués `"use client"` — à vérifier s'ils ont vraiment un état local.
- 🔴 **`dashboard/page.tsx:125-127` Promise.all bloquant** : `summarizeContract` × N contrats × 3-4 queries DB = N+1. Ajouter Suspense par section.

---

## Section 6 — Mobile `/m`

- ✅ Optimistic update implémenté (`checklist-mobile.tsx:104`).
- ✅ Photos queuées via IndexedDB, SyncIndicator visible.
- ✅ Tap simple > slide-to-confirm (doctrine "calme" respectée).
- 🟡 PhotoCaptureButton `minHeight: 44` → viser 52-56px (gants, mouillé).
- 🟡 Checklist items `minHeight: 56` → 64.
- 🔴 **`app/manifest.ts:8` bug** : `start_url: '/missions'` route PWA chef d'équipe vers route admin/manager. Corriger en `start_url: '/m'`.

---

## Notes finales

**Forces actuelles** : `StatusBadge` centralisé, `EmptyState` réutilisable, anonymisation rigoureuse, `EngagementCompliance` calibré (slate/sky/indigo/amber/emerald — sain), sobriété générale respectée.

**Aucune dérive doctrine détectée** dans le code. Les 🚨 sont des risques *potentiels* à éviter dans les recos.

**Sprint polish recommandé (3-5 jours)** : QW1-5 + 2.1 + 2.2 + 2.6 + manifest fix. C'est le wedge produit.

**Effort total** : 19 recos S, 3 M, 0 L.
