# P3-B2-repair Bella + témoin officiel du défaut P3-#3

Date : 2026-08-28. Repair du composite 2025 depuis l'ÉTAT DU GRAPHE (aucune ré-extraction). Écriture
appliquée en base, snapshot/rollback disponible. `scripts/repair-p3b2-bella.ts`.

## Ce qui a été fait

| Facette | Action | Résultat |
|---|---|---|
| **Électrique** (`2504ad1f`) | Relabel in-place de l'occurrence 2025 (pas de doublon) | « Contrôles électriques, éclairage et cuisson à refaire » → **« Contrôle des installations électriques — à refaire »** (atomique). Source/preuve du composite préservées sur la proposition. |
| **Cuisson** (`b78526f9`) | Création de l'occurrence 2025 « à refaire » à la forme exacte d'`ensureHistoricalPdfOccurrences` | Ligne de vie **2024→2025** (2 occurrences). |
| **Éclairage** (`cc12fce6`) | **NON touché** | « Contrôle éclairage de sécurité réalisé » (22/03/2024) conservé intact. |

Invariants (12) vérifiés, tous ✅ : électrique atomique sans doublon ; cuisson 2024→2025 ; éclairage
inchangé ; dates 2025-08-05 ; **0 nouveau lien acteur** ; **26 → 27** occurrences (seul +1 cuisson) ;
**3 → 3 suggestions** (aucun rapprochement/fusion) ; cibles business/actives/non fusionnées ;
Registre ≠ Contrôle intacts ; Registre + Largeur (P3-B1) toujours matérialisés.

Rollback : `DELETE` occurrence cuisson `08454cc7…` + restaurer le label composite sur `b7efb7c1…`.

## Témoin officiel du défaut P3-#3 (information non matérialisable)

Le PV Bella du **05/08/2025** porte, pour le **même sujet « Contrôle éclairage de sécurité »**, DEUX
états datés distincts :

1. **Contrôle réalisé** le 22/03/2024 (par Bureau Véritas) — historique rappelé dans le PV 2025 ;
2. **Contrôle à refaire** immédiatement (en retard) — constat de la visite du 05/08/2025.

Ces deux informations sont **compatibles** (un contrôle réalisé en 2024 peut être à refaire en 2025),
mais le modèle actuel — **1 occurrence par (canonical_subject, rapport)** (index `cso_historical_pdf_uniq`,
mig 317) — n'a **qu'un seul slot** pour (éclairage, rapport 2025). Ce slot porte « réalisé ».

⇒ **L'état « Contrôle éclairage de sécurité — à refaire » (PV 05/08/2025) est actuellement NON
MATÉRIALISABLE** sans écraser « réalisé » ni fusionner les deux (pooling refusé : détruirait l'atomicité
et ferait dépendre l'état longitudinal d'un `selectBestText`).

Décision (Vincent) : **différer** (option a). Ne pas pooler, ne pas écraser, ne pas contourner. Ce cas
est le **témoin officiel du défaut P3-#3** et déclenche l'audit **P3-C**.

## Ce que P3-B2-repair NE clôt PAS

P3 n'est **pas** terminé : le défaut #3 n'est plus théorique — c'est une **perte structurelle démontrée**
sur un cas métier réel (état historique + état actuel du même sujet dans un même document). Pattern
probablement fréquent chez Géant (VGP « contrôlé le X — défaut au Y », SSI « vérifié — prochaine échéance »,
« dernier contrôle = date X — à refaire »).

**HARD STOP.** Prochain lot : **P3-C AUDIT READ-ONLY** — sémantique de `canonical_subject_occurrence`
(présence documentaire vs événement/état daté) et multiplicité des états d'un sujet dans un document ;
options A (sujet×rapport agrégé) / B (occurrence = état atomique) / C (documentaire + sous-événements) ;
conséquences idempotence / provenance / dates / LMCA / Évolution / lignes de vie / state signals / UI.
Aucun code. Sur GO.
