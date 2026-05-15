# Sprint de conception concrète — V5.1 (post-audit schéma, 2026-05-14)

> ⚠️ **CE SPRINT N'EST PAS À LANCER AVANT LE 20 MAI 2026.** Statut **EN ATTENTE** jusqu'à confrontation du pilote terrain (13-17 mai).
>
> **Version V5.1.2** — réécrit après audit du schéma existant (48 migrations). La première version proposait de créer un système parallèle `traces` / `capsules` / `trace_embeddings`. L'audit a montré que **l'infrastructure existante porte déjà 90% du besoin**. Cette version réutilise l'existant avec **2 migrations légères seulement**.

**Statut** : EN ATTENTE
**Date de gel V5.1 initiale** : 2026-05-14
**Date d'amendement V5.1.1** (resserrement 5 slices) : 2026-05-14
**Date d'amendement V5.1.2** (audit schéma + 2 migrations seulement) : 2026-05-14
**Date d'activation envisagée** : 20 mai 2026 (post-pilote)
**Branche envisagée** : `feat/sprint-conception-concrete-v5-1`
**Effort total estimé** : ~30h subagents (~4 jours de travail)
**Migrations DB** : 2 légères (~25 lignes SQL)

---

## Objectifs du sprint minimum viable V5.1

Décidé par Vincent. Trois objectifs vérifiables, rien de plus :

1. **Capturer une trace terrain sans friction.**
2. **Rendre un lieu perceptible sans dashboard.**
3. **Produire un fragment WhatsApp élégant et utile.**

Si ces 3 choses tiennent au pilote post-déploiement → débloque V5.2.
Si elles ne tiennent pas → retour conceptuel, pas extension produit.

---

## Principe directeur V5.1.2 (post-audit)

> **V5.1 ne crée pas une nouvelle architecture. V5.1 révèle différemment ce que l'architecture sait déjà faire.**

Conséquences :
- Aucune table nouvelle (`traces`, `capsules`, `trace_embeddings` rejetées).
- Réutilisation maximale de `intervention_photos`, `intervention_anomalies`, `site_notes`, `interventions`, `proof_share_tokens`, `search_memory` RPC, `fts_memory`, `pg_trgm`.
- Toute migration doit répondre à : *« Est-ce que cette migration ajoute une capacité réellement impossible avec l'existant ? »* Si non → pas de migration.

---

## Grammaire sensorielle (contrainte transverse, gravée 2026-05-14)

| Grammaire | Décision | Implications de code |
|---|---|---|
| **Temps** | stratifié (substrat sédimentaire) | Scroll vertical, récent en haut, ancien en bas |
| **Traces** | empreintes (présences sans intention) | Pas de filtre photo, pas de polaroid, pas de vignette, pas de crop auto |
| **Anomalies** | cicatrisent (la marque reste) | Bordure-gauche persistante même après résolution |
| **Voix** | COUPÉES en V5.1 | Architecture extensible (cf. ENUM `photo_kind`) mais pas codée |
| **Artefacts** | reportés V5.2+ | Aucun artefact physique en V5.1 |
| **Visuel** | opacity comme pigment | Pas d'ombre, pas de gradient, pas de blur |
| **Silences** | vides proportionnels, limités | Gap vertical max 220px, micro-repère qualitatif au-delà |
| **WhatsApp** | vertical, screenshotable iPhone | Ratio photo 4:5 ou 1:1, 3 éléments max |
| **IA curative** | 3 verbes : voici / fait écho / persiste-cesse | Wording IA verrouillé, test CI scripté |
| **Rythme** | instantané ou ≤100ms | Pas d'animation décorative |

### Palette définitive (à graver en CSS variables)

```css
--ink-1:    #0a0a0a;  /* texte principal, bouton primary */
--ink-2:    #555555;  /* texte secondaire */
--ink-3:    #888888;  /* texte tertiaire, traces 30j+ */
--ink-4:    #c0c0c0;  /* traces 90j+ */
--ink-5:    #e8e8e8;  /* traces 1an+, séparateurs */
--paper:    #fafafa;  /* fond mode jour */
--ink-bg:   #0a0a0a;  /* fond capsule client uniquement */
--scar:     #8a3030;  /* accent unique : anomalies en cours uniquement */
/* Blanc absolu #ffffff INTERDIT en fond. */
```

