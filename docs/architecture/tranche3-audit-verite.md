# Tranche 3 — Audit de convergence de vérité

**Statut : AUDIT (lecture seule). Aucun code applicatif modifié, aucune écriture émise.**
Périmètre accordé : « GO POUR AUDIT, PAS POUR CODE ».
Mesures du 2026-08-23, sur les 12 chantiers dont le nom contient PETRO ou OCEF.

Scripts : `scripts/_audit-tranche3-verite.ts`, `scripts/_audit-tranche3-nettoyage.ts` — READ-ONLY,
aucun INSERT / UPDATE / DELETE / replay. Sortie brute : `audit-tranche3-out.txt`.

Méthode : le moteur B (`deriveSiteAttentionItems`) est **appelé réellement**. Le moteur A
(`getAttentionDigest`) exige une session utilisateur : ses prédicats sont **rejoués à
l'identique**, sans son plafond ni son scope organisation. Toute conclusion sur A porte donc
sur sa règle, pas sur son rendu final.

---

## Verdict en une phrase

Les deux moteurs ne se dupliquent pas — ils sont **largement orthogonaux**. Mais là où ils se
recouvrent, ils ne divergent pas par un réglage : **A lit la mauvaise date**. Sur 53 réserves
ouvertes mesurées, 53 sont classées de façon contradictoire, et sur les 52 issues d'import PV
c'est parce que A mesure l'âge de l'**enregistrement** là où B mesure l'âge du **fait**.

---

## (A) Cartographie des deux moteurs

### Ce que chacun sait faire

| Signal | A `getAttentionDigest` | B `deriveSiteAttentionItems` |
|---|---|---|
| Actions à échéance dépassée | 🔴 rouge, sans nuance | `action_overdue` / `action_to_verify` selon `due_date_status` |
| Actions anciennes ≥ 14 j (sans échéance) | 🟠 orange | **absent** |
| Réserves ouvertes | 🔴 si ≥ 30 j (`created_at`) sinon 🟠 | `reserve_open`, high si > 15 j (`issued_on`) |
| Conflits de planning (clôtures) | 🔴 rouge | **absent** |
| Débriefs en attente (captures non triées) | 🟠 orange | **absent** |
| Fermés aujourd'hui | fait déclaré, non alarmé | **absent** |
| `site_deadlines` en retard | **absent** | `deadline_overdue` |
| Sujets stagnants / relations bloquantes | **absent** | `subject_stagnant`, `relation_blocking` |
| Signaux PV (non conforme, aggravé, réouvert, sans évolution) | **absent** | `pv_status`, `pv_stagnant` |
| Blocages déclarés | **absent** | `blocage_active` (critical) |
| Congestion acteur, propositions et relations à valider | **absent** | `actor_congestion`, `proposal_pending`, `link_suggested` |
| Portée | toute l'organisation, plafonné à 5 | un chantier, non plafonné |
| Déduplication | par chantier (agrégat) | par sujet canonique (le plus urgent gagne) |

**Conséquence de doctrine.** A n'est pas une version dégradée de B : c'est un moteur
**opérationnel** (actions, réserves, planning, captures) ; B est un moteur **de connaissance**
(sujets, PV, relations, blocages). L'énoncé de Vincent — « `deriveSiteAttentionItems` = vérité
métier de base, les autres surfaces filtrent, ne reconstruisent pas » — n'est aujourd'hui
réalisable que sur les **trois signaux communs** : actions en retard, actions anciennes,
réserves ouvertes. Les signaux de planning et de captures de A n'existent nulle part dans B et
devraient y descendre avant toute unification.

### D1 — Réserves : deux colonnes de date, pas seulement deux seuils

C'est **le** défaut de vérité de la Tranche 3.

