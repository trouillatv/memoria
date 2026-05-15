# Mémoire assistée — Doctrine MemorIA

> Ce document définit le concept central qui gouverne toute évolution IA dans MemorIA.
> Il prime sur toute décision d'implémentation voice / OCR / vision.

---

## Le concept

**Mémoire assistée** : l'IA aide à condenser le réel en mémoire exploitable.

Ce n'est pas :
- de l'automatisation ;
- du remplacement humain ;
- de l'IA autonome ;
- un chatbot terrain.

C'est :
- capturer ce que le terrain produit naturellement (voix, photos, documents) ;
- en extraire les fragments qui méritent d'être mémorisés ;
- laisser l'humain décider ce qui entre dans la mémoire canonique.

---

## Règle fondamentale — l'artefact brut ne disparaît jamais

C'est la règle la plus importante de l'architecture IA MemorIA.

| Surface | Artefact brut conservé | Couche IA | Couche humaine |
|---|---|---|---|
| Voice | MP3 original | transcription + extraction entités | correction + validation |
| OCR | PDF original + pages | texte extrait + entités structurées | sélection fragments utiles |
| Vision | photo brute | suggestions (2-4 max) | confirmation ou refus |

**Pourquoi cette règle est critique :**
- La transcription peut être fausse (bruit, accent, jargon).
- L'OCR d'aujourd'hui sera amélioré demain — le PDF original permet la réanalyse.
- La vision hallucine. L'humain corrige. La mémoire enregistre le choix humain, pas la détection IA.

---

## Flux universel — les 3 couches

```
artefact brut (MP3 / PDF / photo)
    ↓
extraction IA (transcription / OCR / vision)
    ↓
validation humaine  ← jamais court-circuiter
    ↓
fragment mémoire → embeddings → Résonances / Persistances
```

**Jamais :** artefact → IA → mémoire écrite automatiquement.
**Toujours :** IA propose une lecture. L'humain confirme le réel.

---

## Ce que MemorIA stocke

Pour chaque surface, 4 objets distincts :

**Voice**
1. MP3 original
2. Transcription brute
3. Corrections humaines
4. Fragments mémoire extraits et validés

**OCR**
1. PDF original
2. Texte OCR
3. Entités structurées extraites (dates, critères, pénalités, volumes)
4. Fragments sélectionnés par l'humain

**Vision**
1. Photo brute
2. Suggestions IA (formulées faiblement — "je vois peut-être…")
3. Ce que l'humain a validé
4. Ce que l'humain a refusé (aussi important)

---

## Formulation IA — règles de langage

La vision hallucine. L'IA doit toujours formuler en **posture faible**.

| ❌ Interdit | ✅ Autorisé |
|---|---|
| `moisissure détectée` | `zone sombre visible près du plafond — confirmer ?` |
| `anomalie plomberie créée` | `je vois peut-être une trace d'humidité` |
| `IA confidence 87%` | `éléments potentiels détectés` |
| `rapport généré automatiquement` | `3 points extraits — valider ?` |

Ces règles s'appliquent aussi à voice et OCR.
La transcription n'affirme pas le réel. Elle propose une lecture.

---

## Les 3 surfaces — rôle dans MemorIA

### Voice note terrain

**Rôle** : capturer les signaux faibles que le terrain ne saisit jamais par écrit.

Le terrain parle. Il n'écrit pas. L'audio capture :
- le contexte spontané ;
- les hésitations (signal en soi) ;
- les détails improvisés ;
- les récurrences mentionnées oralement.

**Ce que MemorIA en fait** : condensation mémoire, pas transcription.

```
Joseph dit : "le bloc B ça recommence encore derrière le lavabo
              mais c'est moins fort que la dernière fois"

IA propose : • bloc B revient
             • zone lavabo

Mémoire enregistre : ce que Joseph valide.
```

Limite : 30 sec terrain / 2 min manager.

### OCR documents / AO

**Rôle** : transformer les documents impossibles en mémoire structurée et relationnelle.

Niveau 1 — extraction structurée : dates, critères, pénalités, volumes, assurances, fréquence.
Niveau 2 — mémoire relationnelle : "ce critère apparaît déjà dans l'AO OPT 2025."

Le document original reste toujours accessible. L'OCR est une interprétation, jamais la source.

### Vision photo

**Rôle** : relier les traces visuelles à la mémoire existante du lieu.

Plus tardif — le plus puissant sur le long terme, le plus dangereux si précipité.

Cas fort : photo mars (humidité) → photo mai (trace similaire) → IA propose de relier aux deux.
Cas à éviter : création automatique d'anomalie depuis une photo.

---

## Ce que MemorIA n'est pas

Ces 3 surfaces ne servent pas à "faire de l'IA spectaculaire".

Elles servent à enrichir la mémoire opérationnelle.

MemorIA n'est pas :
- un chatbot terrain ;
- un système de surveillance ;
- un transcripteur audio ;
- un OCR-as-a-service ;
- un détecteur d'anomalies automatique.

MemorIA est :
- un système qui transforme des artefacts terrain en mémoire exploitable.

---

## Ce qui différencie vraiment

Un concurrent peut copier : OCR, Whisper, GPT-4V, embeddings.

Il ne peut pas copier facilement :
- la doctrine mémoire / relation / transmission ;
- la règle des 3 couches ;
- la posture "l'IA propose, l'humain décide" ancrée partout ;
- la continuité temporelle des artefacts bruts.

**La différence n'est pas l'IA. C'est ce que l'IA révèle du réel.**

---

## Ordre de build

| Phase | Surface | Condition |
|---|---|---|
| Phase 1 | Voice note terrain + transcription + extraction | Maintenant |
| Phase 1 | OCR AO + extraction structurée | Maintenant |
| Phase 2 | Embeddings audio/texte + résonances cross-audio | Après pilote |
| Phase 2 | OCR mémoire relationnelle (liens AO → AO) | Après pilote |
| Phase 3 | Vision photo + suggestions faibles + validation | Post-pilote terrain éprouvé |
| Phase 3 | Continuité visuelle temporelle ("déjà vu ici") | Plus tard |
