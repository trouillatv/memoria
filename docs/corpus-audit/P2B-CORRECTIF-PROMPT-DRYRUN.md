# P2-B — Correctif générique (garde-fou objet vs domaine) + dry-run

Date : 2026-08-27. Corrige la cause racine P2 (Phase 1.5 `matchExistingSubject` sur-fusionnait un
fait sur un sujet du même domaine mais d'objet distinct). Une seule brique modifiée, partagée par
l'import historique et le field_visit. Aucun rematching Bella Napoli (réservé à P2-A).

## Correctif (B, workflow)

Renforcement de `SYSTEM_PROMPT_MATCH_EXISTING` (Phase 1.5) avec la doctrine « même OBJET métier
durable ≠ même domaine/thème » :
- une proposition ne rejoint un sujet existant que si c'est le **même objet réel** ou un nouvel
  état / échéance / manifestation de ce même objet ; la proximité de domaine ne suffit jamais ;
- **illustrations** (pas une table d'exclusion) : registre/rapport/réserve/document ≠
  contrôle/vérification/équipement (électrique, SSI, portes CF, VGP, hotte) → null ;
- **contre-illustrations** de matches à préserver (extincteurs, nettoyage…) → anti-fragmentation ;
- « Contrôle du registre » reste un sujet légitime → **juge l'identité de l'objet, pas les mots** ;
- **seuil 0.85 inchangé** ; en cas de doute → null → la Phase 2 crée le bon sujet ; ne jamais forcer
  le candidat le plus proche.

Aucun étage moteur ajouté, aucune table déterministe d'exclusion, aucune baisse de seuil.

## Dry-run réel (vrai `matchExistingSubject`, nouveau prompt) — 12/12 OK

| Catégorie | Cas | Attendu | Obtenu |
|---|---|---|---|
| 1. Cross-object | registre↔contrôle élec ; rapport SSI↔contrôle SSI ; réserve↔VGP porte CF ; signature registre↔nettoyage hotte | null | **null** ✓ |
| 2. Même objet nouvel état | extincteurs urgent/OK ; nettoyage à refaire | match | **match (0.95)** ✓ |
| 3. Même thème voisin | sprinkler↔extincteurs ; éclairage↔installations élec | null | **null** ✓ |
| 4. Ambiguïté | deux voisins même domaine | null | **null** ✓ |
| 5a. Bella Napoli (pool 2025 réel, Registre seul) | contrôles élec à refaire | null (avant : matchait Registre) | **null** ✓ |
| 5b. Bella Napoli (pool avec bon sujet) | contrôles élec à refaire | match Contrôle élec | **match (0.9)** ✓ |

**Compteurs** : matches même-objet conservés 3/3 ; faux match supprimé (Bella Napoli + 3 pièges
génériques) ; faux négatifs same-object introduits **0** ; aucune nouvelle sur-fusion.

## Vérifications

| | Résultat |
|---|---|
| Tests garde-fou (9 : contenu prompt + porte 0.85) | PASS |
| Dry-run réel (12 cas) | 12/12 OK |
| Typecheck / Lint | 0 / 0 |

## Suite

**P2-A (après validation)** : déplacer le fait 2025 « Contrôles électriques à refaire » de « Registre… »
vers « Contrôle des installations électriques » (`2504ad1f`), snapshot + rollback, puis rejouer l'audit
P1/P2. Attendu : « Contrôle des installations électriques » traverse 2024↔2025, « Registre… » reste
distinct, `spanning_both 4 → 5`. Ne pas toucher à P3.

**HARD STOP** après code + tests + dry-run. Pas encore de réparation Bella Napoli.