| Chantier | Réserves ouvertes | Dates différentes | Classement contradictoire | Écart max |
|---|---|---|---|---|
| OCEF Compostage (`06c62e48`) | 17 | 17/17 | 17/17 | **+124 j** |
| OCEF6 | 15 | 15/15 | 15/15 | +106 j |
| OCEF Compostage (`2c939e67`) | 14 | 14/14 | 14/14 | +108 j |
| Ocef4 | 6 | 6/6 | 6/6 | +32 j |
| Petro Atiti — Reconstruction | 1 | 1/1 | 1/1 | +3 j |
| **Total** | **53** | **53/53** | **53/53** | |

A lit `site_reserve.created_at` — la date à laquelle la ligne est **entrée en base**.
B lit `site_reserve.issued_on` — la date à laquelle la réserve a été **émise sur le chantier**.

En régime terrain les deux coïncident presque (Petro Atiti : 28 j contre 31 j). En régime
import PV elles n'ont plus rien à voir : sur OCEF Compostage, A annonce
« la plus ancienne depuis **5 j** » alors que la plus ancienne réserve est ouverte depuis
**129 j**. Le nombre affiché est exact — il ne décrit simplement pas ce que le lecteur croit
lire. C'est très exactement la règle 8 : *« les formulations techniques ambiguës doivent être
remplacées par la date et la nature de la dernière preuve »*.

Le seuil (30 j chez A, 15/45 j chez B) est un désaccord de doctrine, discutable et secondaire.
La colonne de date est une **erreur de fait**, et elle se corrige sans toucher au moteur.

### D2 — Actions en retard : A affirme, B nuance

Sur **Petro Atiti — Reconstruction**, les 2 actions ouvertes à échéance dépassée ont
`due_date_status = null` : A les annonce « 2 actions en retard » en 🔴, B les classe
`action_to_verify` en `medium`. **2/2 divergentes.**

Sur **OCEF Compostage (`2c939e67`)**, les 7 actions ont une date confirmée : les deux moteurs
sont d'accord sur le fait, mais pas sur la gravité — A les met au niveau rouge (le plus haut),
B les met en `medium` (3ᵉ sur 4), car aucune ne dépasse 7 j de retard.

`describeOverdueAction()` porte déjà la prudence demandée (retour Guillaume, LOT4) : une date
déduite par l'IA et non confirmée n'est pas une preuve de retard. **A ne l'applique pas.**
Aucune action reportée (`snooze_reason`) ni aucune `kind='deadline'` n'a été trouvée dans
l'échantillon : ces deux risques théoriques ne sont pas matérialisés aujourd'hui.

### D3 / D4 — Les angles morts, mesurés

| Angle mort | Volume mesuré |
|---|---|
| A n'interroge jamais `site_deadlines` | 38 échéances affichées « en retard » invisibles sur l'accueil (18 + 16 + 3 + 1) |
| B n'a aucun équivalent des actions anciennes ≥ 14 j | jusqu'à 54 sur un seul chantier |
| B ne voit pas les captures non triées | 5 sur Lycée PETRO ATTITI, 4 sur OCEF |
| B ne voit pas les conflits de planning | non mesuré (détecteur partagé avec la vue Semaine) |

### Constat secondaire

`lib/knowledge/canonical-attention.ts` (`deriveCanonicalAttentionItems()`) existe et n'a
**aucun consommateur**. Un troisième moteur d'attention dort dans le dépôt. Noté, non traité.

---

## (B) Contradiction « échéance en retard » vs preuve terrain

### La garantie demandée est vérifiée

**Aucun code ne mute `site_deadlines.status` automatiquement.** Les cinq mutations de statut
vivent dans `lib/db/site-deadlines.ts` (l. 78-89, 133, 149, 174-182, 203) et ne sont appelées
que par des server actions gardées par rôle et organisation
(`app/(dashboard)/sites/[id]/views/planning/deadline-actions.ts`).
Deux écritures automatiques existent sur la table, et **aucune ne touche `status`** :
`lib/db/site-deadline-write.ts:72` pose `canonical_subject_id`, et
`app/(dashboard)/documents/[id]/extraction/[runId]/review-actions.ts:927` pose
`assigned_company_id` / `assigned_contact_id`. La doctrine 246 est intacte.

### Le read-model de contradiction serait vide aujourd'hui

