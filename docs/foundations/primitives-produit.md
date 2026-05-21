# Les 7 primitives produit de MemorIA

> **MemorIA n'a pas 5 piliers. MemorIA a 7 primitives recomposables.**
>
> Le vrai actif réutilisable cross-secteurs.

**Date du cadrage** : 2026-05-22 (post-livraison sprints A → E)
**Statut** : Cadrage majeur. À matérialiser progressivement dans la structure code.

---

## L'observation

Jusque-là on disait *« 5 piliers + 3 axes »* (cf. [vision-produit.md](vision-produit.md)). Le cadrage tenait mais ne disait pas **ce qui se réutilise**.

Le vrai pattern, à l'observation du code livré (sprints A → E + tout l'historique B documents) :

> MemorIA est une bibliothèque de **7 mécaniques** qui savent quoi faire avec de la mémoire opérationnelle.

Chacune des 7 est **portable**. Elles se recomposent sur n'importe quel substrat métier où des humains opèrent des lieux qu'ils ne possèdent pas.

---

## Les 7 primitives

| Primitive | Mécanisme implémenté | Réutilisable dans |
|---|---|---|
| **1. Mémoire** | Artefact brut jamais supprimé + embedding (`trace_embeddings`, `documents`, `knowledge_chunks`) | Tout système qui capture du terrain |
| **2. Oubli** | Décroissance temporelle (cutoff 90j) + résolution humaine (`resolved_at`, `resolved_by`) + supersession (`supersedes_document_id`) | Tout système qui accumule sans tri |
| **3. Transmission** | Snapshot JSONB immuable (`handover_briefs.payload`) + URL publique sans login (`/h/[token]`) + audit silencieux (`access_count`) | Tout système où des humains se succèdent |
| **4. Récence** | `formatRelativeLong` + cutoff 90j + atténuation visuelle des artefacts anciens + tri par récence | Toute UI temporelle |
| **5. Passation** | `handover_briefs` réactifs (Sprint C) + anticipés (Sprint E `contract_end_date` → `/continuite`) | Toute bascule entre humains |
| **6. Limites humaines** | Discipline d'apparition + silence positif + écho juste + jury 4 classes + grille 6D (cf. [qualité d'apparition](qualite-dapparition.md)) | Tout système IA qui surface du contenu |
| **7. Garde-fous** | Tripwires CI (`forbidden-symbols.test.ts`) + allowlists confinées (`lib/db/intervenants.ts`, `lib/db/continuity.ts`) + kill switches ENV (`INTERVENANTS_PAGE_ENABLED`, `CONTINUITY_PAGE_ENABLED`) | Tout système qui touche à des zones sensibles |

---

## Pourquoi c'est l'actif réel

L'actif n'est **pas** :
- La mémoire terrain en elle-même (chaque client a la sienne, on ne la possède pas)
- Les dashboards (copiables)
- Les modèles IA (commodity)
- Les embeddings (commodity)

L'actif **est** :
- **Les 7 mécaniques qui savent quoi faire avec la mémoire**

Et leur composition. **Plus on enrichit une primitive, plus le passage de témoin (et tout le reste) s'enrichit automatiquement.** Compositionnel.

---

## Implication pour le pitch

Au lieu de :

> *« MemorIA est un SaaS de mémoire opérationnelle pour le nettoyage. »*

On peut dire :

> *« MemorIA est une bibliothèque de 7 primitives de continuité cognitive opérationnelle, validée d'abord sur le secteur nettoyage. »*

C'est un **récit produit plus ambitieux** et **plus défendable** — il échappe au piège du SaaS sectoriel.

---

## Implication architecturale (à matérialiser)

À long terme, la structure `lib/` devrait refléter les 7 primitives :

```
lib/
  memoire/       (existe partiellement via lib/db/site-memory.ts, à consolider)
  oubli/         (sprint D — à extraire de lib/db/handover.ts et lib/format.ts)
  transmission/  (sprint C — handover_briefs)
  recence/       (à extraire de lib/format.ts)
  passation/     (sprint C + E)
  limites-humaines/  (discipline-d'apparition — pas encore code, juste doctrine)
  garde-fous/    (lib/audit/log.ts + lib/intervenants/access.ts + lib/continuity/access.ts)
```

Avantages d'une telle refonte :
- Tests dédiés par primitive
- Documentation foundations dédiée par primitive
- Possibilité d'ouvrir certaines primitives en library open-source dans 12 mois (l'oubli structuré, le snapshot immuable, le silence positif…)
- Réutilisation cross-secteur sans copier-coller

**Pas urgent**, mais à garder en tête à chaque refactor.

---

## Implication pour la roadmap

Plutôt que de penser *« quelle prochaine feature »*, demander :
- **Quelle primitive devrait être enrichie ?**
- **Quelle composition de primitives résout un nouveau problème terrain ?**

Exemple concret : Sprint E (continuité anticipée) = composition de **Passation** + **Limites humaines** (test 4 questions) + **Garde-fous** (5 verrous CI). Pas une nouvelle primitive, une **nouvelle composition** des existantes.

Cette discipline force à ne pas multiplier les primitives sans raison.

---

## Liens

- [Vision Produit](vision-produit.md) — le cadre stratégique
- [Doctrine de la mémoire](doctrine-memoire.md) — règles de la primitive Mémoire
- [Continuité opérationnelle](continuite-operationnelle.md) — où les primitives se composent
- [Moat par effet de stack](moat-stack-effect.md) — chaque primitive est portable, mais leur composition est unique
- [Qualité d'apparition (grille 6D)](qualite-dapparition.md) — primitive « Limites humaines » en détail
- [Risque deux morts opposées](risque-deux-morts-opposees.md) — guide de calibration entre primitives