### Wording IA verrouillé (test CI obligatoire)

**Autorisé** : "Voici…" / "se ressemblent" / "fait écho" / "persiste" / "cesse" / "depuis…"
**Interdit** : "important", "majeur", "critique", "essentiel", "il faudrait", "vous devriez", "à surveiller", "intéressant", "remarquable", "score", "note", "pertinence", "recommandé".

---

## Arbitrages décisifs (Vincent 2026-05-14)

### A — Dépôt photo hors planning : mission système `Traces libres du site`

✅ **Validé** : exploiter `mission_cadence='on_demand'` existant.

- 1 mission auto-créée par site, `name='Traces libres du site'` (nom sobre validé par Vincent — plus posé que "Passages spontanés")
- `cadence='on_demand'`, `active=true`, `default_team={}`
- Cette mission est **système** : invisible dans planning, invisible dans missions planifiées, exclue des indicateurs de couverture
- À chaque dépôt photo spontané : find-or-create intervention de cette mission, fenêtre 4h par user + site
- `status='completed'` directement

**Garde-fou code** : helper centralisé obligatoire, pas de filtres dispersés.

```typescript
// lib/db/system-missions.ts
export const SYSTEM_MISSION_NAMES = ['Traces libres du site'] as const;

export function isSystemMission(m: { name: string; cadence: MissionCadence }): boolean {
  return m.cadence === 'on_demand' && SYSTEM_MISSION_NAMES.includes(m.name as any);
}

// Toute query planning DOIT utiliser ces helpers :
export async function getPlanningMissions(siteId?: string) {
  // returns missions WHERE NOT isSystemMission(m)
}

export async function getCoverageMetrics(...) {
  // exclut les missions système
}
```

**Test CI** : grep automatique sur `from('missions')` dans `lib/db/` et `app/(dashboard)/semaine/`, `app/(dashboard)/missions/` — toute query directe doit être justifiée ou passer par les helpers.

### B — `photo_kind` étendu avec `'passage'`

✅ **Validé** : ajouter `'passage'` à l'enum. Ne pas réutiliser `'proof'` (trop juridique).

**Migration 049** — voir `supabase/migrations/049_add_passage_photo_kind.sql`

Vocabulaire post-V5.1 :
- `'passage'` : trace banale (V5.1 NEW)
- `'anomaly'` : trace liée à anomalie
- `'before'` / `'after'` : workflow d'intervention planifiée
- `'proof'` : preuve qualifiée pour dossier (devient preuve par contexte, jamais par défaut)

### C — `proof_share_tokens` étendu avec `presentation_kind`

✅ **Validé** : extension légère, pas de table parallèle pour les capsules.

**Migration 050** — voir `supabase/migrations/050_add_presentation_kind_to_proof_share_tokens.sql`

Valeurs autorisées :
- `'proof_dossier'` (default, legacy `/p/[token]`)
- `'monthly_capsule'` (rendu `/c/[token]`)
- `'incident_capsule'` (rendu `/c/[token]`)

**Garde-fou doctrinal (commenté dans la migration)** : ne pas transformer `proof_share_tokens` en fourre-tout de rendu marketing. Chaque nouvelle valeur future doit répondre OUI à : *« Est-ce un rendu public d'une preuve ou d'une mémoire existante ? »* Sinon refuser.

---

## Catalogue des slices retenues V5.1

### Slice 1 — Dépôt photo offline-first 🔴 PRIORITÉ ABSOLUE

**Objectif servi** : 1 (capturer sans friction)
**Doctrine** : Couche brute, écriture urgente. Pilier 5 + Pilier 2.
**Effort** : M (~8h)
**Migration** : 049 (ajout `'passage'` à `photo_kind`)

**⚠️ POINT D'AUDIT AVANT IMPLÉMENTATION — `client_uuid` pour idempotence**

`intervention_photos` n'a **pas** de colonne `client_uuid` aujourd'hui. Pour l'idempotence du sync offline (éviter doublons en cas de retry réseau instable), trois options :

