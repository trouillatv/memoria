# Roadmap AO — MemorIA

> **L'AO n'est pas un module parmi d'autres. C'est le ROI le plus immédiat du produit.**

**Date** : 2026-05-22
**Statut** : 1ʳᵉ couche livrée (sprint A1-A6 + B documents). Niveau 2 et 3 différés.

---

## Pourquoi l'AO est central

Le PDF fondateur de 2025 le dit explicitement :

> *« La machine à répondre aux appels d'offre — c'est probablement le ROI le plus immédiat. »*

Constat sectoriel :
- La plupart des PME nettoyage / facility / sécurité **copient-collent** d'anciens dossiers
- **Bricolent Word** dans l'urgence
- **Oublient des pièces** obligatoires
- **Produisent des réponses génériques** sans capitaliser sur l'expérience
- **Perdent souvent de l'argent** en gagnant des AO sous-chiffrés

MemorIA transforme cette posture en **système semi-industriel** :

- **Vitesse** : on récupère et adapte plutôt que de réécrire
- **Standardisation** : composants réutilisables (mémoire commerciale, fiches techniques, CV agents)
- **Réutilisation intelligente** : l'IA assemble depuis la mémoire accumulée

---

## Les 3 couches

### Couche 1 — Lecture & analyse AO *(livré)*

**Upload** : PDF (CCTP, RC, BPU) → OCR si scan

**Analyse automatique en 3 phases** :
1. **Lecteur AO** : synthèse, contraintes, risques, checklist
2. **Mémoire technique** : génération d'un brouillon exploitable
3. **Scoring d'opportunité** (interne, 0-100, jamais exposé directement)

**Sources documentaires cliquables** sous la synthèse et l'analyse détaillée. Si un document de type `litige` est cité, signalisation explicite + avertissement consultation prudente.

**Capital client** : pour chaque AO, on affiche factuel sur le client donneur d'ordre :
- Nombre d'interventions documentées
- Sites couverts
- Contrats actifs ou passés
- Anomalies traitées
- Photos déposées
- Documents archivés

C'est *du factuel descriptif*, jamais du scoring du client.

**Bandeau dashboard** : « AO à rendre dans les 7 jours » avec décompte + lien direct.

**Widget Pipeline** : 3 chiffres compacts (Actifs / À rendre / Gagnés ce mois) cliquables.

### Couche 2 — Atelier IA conversationnel *(livré, sous-visible)*

Cf. [atelier-ia.md](atelier-ia.md) pour le détail des 6 agents.

Permet au manager de **challenger son propre dossier** avant soumission :
- *« Pourquoi un client choisirait un concurrent à nous ? »*
- *« Quelle est ma plus grosse faiblesse financière ? »*
- *« Que dit le contradicteur de cette mémoire technique ? »*

C'est ce qui sépare une réponse correcte d'une réponse gagnante.

### Couche 3 — Mémoire commerciale capitalisée *(en construction)*

Chaque AO clôturé alimente une mémoire qui ressort **automatiquement avant** la rédaction du suivant.

**Composants** :

- **Outcome** : `won` / `lost` / `withdrawn` / `not_responded` + raison libre + tag (`prix` / `qualite` / `relation` / `timing` / `autre`)
- **Note vocale de closing** (recommandé, 1 minute) — *« sur quoi on a parié, qu'est-ce qui était tendu, qu'est-ce que je sens »*. Ressortie sur AO similaire futur.
- **Embeddings** des AO précédents pour matching sémantique
- **Filtres AND** anti-faux liens : `document_links` + `document_type` (couples autorisés) + `target_type` + `source_domain`

Doctrine : **pas de moteur d'hallucinations automatiques**. Cf. [sprint-b1-b2.md](sprint-b1-b2.md) pour le détail technique.

---

## Le wedge stratégique : la note vocale du closing

> *« Personne ne fait ça. C'est la signature MemorIA. »*

Juste après dépôt d'un AO, le manager enregistre **1 minute** de voix qui dit :
- Sur quoi il a parié
- Qu'est-ce qui était tendu
- Qu'est-ce qu'il sent (intuition pure, jamais demandée par ailleurs)

Cette note vocale est :
- Transcrite automatiquement (Gemini)
- Embeddée
- Reliée à l'AO et à son outcome
- Ressortie sur le **prochain AO similaire** (du même client OU du même type de prestation)

Pourquoi c'est puissant : la mémoire commerciale d'une PME est essentiellement dans la tête du dirigeant. Personne ne la formalise. MemorIA la capte au moment où elle est encore fraîche (post-dépôt, avant qu'on passe à autre chose).

---

## Le contexte AO / dossier vivant

Avant chaque réponse AO, MemorIA assemble un **dossier vivant** en 5 blocs :

1. **Capital client** — interventions, sites, anomalies, photos sur ce client
2. **AO similaires précédents** — gagnés ET perdus, avec outcomes
3. **Documents utiles** — protocoles, certifications, fiches techniques pertinents
4. **Équipes pressenties** — équipes ayant les spécialités requises (matcher AO)
5. **Risques signalés** — par le Contradicteur et le Financier

C'est le bloc le plus différenciant — *« assembler la mémoire utile au moment où l'AO arrive »* — pas un résumé client générique.

Cf. memory `contexte-ao-dossier-vivant`.

---

## Refus doctrinaux

L'AO n'est **pas** :
- ❌ un générateur automatique qui répond tout seul
- ❌ un système qui décide de soumettre ou pas
- ❌ un outil de scoring du client (« ce client est-il bien »)
- ❌ un assistant qui négocie le prix tout seul

L'AO **est** :
- ✅ un système qui prépare un dossier 5× plus vite avec 3× plus de pertinence
- ✅ un dispositif qui force la confrontation interne avant la soumission externe
- ✅ une mémoire qui capitalise sur l'expérience (note vocale + outcome + embeddings)

---

## Métriques à suivre (pilote)

- **Délai moyen de réponse AO** (mesure d'efficacité)
- **Taux de soumission** (combien d'AO commencés sont effectivement déposés)
- **Taux de gain** (won / total)
- **Marge moyenne** des contrats gagnés (vérifier que Contrôleur financier protège)
- **Note vocale captée %** (signe que la doctrine est appliquée)
- **AO similaire ressorti %** (utilisation de la mémoire commerciale)

---

## Items roadmap résiduels

### AO-1 (livré 2026-05) — 4 livrables
- ✅ Bandeau AO ≤7j sur dashboard
- ✅ Widget Pipeline AO
- ✅ Sources [doc:id] cliquables dans analyses
- ✅ Capital client factuel

### AO-2 (différé) — Atelier IA visible
- Réhausser l'atelier sur le dashboard
- 3 idées WOW :
  1. Contradicteur permanent en arrière-plan
  2. Agent Terrain auto branché sur anomalies
  3. Préparation finale (PDF prêt à envoyer)

### AO-3 (futur) — Pré-qualification
- Détection précoce des AO non rentables (Contrôleur financier en amont)
- Recommandation « ne pas répondre » avec raison documentée

---

## Liens

- [Atelier IA](atelier-ia.md) — les 6 agents en détail
- [Vision Produit](vision-produit.md) — l'AO comme pilier 5
- [Sprint B1/B2](sprint-b1-b2.md) — mémoire documentaire qui nourrit les AO
- [Doctrine mémoire](doctrine-memoire.md) — règles communes
