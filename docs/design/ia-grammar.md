# Grammaire IA — MemorIA

> Ce document définit le langage visuel et textuel des lectures IA.
> Toute nouvelle surface IA doit respecter ce cadre.
> La grammaire prime sur les envies d'enrichissement.

---

## Principe fondateur

**Le système observe plus qu'il ne parle.**

Quand il parle, le cerveau humain doit comprendre immédiatement :
"ce n'est pas du remplissage."

---

## Principe de pertinence contextuelle

**L'IA ne juge pas l'importance. Elle situe le signal dans le présent.**

| Interdit | Autorisé |
|---|---|
| "critique", "urgent", "important" | "revient", "déjà observé", "non documenté" |
| Score, priorité, niveau d'alerte | "au planning aujourd'hui", "prévu ce matin" |
| Verdict sur la gravité | Lien factuel au planning du jour |

Le fragment dit **ce que l'IA observe** (passé, mémoire).
Le context dit **pourquoi c'est pertinent maintenant** (présent, planning).
L'humain décide. L'IA ne décide pas.

```
entrée nord absente depuis 7 semaines    ← fragment (observation passée)
au planning aujourd'hui                  ← context (lien au présent)
```

La ligne `context` n'est jamais une alerte. C'est une mise en relation factuelle.
Si aucun signal ne concerne le planning du jour → pas de `context`, signal de fond uniquement.

---

## La cognition card — `<ReadingCard />`

Composant unique. Une seule couleur. Toutes les surfaces.

```tsx
<ReadingCard
  fragment="bloc B revient malgré 2 interventions"
  frags={["janvier", "mars", "avril"]}  // sous-fragments optionnels
  compact={false}                        // true sur mobile
  label="Mémoire du lieu"               // optionnel, surface-specific
/>
```

### Identité visuelle

| Élément       | Token CSS              | Rendu                             |
|---------------|------------------------|-----------------------------------|
| Bordure gauche | `reading-border/40`   | indigo désaturé, 40% opacité      |
| Fond           | `reading-bg/[0.05]`   | indigo très transparent, 5%       |
| Label micro    | `reading-label/65`    | indigo texte, 65% opacité         |
| Animation      | `fade-in-0 duration-500` | apparition douce, 500ms          |

Modifiable en un seul endroit : `app/globals.css` → `--reading-border`, `--reading-bg`, `--reading-label`.

---

## Labels par surface

| Surface            | Label section          | Label par card | Règle supplémentaire              |
|--------------------|------------------------|---------------|-----------------------------------|
| Cockpit site       | "Lecture du lieu"      | aucun         | Axe géré par SiteReadingsList     |
| Mobile chef `/m`   | aucun                  | aucun         | compact=true, max 2 fragments     |
| Rapport client `/p`| "Mémoire du lieu"      | aucun         | max 3 textes, string[] seulement  |
| Dashboard matin    | "Ce que les lieux disent" | aucun      | 1 fragment tenant-wide (futur)    |
| AO / Atelier IA    | "Résonances détectées" | aucun         | futur                             |
| Transmission équipe| "Avant vous"           | aucun         | futur                             |

**Règle** : le label est toujours au niveau section, jamais sur chaque carte.

---

## Vocabulaire autorisé

Ces mots sont un langage produit propriétaire. Ils ne se démodent pas.

```
Lecture du lieu      Résonance        Persistance
Transmission         Absence          Mémoire du lieu
Mémoire active       Trace            Fragment
Signal faible        Continuité       Avant vous
```

### Vocabulaire interdit

```
AI Insight           AI Generated     Smart Analysis
Recommandation       Alerte           Score
Résumé IA            Détection        Intelligence
```

---

## Hiérarchie des axes

Les axes ne sont pas égaux. Ordre de priorité d'apparition :

1. **Transmission** — pertinent pour la passation d'équipe, affiché en tête
2. **Résonance** — deux traces qui s'écrivent à l'identique
3. **Persistance** — motif qui revient malgré le traitement
4. **Absence** — mission sans trace d'exécution depuis N semaines

---

## Règles d'écriture des fragments

Un fragment IA = une observation factuelle, courte, sans verdict.

| ✅ Autorisé                                 | ❌ Interdit                                    |
|--------------------------------------------|------------------------------------------------|
| `bloc B — évoqué en octobre, puis en avril` | `bloc B semble poser un problème récurrent`   |
| `accès parking est — note de février`       | `L'équipe précédente recommande l'accès est`  |
| `nettoyage vitrages absent depuis 7 sem.`   | `Les vitrages n'ont pas été nettoyés`         |
| `Fuite signalée à 3 reprises depuis mars`   | `Problème non résolu — action requise`        |

**Longueur max recommandée** : 80 caractères pour le fragment principal.
**Longueur max sous-fragments** : 30 caractères chacun, 6 max.

---

## Quand NE PAS utiliser ReadingCard

- Pour des états opérationnels (tâche cochée, mission exécutée)
- Pour des erreurs ou avertissements système
- Pour des informations que Guillaume peut voir lui-même en scrollant
- Pour du texte généré par LLM non validé par un humain

**Test de légitimité** : "Guillaume aurait-il pu voir ça seul en parcourant les données brutes ?"
Si oui → ne pas afficher. Si non → afficher.

---

## Plafonds stricts

| Surface              | Max ReadingCards |
|----------------------|-----------------|
| Cockpit site         | 6 (toutes lectures) |
| Mobile chef          | 2               |
| Rapport client       | 3               |
| Dashboard matin      | 1 (tenant-wide) |

**Le silence est une information.** Zéro card = le lieu ne signal rien d'émergent.
Jamais de fallback "tout va bien" ou "aucune anomalie détectée".

---

## Règle opérationnelle

> Une lecture IA ne doit jamais empêcher une décision opérationnelle.

Guillaume doit toujours pouvoir agir, planifier, corriger en moins de 5 secondes.
La ReadingCard enrichit — elle ne bloque pas.