| Option | Approche | Tradeoff |
|---|---|---|
| **A** | Mini-migration 051 : `ALTER TABLE intervention_photos ADD COLUMN client_uuid UUID UNIQUE` | Propre, idempotent natif via `ON CONFLICT (client_uuid) DO NOTHING`. ~5 lignes SQL. |
| **B** | Idempotence via `(taken_by, sha256, intervention_id)` triplet unique | Zéro migration mais sémantique douteuse — 2 photos identiques au même moment ne devraient pas être bloquées |
| **C** | Idempotence applicative dans queue IndexedDB (Service Worker dedupe par client_uuid avant POST) | Zéro migration DB mais fragile si Joseph réinstalle l'app |

**Recommandation** : **Option A**, migration 051 minimale. À acter par Vincent avant d'écrire l'endpoint `/api/m/traces/sync`.

**Flow** :

```
ÉTAT 1 — Joseph tap "Photo"
        → Camera s'ouvre directement (caméra arrière par défaut)

ÉTAT 2 — Prise de photo
        → Aperçu + 2 boutons :
          [✓ Passage]  (80px, fond --ink-1, défaut)
          [🚨 Anomalie] (80px, contour --scar, sans fond)

ÉTAT 3 — Tap Passage/Anomalie
        → Photo serialisée IndexedDB
            { client_uuid, site_id, intent, blob, ts }
            1600px max, qualité 0.8
        → Indicateur 3s "1 trace déposée" puis disparaît
        → Écran revient à l'accueil site

ÉTAT 4 — Sync background (Service Worker)
        → POST /api/m/traces/sync avec retry exponentiel
        → Sur succès : tag local "synced"
        → Sur échec : tag "pending", AUCUNE notif user

ÉTAT 5 — Indicateur pending (si nécessaire)
        → Petit point ● gris en header (jamais rouge)
```

