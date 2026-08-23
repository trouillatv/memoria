# PRODUCT-DEADLINE-VS-FIELD-EVIDENCE — Phase A — Audit lecture seule

**Date** : 2026-08-24  
**Commit backfill** : 30921d8f  
**Script** : `scripts/_audit-deadline-field-evidence.ts`  
**Verdict** : `DEADLINE_FIELD_BRIDGE_PARTIAL`

---

## 1. Corpus

| Métrique | Valeur |
|---|---|
| Toutes les échéances | 86 |
| En retard (to_plan/planned, due_date < 2026-08-24) | 41 |

---

## 2. Couverture canonique (post-backfill 30921d8f)

| Catégorie | Nb | % |
|---|---|---|
| A — CANONICAL_LINKED | 23 | 56 % |
| B — NO_CANONICAL_IDENTITY | 18 | 44 % |

**Par chantier** :

| Chantier | Total en retard | Liées | % |
|---|---|---|---|
| OCEF Compostage (instance 1) | 18 | 6 | 33 % |
| OCEF Compostage (instance 2) | 16 | 15 | 94 % |
| Résidence Anse Vata | 3 | 0 | 0 % |
| Ocef4 | 3 | 2 | 67 % |
| Lycée PETRO ATTITI | 1 | 0 | 0 % |

---

## 3. Classification terrain (sur les 23 CANONICAL_LINKED)

| Classification | Nb | % |
|---|---|---|
| FIELD_COMPLETION_EVIDENCE | 1 | 4 % |
| FIELD_PROGRESS_OBSERVED | 7 | 30 % |
| NO_POST_DUE_EVIDENCE | 6 | 26 % |
| OVERDUE_WITHOUT_PROGRESS_EVIDENCE | 9 | 39 % |
| CONTRADICTORY_OR_UNCLEAR | 0 | 0 % |

---

## 4. Sentinelle PETRO — « Démarrage du nettoyages » (f0a18663)

```
status=planned  due_date=2026-08-17  canonical_subject_id=NULL
✔ reste bien dans B — NO_CANONICAL_IDENTITY
```

Aucune échéance PETRO n'est liée canoniquement (Lycée PETRO ATTITI : 1 en retard, 0 liée). L'interdiction de rattachement lexical est maintenue.

---

## 5. Exemples représentatifs

### FIELD_COMPLETION_EVIDENCE
**Chantier** : OCEF Compostage  
**Échéance** : `c955961c` « Reprise du réseau pour problème regard R4 (manque chute) prévue fin de »  
**Due date** : 2026-07-09 — Sujet : `4fb967c3` « Regard R4 »  
**Preuve** : 2026-08-05 — `field_checked` + `confirmed` humainement — [TEST-RECETTE-291]

> Ce cas illustre la chaîne complète : échéance ouverte administrativement → sujet canonique → occurrence terrain confirmée → diagnostic "potentiellement réalisée mais non clôturée".

### FIELD_PROGRESS_OBSERVED
**Échéance** : `4e304c62` « Essais pour réception du lot 02 »  
**Due date** : 2026-03-26 — Sujet : `b3626ca3` « Coordination Réseaux sous-dalle LOT01 et LOT02 »  
3 occurrences postérieures à la due_date, `visit_status=null`, activité suivie activement.

### NO_POST_DUE_EVIDENCE
**Échéance** : `61e49fd7` « Prochaine réunion de chantier »  
**Due date** : 2026-07-23 — Sujet : `9474c218`  
Occurrences présentes mais > 60 jours avant la due_date — signal trop ancien pour conclure.

### OVERDUE_WITHOUT_PROGRESS_EVIDENCE
**Échéance** : `384a5523` « Prochaine réunion de chantier »  
**Due date** : 2026-04-23 — Sujet : `9474c218`  
Occurrences uniquement avant la due_date. Aucune activité observée ensuite.

---

## 6. Réponses aux questions produit

| Question | Réponse |
|---|---|
| Échéances en retard | 41 |
| Canoniquement liées | 23 (56 %) |
| Avec preuve terrain postérieure à due_date | 8 (35 %) |
| Semblent réellement sans progression | 9 (39 %) |
| Activité constatée, suivi en cours | 7 (30 %) |
| Potentiellement réalisées, administrativement ouvertes | 1 (4 %) |
| Indécidables (contradictoires + sans preuve post-due) | 6 (26 %) |

---

## 7. Verdict

**`DEADLINE_FIELD_BRIDGE_PARTIAL`**

- Couverture 56 % des échéances en retard : le pont canonique atteint plus de la moitié du corpus.
- 35 % des liées ont une preuve terrain exploitable.
- Principe démontré sur les cas OCEF Compostage (instance 2 : 94 % liées).
- Le pont est applicable sur un sous-ensemble fiable — pas encore universel.

### Limites observées

- 44 % des échéances en retard n'ont pas d'identité canonique (B — NO_CANONICAL_IDENTITY). Ce sont majoritairement : Résidence Anse Vata (0/3), instance OCEF à 33 %, PETRO (0/1).
- 39 % des liées sont `OVERDUE_WITHOUT_PROGRESS_EVIDENCE` : le sujet existe mais les occurrences terrain sont antérieures à la due_date. Le pont ne peut pas dire "en cours" vs "abandonné".
- 26 % sont `NO_POST_DUE_EVIDENCE` : occurrences trop anciennes (> 60 jours avant due_date). Signal caduc.
- 0 cas contradictoire : bonne nouvelle — le modèle de validation terrain est cohérent.

### Prochaine étape (si GO Vincent)

Phase B : sur les 8 cas avec preuve postérieure (`FIELD_PROGRESS_OBSERVED` + `FIELD_COMPLETION_EVIDENCE`), évaluer si l'affichage d'un diagnostic automatique est fiable et actionnable — sans aucune écriture de statut.

---

*HARD STOP — aucune écriture, aucun changement applicatif.*
