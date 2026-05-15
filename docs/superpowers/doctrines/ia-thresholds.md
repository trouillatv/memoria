# Doctrine IA — Seuils et déclencheurs

> Les seuils SONT l'IA. Pas le modèle, pas l'interface.
> Un seuil mal calibré produit du bruit. Un seuil juste produit de la perception.

---

## ABSENCE

**Définition** : une mission qui n'a plus de trace d'exécution depuis un certain temps.

**Déclenchement actuel** : ≥ 4 semaines sans `executed_at` (valeur initiale, à calibrer terrain)

**Déclenchement cible (après calibration)** :
- ≥ 6 semaines sans `executed_at`
- ET au minimum 3 exécutions historiques avant le silence (évite les faux positifs sur sites récents)

**Wording interne** (chef, DG) : `${missionName} — absent depuis ${n} semaines`
**Wording externe** (client) : `${missionName} — non documentée depuis ${n} semaines`

**Exclusions impératives** :
- Missions en cours d'exécution aujourd'hui (exclure par `missionName`)
- Mission affichée dans le dossier de preuves courant (exclure par `excludeMissionName`)
- Sites sans historique (< 3 traces totales)

**Surfaces concernées** :
- Site cockpit (`SiteReadingsList`, axe "Absences")
- Mobile chef (`/m`, max 2 fragments)
- Rapport client `/p/[token]` (max 1 fragment, wording externe)

---

## PERSISTANCE

**Définition** : un motif qui revient malgré le temps — anomalie similaire à une passée, mots récurrents dans les notes.

**Déclenchement cible** :
- ≥ 3 anomalies portant des mots proches (similarité textuelle ou token overlap ≥ 60 %)
- ≥ 2 résolutions intermédiaires (preuve que le problème a été "traité" mais est revenu)
- Fenêtre temporelle : sur les 6 derniers mois

**Wording** : factuel, passif, sans verdict.
- ✅ `Fuite signalée à trois reprises depuis mars`
- ❌ `Problème récurrent non résolu` (verdict interdit)

**Surfaces** : Site cockpit uniquement (Guillaume). Pas en mobile, pas en rapport client.

---

## RÉSONANCE

**Définition** : deux traces distinctes dans le temps qui se font écho — même mot, même lieu nommé, même motif.

**Déclenchement cible** :
- Similarité forte entre deux traces (token overlap ≥ 70 %, ou pgvector cosine > 0.65 note→anomalie / > 0.92 anomalie→anomalie)
- Minimum 14 jours entre les deux traces (pas une répétition immédiate)
- Maximum 6 mois d'écart (au-delà : mémoire froide, pas résonance)

**Wording** : "écho", factuel, sans lien causal implicite.
- ✅ `"vestiaires" — évoqué en octobre, puis en janvier`
- ❌ `Ces deux événements sont liés` (causalité interdite)

**Surfaces** : Site cockpit uniquement.

---

## TRANSMISSION

**Définition** : note laissée par une équipe précédente au bénéfice de celle qui reprend le site.

**Déclenchement** : présence d'un prédécesseur dans `human_continuity` + notes ou `a_savoir` récents datant de sa période.

**Wording** : attribution minimale, sans glorification ni dépréciation.
- ✅ `Note laissée en février : accès par le parking est`
- ❌ `L'équipe précédente recommande…` (recommandation interdite)

**Surfaces** : Site cockpit uniquement, en tête (pertinent pour la passation).

---

## Règles transversales

### Plafonds stricts
| Surface | Max fragments |
|---|---|
| Site cockpit | 6 (toutes lectures confondues) |
| Mobile chef `/m` | 2 (absences seulement) |
| Rapport client `/p/[token]` | 1 (absence, wording externe) |
| Dashboard matin | 1 (tenant-wide, meilleur signal) |

### Silence positif
- Si aucun seuil n'est franchi → ne rien afficher. Jamais de fallback "tout est calme".
- L'absence de lecture EST une information : le lieu ne signal rien d'émergent.

### Rareté = force
- Multiplier les lectures sur une surface les dévalue toutes.
- Un fragment vu une fois par semaine a plus d'impact qu'un feed quotidien.

### Wording interdit
- Adjectifs évaluatifs : "calme", "actif", "problématique", "satisfaisant"
- Recommandations : "envisagez de…", "il faudrait…"
- Causalité implicite : "ceci explique…", "suite à…"
- Pronoms agents : "l'équipe a négligé…", "le chef n'a pas…"

---

## Calibration terrain (PHASE 3)

Ces seuils sont des hypothèses de départ. La calibration réelle vient du terrain.

**Questions à observer avec Guillaume, Joseph, Sylvie** :
- Guillaume regarde-t-il les lectures ? Les ignore-t-il ?
- Quel fragment crée un arrêt, une réflexion, une réaction ?
- Joseph lit-il les fragments mobiles ou les ignore-t-il complètement ?
- Sylvie (client) réagit-elle à "non documentée depuis 3 semaines" ?

**Ajustements probables après calibration** :
- `ABSENCE_WEEKS` : actuellement 4, probablement 6-8 en production
- Minimum de traces historiques : à définir empiriquement
- Fenêtre de résonance : 14j-6mois à vérifier avec données réelles

**Le code actuel** (`lib/ai/site-readings.ts`, `lib/db/site-cockpit.ts`) est conçu pour
que ces seuils soient des constantes modifiables — jamais dispersés dans la logique.

---

## Feuille de route IA

| Phase | Quoi | Quand |
|---|---|---|
| Phase 1 (actuel) | Absences d'exécution (déterministe, SQL) | ✅ Déployé |
| Phase 2 | Embeddings pgvector (résonance + persistance sémantique) | Après calibration Phase 3 |
| Phase 3 | Calibration terrain (seuils ajustés par observation) | Pilote AGP |
| Phase 4+ | LLM interprète discret (jamais chatbot) | Plus tard seulement |