**Côté serveur (`/api/m/traces/sync`)** :
1. Validation `client_uuid` UUID v4 + auth user
2. `ensureSystemMission(site_id)` — find-or-create mission "Traces libres du site"
3. `findOrCreateSpontaneousIntervention(user_id, site_id, window=4h)` — réutilise si <4h
4. Upload photo dans bucket `intervention-photos` (existing)
5. Calcul SHA-256 serveur (gratis via SDK existant migration 040)
6. INSERT `intervention_photos` avec `kind='passage'` ou `'anomaly'`, `client_uuid`, `client_timestamp`
7. Si `intent='anomalie'` → INSERT `intervention_anomalies` avec `category='autre'`, `description=null` (aucune catégorisation demandée à Joseph — décision Vincent #3)

**Fichiers code à créer / modifier** :
- `app/m/[siteId]/page.tsx` — écran capture
- `app/m/[siteId]/components/PhotoCapture.tsx`
- `app/api/m/traces/sync/route.ts` — endpoint sync
- `lib/db/system-missions.ts` — helpers `isSystemMission`, `ensureSystemMission`, `getPlanningMissions`
- `lib/db/spontaneous-intervention.ts` — helper `findOrCreateSpontaneousIntervention`
- `public/sw.js` — Service Worker sync
- `lib/capture/queue.ts` — IndexedDB queue
- **Audit/modif** `lib/db/week-planning.ts`, `lib/db/dashboard.ts` — vérifier exclusion `cadence='on_demand'` ou passer par helpers

**Tests d'acceptation pilote** :
- [ ] Joseph dépose une trace en <15s (chronométré, 5 essais)
- [ ] 5 traces de suite sans lag perceptible
- [ ] Réseau coupé → aucune erreur affichée
- [ ] Retour réseau → sync silencieuse en <10s
- [ ] Test idempotence : retry manuel d'une trace déjà synchronisée → un seul enregistrement DB
- [ ] Mission "Traces libres du site" n'apparaît pas dans `/semaine`
- [ ] Mission "Traces libres du site" n'apparaît pas dans `/missions`

---

### Slice 2 — Écran Joseph arrive 🔴

**Objectif servi** : 1
**Effort** : S (~2h, dépend de Slice 1)
**Migration** : aucune

**UX exact** :

```
┌─────────────────────────────────────┐
│ Bonjour Joseph              [≡]     │
│                                     │
│ CHT Magenta                         │
│ 47ᵉ passage                         │
│                                     │
│ Dernière trace ici : 3 mai,         │
│ plomberie bloc B.                   │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │      📷  Photo                   │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Logique "Nᵉ passage"** (zéro migration) :

```sql
SELECT COUNT(DISTINCT DATE(p.taken_at))
FROM intervention_photos p
JOIN interventions i ON p.intervention_id = i.id
JOIN missions m ON i.mission_id = m.id
WHERE m.site_id = $1 AND p.taken_by = $2;
```

**Logique "Dernière trace ici"** : query directe sur `intervention_anomalies` (les plus saillantes) ou `intervention_photos` (kind='anomaly' ou caption) ou `site_notes` les plus récentes, tri DESC limit 1.

**Fichiers code** :
- `app/m/[siteId]/page.tsx` (page)
- `app/m/[siteId]/components/SiteHeader.tsx`
- `app/m/[siteId]/components/LastTraceHint.tsx`
- `lib/db/sites.ts` — `getNthPassageForUserAtSite()`, `getLastNotableTraceAtSite()`

---

### Slice 3 — Page Site substrat stratifié 🔴

**Objectif servi** : 2 (rendre un lieu perceptible sans dashboard)
**Effort** : M (~8h)
**Migration** : aucune

**Sources existantes utilisées** :
- `intervention_photos` (kind, caption, taken_at, sha256)
- `intervention_anomalies` (status open/resolved/ignored, created_at, resolved_at, description, category)
- `site_notes` (body 140 chars, created_at)
- `interventions` (notes libres, executed_at)

**Salience + opacity calculés côté serveur** (PAS de colonne DB — décision Vincent #4) :

```typescript
// lib/perception/salience.ts
export function salience(item: SiteFeedItem): number {
  if (item.type === 'anomaly') {
    return item.status === 'open' ? 1.0 : 0.5;  // cicatrice résolue = 0.5
  }
  if (item.type === 'site_note') return 0.6;
  if (item.type === 'photo' && item.kind === 'anomaly') return 0.8;
  if (item.type === 'photo' && item.caption) return 0.4;
  if (item.type === 'intervention' && item.notes) return 0.5;
  return 0.2; // passage banal
}

export function opacity(salience: number, ageDays: number): number {
  return Math.max(0.2, salience * Math.exp(-ageDays / 180));
}
```

**Gap vertical avec limite** (décision Vincent #2) :

```typescript
export function gapHeight(daysBetween: number): number {
  return Math.min(220, Math.max(20, daysBetween * 8));
}

// Si gap atteint 220 ET daysBetween >= 14 → insérer micro-repère qualitatif
export function silenceLabel(daysBetween: number): string | null {
  if (daysBetween < 14) return null;
  if (daysBetween < 30) return 'rien de notable depuis quelques semaines.';
  if (daysBetween < 90) return 'silence depuis plusieurs semaines.';
  return 'silence prolongé.';
}
// JAMAIS de chiffre dans le label.
```

**Cicatrices d'anomalies** : bordure-gauche persistante, couleur dégradée selon âge/statut. Jamais disparaître.

**Anti-patterns interdits (commenter dans le code)** :
- ❌ Aucun titre "Mai 2026" / "Avril 2026"
- ❌ Aucun chiffre style "18 passages"
- ❌ Aucune couleur sémantique alarmiste
- ❌ Aucune barre / jauge / graph
- ❌ Aucun filtre par personne

**Fichiers code** :
- `app/(dashboard)/sites/[id]/page.tsx`
- `app/(dashboard)/sites/[id]/components/TraceStream.tsx`
- `app/(dashboard)/sites/[id]/components/TraceItem.tsx`
- `app/(dashboard)/sites/[id]/components/SilenceMarker.tsx`
- `lib/perception/salience.ts`, `lib/perception/fading.ts`, `lib/perception/gaps.ts`
- `lib/db/site-feed.ts` — query unifiée des 4 sources

---

### Slice 4 — Capsule WhatsApp (mensuelle + incident résolu) 🟠

**Objectif servi** : 3 (produire un fragment WhatsApp élégant et utile)
**Effort** : M (~6h)
**Migration** : 050 (ajout `presentation_kind` à `proof_share_tokens`)
**Dépendances** : Slice 3

**Périmètre V5.1 (Vincent #4)** :
- ✅ Capsule **mensuelle** (Guillaume → Sylvie, 1×/mois)
- ✅ Capsule **incident résolu** (à chaud après résolution anomalie)
- ❌ Autres types (passation, audit, anniversaire) reportés V5.2+

**Capsule mensuelle (création)** :

```typescript
// création d'un proof_share_token avec :
{
  contract_id: '...',           // hérité pattern migration 026
  report_month: '2026-05',
  selected_photo_ids: ['photo-id'],  // 1 seule photo (vs 1..12 pour proof_dossier)
  dg_note: 'Mai. 23 passages. Dernière anomalie : 8 mars (résolue).', // template déterministe
  presentation_kind: 'monthly_capsule',  // NEW V5.1
  expires_at: now() + INTERVAL '30 days'
}
```

**Capsule incident résolu** :

```typescript
{
  intervention_id: '...',
  selected_photo_ids: ['photo_avant', 'photo_apres'],
  dg_note: 'CHT Magenta. Anomalie plomberie résolue le 12 mai.',
  presentation_kind: 'incident_capsule',
  expires_at: now() + INTERVAL '30 days'
}
```

**Templates déterministes** (aucune IA générative) :

```typescript
// lib/whatsapp/templates.ts
type CapsuleType = 'monthly_capsule' | 'incident_capsule';

const TEMPLATES = {
  monthly_capsule: (d) => {
    const base = `${d.monthLabel}. ${d.passageCount} passages.`;
    if (d.lastAnomalyDate) {
      return `${base} Dernière anomalie : ${d.lastAnomalyShort} (résolue).`;
    }
    return base;
  },
  incident_capsule: (d) => `${d.siteName}. Anomalie ${d.anomalyShort} résolue le ${d.resolvedShort}.`
};
```

**UX atelier capsule (côté Guillaume)** : preview chat WhatsApp fidèle (bulle #DCF8C6 sur #ECE5DD), 3 boutons "Copier l'image / Copier le texte / Ouvrir WhatsApp avec [contact]".

**Page publique `/c/[token]`** (côté Sylvie) :

```
[photo plein-écran 4:5]
[20px blanc sur fond #0a0a0a]
"Mai. 23 passages. Dernière anomalie : 8 mars (résolue)."
[11px --ink-3] "Émis par AGP · Infrastructure : MemorIA."
```

**Infrastructure gratuite (héritée)** :
- Audit `share_access_log` + RPC `record_share_access` (042)
- Freeze immuable PDF + SHA-256 (041) — optionnel pour capsule, à coder si besoin
- `proof_verification_tokens` permanent (032)
- Expiration / révocation (022)

**Fichiers code** :
- `app/(dashboard)/sites/[id]/capsule/page.tsx` — atelier Guillaume
- `app/(dashboard)/sites/[id]/capsule/components/WhatsAppPreview.tsx`
- `app/c/[token]/page.tsx` — page publique réception
- `lib/whatsapp/templates.ts`
- `lib/whatsapp/capsule-builder.ts`
- `lib/db/capsules.ts` (helpers spécifiques au filter `presentation_kind`)

**Tests d'acceptation pilote** :
- [ ] Guillaume prépare une capsule mensuelle en <2 min
- [ ] La capsule WhatsApp tient dans un screenshot iPhone vertical sans scroll
- [ ] Sylvie ouvre, regarde, ferme (<12s, pas d'interaction)
- [ ] Aucun cookie / GA / tracker sur `/c/[token]` (DevTools)
- [ ] Page publique charge en <800ms sur 4G NC

---

### Slice 5 — Atelier mémoire / Résonances 🟠

**Objectif servi** : 2 (amplification)
**Effort** : M (~5h)
**Migration** : aucune (étape 1 sans embeddings)
**Nom UI** : **"Atelier mémoire"** ou **"Résonances"** (jamais "Atelier IA")
**Naming code** : `lib/ai/memory-resonances.ts` (zéro collision avec `atelier_ia` existant qui sert AO)

**Périmètre V5.1** :
- ✅ Mode **Résonances** uniquement
- ❌ Persistances, Absences, Préparer passation, Préparer carnet reportés V5.2

**Approche sans embeddings (Vincent #5)** :

S'appuyer sur **`search_memory`** RPC existante (migration 044) + extraction de mots-clés saillants via tsvector statistics ou via requêtes prévisibles.

**Contraintes Vincent #5** :
- Requêtes prévisibles uniquement
- Période limitée (par défaut 180j, max 365j)
- `site_id` obligatoire (jamais cross-site sans filtre explicite)
- Limit stricte (max 10 hits par requête)
- Pas de moteur intelligent lourd

**Logique simplifiée pour V5.1** :

```typescript
// lib/ai/memory-resonances.ts
async function findResonances(siteId: string, periodDays = 180): Promise<Resonance[]> {
  // 1. Récupère toutes les anomalies + site_notes + intervention notes du site sur la période
  // 2. Extrait les bigrammes/termes récurrents (≥3 occurrences, ≥30j entre la première et la dernière)
  // 3. Pour chaque terme retenu : appelle search_memory(term, siteId, periodDays)
  // 4. Garde les top 1-2 clusters avec ≥3 hits espacés
  // 5. Retourne avec wording IA verrouillé
}
```

**Wording UI verrouillé** (test CI obligatoire) :
- *"Voici trois moments qui font écho."*
- *"Voici cinq fragments qui se ressemblent."*
- Si aucune résonance détectée : *"Pas de résonance détectée ce mois-ci."*

**Bouton d'échappatoire toujours visible** : *"Voir toutes les traces du site →"*

**Fichiers code** :
- `app/(dashboard)/memoire/[siteId]/page.tsx` — entrée Atelier mémoire
- `lib/ai/memory-resonances.ts` — module curation
- `lib/ai/forbidden-words.ts` — liste + test CI scripté

**Test CI scripté** : grep récursif sur les outputs `app/(dashboard)/memoire/**/*.{ts,tsx}` cherchant les mots interdits dans des string literals → fail si trouvé.

---

### Slice 6 — Silence du dimanche 🟢 (XS, parallélisable)

**Objectif servi** : transverse
**Effort** : XS (~1h)
**Migration** : aucune

**Implémentation** :

```typescript
// lib/quiet-day.ts
export function isQuietDay(date: Date, tenantTimezone: string): boolean {
  const local = toZonedTime(date, tenantTimezone);
  return getDay(local) === 0; // dimanche
}
```

**Garde-fou anti-religion** : `isQuietDay` n'est checké QUE sur les **envois proactifs** (email, SMS, push, crons). Routes API de **lecture** restent ouvertes 24/7.

**Exception explicite** : `lib/notifications/system-critical.ts` envoie même dimanche, canal unique pour pannes système au tenant admin.

---

## Récapitulatif effort V5.1.2

| Slice | Effort | Migrations |
|---|---|---|
| 1 Dépôt photo offline | 8h | 049 (+ 051 client_uuid à valider) |
| 2 Écran Joseph | 2h | 0 |
| 3 Page Site substrat | 8h | 0 |
| 4 Capsule WhatsApp | 6h | 050 |
| 5 Atelier mémoire / Résonances | 5h | 0 |
| 6 Silence du dimanche | 1h | 0 |
| **Total** | **30h** | **2 (+ 1 à valider)** |

---

## Points de surveillance (Vincent 2026-05-14)

1. **Filtrage missions système** : helpers `isSystemMission`, `getPlanningMissions` obligatoires. Test CI scripté pour interdire `from('missions')` direct hors helpers.
2. **`client_uuid`** : audit avant Slice 1. Migration 051 probable (à valider par Vincent).
3. **Anomalie rapide** : `category='autre'` seul. Aucune catégorisation demandée à Joseph. Maeva enrichira plus tard si nécessaire.
4. **Salience côté serveur** : pas de colonne DB. Calcul en query/render uniquement.
5. **Résonances** : sans embeddings, FTS/trigram, requêtes prévisibles, `site_id` obligatoire, périodes limitées, limit stricte.

---

## Slices REFUSÉES V5.1 (par Vincent, à ne pas argumenter)

| Slice / idée | Statut V5.1 | Re-arbitrage possible |
|---|---|---|
| Carnet de relève PDF A6 | ❌ Refusé | V5.2 si pilote V5.1 réussit |
| Livre annuel, boîte d'archives | ❌ Refusé | V5.3+ |
| Plaque QR physique | ❌ Refusé | V5.2 |
| Écran de passation avec prénom prédécesseur | ❌ Refusé | V5.2 après arbitrage `doctrine-reviewer` |
| Artefacts physiques premium | ❌ Refusé | V5.3+ |
| Modes IA avancés (Persistances, Absences, etc.) | ❌ Refusé | V5.2 si Résonances validé |
| Capsules WhatsApp passation / audit / anniversaire | ❌ Refusé | V5.2 |
| Voice notes terrain | ❌ Refusé | indéfini |

---

## Slices REFUSÉES par construction (refus structurels gravés)

| Demande | Refus | Motif |
|---|---|---|
| GPS / pointage / timestamps individuels | ❌ structurel | V3 Maxim 1 |
| Page profil agent / reverse-lookup | ❌ structurel | V3 |
| Notation humaine, scoring, 5 étoiles | ❌ structurel | V3 |
| IA qui juge le travail | ❌ structurel | Conv. 2026-05-14 |
| Gamification | ❌ structurel | Pilier 5 + règle descriptive |
| Génération IA voix DG | ❌ structurel | Pilier 4 |
| Correction des traces brutes | ❌ structurel | Rugosité 2026-05-14 |
| Analytics tierces (GA, Hotjar, Mixpanel) | ❌ structurel | Surveillance déguisée |
| A/B test wording mémoire | ❌ structurel | Mémoire ≠ funnel |
| Métriques d'engagement exposées | ❌ structurel | Densité, pas fréquence |
| Notification push entrante | ⚠️ par défaut | Exception : panne système au tenant admin |
| Auto-envoi rapport | ⚠️ par défaut | Exception : Guillaume programme + confirme 24h |
| Table parallèle `traces` / `capsules` / `trace_embeddings` | ❌ doctrine V5.1.2 | Réutilisation de l'existant obligatoire |

---

## La règle de réactivation post-déploiement V5.1

| Question | Mesure observationnelle | Seuil |
|---|---|---|
| Joseph capture sans friction ? | Temps moyen ouverture → 1ère trace | <15s sur 80% sessions |
| Guillaume ressent le lieu sans dashboard ? | Test "3 secondes" : décrire l'état d'un site | Cohérence ≥4/5 sites |
| Sylvie reçoit un fragment élégant et utile ? | Ouverture capsule + screenshot/forward observé | ≥2/3 critères sur 3 capsules |

**3/3 → V5.2 débloqué.**
**2/3 → consolider, ne pas étendre.**
**≤1/3 → STOP, revue conceptuelle, pas de nouveau code.**

---

## La phrase à retenir

> **Le concept est mort. Vive le réel.**
>
> *V5.1 ne crée pas une nouvelle architecture. V5.1 révèle différemment ce que l'architecture sait déjà faire.*

---

## Note finale d'exécution

À partir d'ici : pas de nouvelle couche théorique. Le sprint V5.1 passe en PRs.

**Étape 0 — Migrations** (faites) :
- ✅ `049_add_passage_photo_kind.sql`
- ✅ `050_add_presentation_kind_to_proof_share_tokens.sql`
- ⚠️ `051_add_client_uuid_to_intervention_photos.sql` — à valider par Vincent avant Slice 1

**Étape 1 — Slice 1** : ouvrir une PR par fichier de la liste, citer la slice et les contraintes grammaticales en description.

Si une demande arrive en cours de sprint pour étendre quelque chose : opposer ce document. Si elle mérite débat, l'inscrire dans `docs/superpowers/notes/2026-05-XX-debat-V5-1.md` pour arbitrage post-déploiement. Le sprint ne s'étend pas.