Sur les **38 échéances affichées « en retard »** des chantiers PETRO et OCEF :

| Verdict de rapprochement | Nombre |
|---|---|
| Lien solide (`canonical_subject_id` partagé) | **0** |
| Lien lexical seul (Jaccard ≥ 0,34) | **0** |
| Aucune preuve postérieure trouvée | **38** |

La cause n'est pas l'absence de preuves : c'est l'absence de **pont**.

```
site_deadlines non supprimées, toute la base : 86 · avec canonical_subject_id :   2  (2 %)
site_actions ouvertes,        toute la base : 313 · avec canonical_subject_id :   2
```

La colonne du pont (migration 346) est posée mais **quasiment jamais renseignée**. Un
read-model de contradiction bâti sur `canonical_subject_id` produirait structurellement zéro
ligne. **Le construire maintenant serait construire une surface sur du vide.**

### Le cas exact cité par Vincent

Échéance `planned`, Lycée PETRO ATTITI : **« Démarrage du nettoyages », due 2026-08-17,
+6 j de retard, `canonical_subject_id = null`.**

Ce chantier porte 68 occurrences terrain toutes `field_checked`, dont 9 mentionnent le
nettoyage. Trois sont postérieures à la date due :

- 2026-08-18 — « Le test du nettoyeur haute pression avec le produit s'est avéré efficace »
- 2026-08-20 — « Le nettoyage de l'entre-toit de 50 cm au-dessus de la CF pâtisserie… »
- 2026-08-20 — « Le nettoyage de la plonge batterie et de la plonge stockage est en cours »

Un humain lit immédiatement que le nettoyage a démarré. Le rapprochement automatique, lui,
échoue — et **il a raison d'échouer** : « la plonge batterie est en cours » ne satisfait pas
« démarrage du nettoyages » dont la portée n'est pas définie. C'est mot pour mot l'objection
posée : *« Nettoyage légumerie démarré ne suffit pas automatiquement à satisfaire une échéance
générale démarrage du nettoyage si la portée est ambiguë. »*

L'audit confirme donc les deux volets de l'arbitrage : la contradiction est **réelle et
visible** (MemorIA affiche « en retard » un travail qui a commencé), et elle **ne peut pas**
être tranchée automatiquement.

### Forme recommandée si la Tranche 3B est ouverte un jour

Non implémentée. Contrat proposé, à valider avant tout code :

- lecture pure, aucun `status` écrit — la contradiction est un **affichage**, jamais un effet ;
- déclenchée uniquement sur lien **solide** (`canonical_subject_id` identique), jamais lexical ;
- rendu : ne pas supprimer « en retard », l'accompagner — « en retard depuis 6 j · un constat
  du 20/08 signale une activité sur ce sujet — à confirmer » ;
- une seule action humaine offerte, qui écrit le statut : *Réalisée* / *Replanifier* /
  *Toujours due* ;
- preuve terrain = **signal de contradiction** · humain = **confirmation** · humain seul =
  **clôture métier**.

**Pré-requis bloquant : le pont `canonical_subject_id` doit être alimenté** (2 % aujourd'hui).
Sans lui il n'y a rien à afficher.

---

## Recommandation de séquence

1. **Aligner la date des réserves (`issued_on`, repli sur `created_at`) dans le moteur A.**
   Défaut de fait, 53/53 objets concernés, correction locale, aucun moteur refondu. C'est de
   la Tranche 1 tardive, pas de la Tranche 3.
2. **Appliquer `describeOverdueAction()` dans le moteur A.** La prudence existe déjà et est
   testée ; A est la seule surface qui ne l'utilise pas.
3. **Alimenter le pont `canonical_subject_id`** sur `site_deadlines` et `site_actions`.
   Sans lui, ni le read-model de contradiction ni l'unification des moteurs ne sont possibles.
4. **Ensuite seulement**, envisager de faire descendre les signaux de planning et de captures
   dans B pour qu'il puisse devenir la vérité de base au sens plein.

Aucun de ces quatre points n'est engagé : ce document est un audit.
