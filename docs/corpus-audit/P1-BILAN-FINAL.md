# P1 — Bilan final (Bella Napoli, sécurisation avant import 2026)

Date : 2026-08-27. Corpus témoin Bella Napoli (2 PV : 2024-07-19, 2025-08-05).
Site `cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6`.

## 1. État initial (avant P1)

22 faits **isolés**. `spanning_both = 0` (aucun sujet ne traverse 2024↔2025). 9 faits métier
**absorbés par des acteurs** (KFT/MIES/Bureau Veritas/DSCGR/CAPSE/Velayoudon/VHZ pris pour sujets).
0 chaîne métier correcte. 0 lien acteur structuré (acteur prisonnier du texte).

## 2. État après P1-C1 (acteur ≠ sujet)

- **P1-C1a** (workflow + mig 355) : `canonical_subject.kind` ; les faits métier ne se résolvent plus
  jamais sur un sujet acteur (acteurs exclus du pool). Futurs imports protégés.
- **P1-C1b A** (repair) : 9 faits replacés sur des sujets métier durables. `spanning_both 0 → 3`
  (extincteurs, friteuse, nettoyage). Absorptions 9 → 0.
- **P1-C1b B** (workflow + mig 356) : table `canonical_subject_occurrence_actor_link` ; **12 liens
  acteur** avec rôle (`performed_by`/`proposed_by`/`validated_with`/`mentioned`), jamais
  `responsible_for`. Acteur = entité liée au fait daté, jamais le sujet.

## 3. État après P1-C2

- **P1-C2b** (mécanisme, sûr) : phase sémantique de dernier recours, pool borné (cap 20), réutilise
  le juge `analyzeSubjectPair` enrichi du contexte d'occurrence. **Dry-run : 0 auto-match sur 13
  sources → 0 sur-fusion.** Le piège « Contrôle électrique vs Registre électrique » = `related`, jamais
  fusionné. Aucun seuil abaissé, garde-fou conservé.
- **P1-C2c** (décision **humaine** contrôlée) : Vincent confirme sur les 2 PV que « Issue de Secours du
  food court » (2025) = « Dégagement extérieur du Mall » (2024) — même issue, même zone, usage
  personnel, évacuation public, contrainte frigos. Rattachement manuel via le chemin de fusion
  existant, journalisé `resolution_source=manual`. `spanning_both 3 → 4`. Aucune exception dans le code,
  matcher automatique inchangé.

## 4. Continuités désormais correctes (4 chaînes traversent 2024↔2025)

| Sujet | 2024 | 2025 |
|---|---|---|
| Contrôle des extincteurs | contrôlés par MIES 04/23 | contrôle OK |
| Contrôle système extinction (friteuse) | contrôlé par MIES 11/2022 | contrôle OK |
| Nettoyage conduits d'extraction | réalisé par KFT 11/2022 | à refaire avant Nov 2025 |
| Dégagement / issue Mall | validation DSCGR issue mall | Issue de Secours du food court |

## 5. Anomalies restantes (mesurées, bornées)

- **Cuisson ne traverse pas** : le signal 2025 « contrôle cuisson » est une *observation*, famille non
  éligible aux occurrences historiques → pas d'occurrence 2025 → «Contrôle appareils cuisson» reste
  only-2024. Question d'**éligibilité de famille**, pas de matching.
- **Conflation registre/contrôle électrique** : le fait 2025 « Contrôles électriques… à refaire » est
  canonicalisé sur le CS «Registre… non renseigné» au lieu d'un CS «Contrôle installations électriques».
  La continuité électrique 2024↔2025 est donc bloquée par cette conflation (défaut 2 de P1-B), pas par
  un faux négatif sémantique. À traiter séparément (jamais en fusionnant registre et contrôle).

## 6. Ce qui relève encore du MOTEUR

- Conflation registre/contrôle électrique (séparer les deux réalités ; éventuellement rattacher le fait
  « à refaire » au bon CS de contrôle).
- Éligibilité des *observations* aux occurrences historiques (impacte la traversée « cuisson »).
- Sur Géant : rouvrir Option B (embeddings de sujets) seulement si pools > 20 fréquents / faux négatifs
  sémantiques nombreux. Aujourd'hui non justifié.

## 7. Ce qui relève maintenant de l'UI / RESTITUTION

Le graphe est fiable (0 absorption acteur, 4 continuités correctes, liens acteur structurés). Ce qui
subsistait comme « impression de dysfonctionnement » (25 nouveaux, faux « toujours ouverts », lignes de
vie cassées) était un **symptôme de Bug A**, désormais corrigé au niveau du graphe. Le prochain chantier
est un **audit des écrans** (Aperçu, Histoire, Chronologie, Lignes de vie, Mémoire, Intervenants) pour
distinguer ce qui reste un défaut de présentation — à faire une fois ce socle en place, comme prévu.

## Critère de réussite (rappel)

Non pas « Bella Napoli est propre » mais : **un futur CR 2026 chargé par David produira directement les
bonnes identités, sujets, acteurs liés et continuités, sans réparation manuelle** — garanti par les
workflows P1-C1a/P1-C1b B/P1-C2b. Les réparations A et P1-C2c étaient des backfills one-time du corpus
créé avant correction.

## Journaux / rollback

`p1c1b-rollback.json` (repair 9 occurrences), `p1c2c-rollback.json` (fusion Mall/food court),
`canonical_subject_merge` (décision humaine journalisée). Migrations 355/356 additives et réversibles.
