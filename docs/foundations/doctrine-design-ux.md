# Doctrine Design UX — MemorIA

> **Chaque écran doit répondre à UNE question. Sinon, c'est du bruit premium.**

**Date** : 2026-05-22
**Statut** : Doctrine active, basée sur la conversation fondatrice ChatGPT 2025 + les apprentissages des sprints A-D.

---

## Les 6 questions du redesign

Issue directe du PDF fondateur ChatGPT 2025. Toute nouvelle interface ou refonte doit répondre à au moins une de ces questions :

1. **Est-ce que ça réduit la fatigue cognitive ?**
2. **Est-ce que ça fait émerger la mémoire au bon moment ?**
3. **Est-ce que Guillaume comprend plus vite ?**
4. **Est-ce que ça aide à gagner un AO ?**
5. **Est-ce que ça aide à gérer un site ?**
6. **Est-ce que ça aide à transmettre un contexte ?**

**Sinon** : *« c'est du bruit premium »*. Refus.

---

## Les patterns récurrents

### Hiérarchie de l'attention
- **Rouge MEDU (#C0392B)** réservé aux vigilances réelles (« AO à rendre dans les 7 jours », « interventions sans équipe »). Jamais utilisé en décoration.
- **Ambre** pour les transitions et alertes secondaires
- **Brand-600** pour les actions positives
- **Slate / Muted** pour le texte secondaire

### Silence positif
Quand il n'y a rien à dire, ne rien afficher. Pas de carte *« tout va bien »*. L'absence parle.

Exemples :
- Zone Vigilance vide sur le dashboard → on ne montre pas la zone du tout
- Aucune anomalie sur un brief → la section *« Anomalies »* n'apparaît pas
- Pas de fragment IA pertinent ce matin → pas de bandeau *« Ce que les lieux disent »*

### Précision >> Rappel
Mieux vaut 3 liens utiles que 30 liens vagues. Tous les matchers (résonances, briefs, recommandations) appliquent le critère [lien-utile-aide-a-agir](doctrine-memoire.md#4-lien-utile--aide-à-agir).

### Mobile-first absolu sur `/h/[token]`
Le brief partagé est lu sur un téléphone à 5h30 sous la lumière d'un parking. Tailles adaptatives, padding réduit, `touch-manipulation` sur les zones cliquables, sommaire cliquable si plusieurs sites.

### Audit visible côté admin
Toute consultation sensible (page Intervenants, briefs publics) génère un audit log que l'admin peut consulter. Le code peut être audité par l'utilisateur lui-même → traçabilité de l'usage.

---

## Le piège énorme à éviter

Issue du PDF fondateur :

> *« Tu es exactement le profil qui peut tomber dans : "Je génère 40 écrans IA magnifiques mais je n'améliore pas le produit." »*

Le vrai danger maintenant n'est plus technique. C'est :

- **Surcharge produit** — trop de features visibles
- **Dispersion UX** — chaque page raconte une histoire différente
- **Sophistication excessive** — animations / effets qui ralentissent
- **IA qui produit du joli mais pas du sens**

Antidote : la **discipline d'apparition** (cf. [doctrine-memoire.md](doctrine-memoire.md#6-la-discipline-dapparition-post-sprint-c)).

---

## Stack outils recommandée (PDF fondateur)

| Usage | Outil |
|---|---|
| Architecture / doctrine / logique | **Claude** (cette conversation) |
| Redesign écran par écran | **v0 by Vercel** (screenshots → React/Tailwind) |
| Intégration réelle | **Cursor / Claude Code** |
| Exploration produit globale | **Lovable** (« cockpit mémoire », « briefing matin ») |
| Sandbox / prototypes rapides | **Replit** |
| Design collaboratif mature | **Figma** (futur) |

Stratégie : screenshots actuels → prompt v0 *« Transform this industrial dashboard into a modern operational memory cockpit. Prioritize cognitive clarity, operational continuity, memory surfacing, hierarchy of alerts. Realistic for field managers, not startup flashy. »*

Puis intégration Claude Code.

---

## Les couleurs nommées (Tailwind whitelist)

Pour les badges d'équipe et autres éléments thématiques, on a une **whitelist explicite** (pas d'injection dynamique) :

- `sky` — bleu ciel
- `emerald` — vert émeraude
- `amber` — ambre
- `violet` — violet
- `rose` — rose
- `slate` — ardoise (fallback neutre)

Plus le format hex libre `#rrggbb` accepté côté `TeamBadge` depuis le sprint A (migration 077). 12 swatches préset anti-fluo proposés mais on accepte n'importe quel hex.

---

## Wording descriptif strict

### ✅ Wording autorisé
- *« Présence cumulée »*, *« interventions documentées »*, *« anomalies traitées »*
- *« Équipe Alpha »* (jamais « l'équipe de Mehdi »)
- *« A travaillé sur ce site »*
- *« 3 sites portent une mémoire opérationnelle »*

### ❌ Wording interdit
- *« Performant »*, *« productif »*, *« efficace »* appliqué à une personne
- *« Score »*, *« note »*, *« évaluation »*
- *« Top X »*, *« meilleur »*, *« moins bon »*
- *« Risque »*, *« critique »*, *« faible »* appliqué à une personne

Test simple : *« est-ce qu'un RH dirait ça dans un entretien annuel ? »* Si oui, refus.

---

## La règle des 3 variantes de badge

`TeamBadge` accepte 3 variantes (sprint A) :

- **`colored`** (défaut) — fond pâle + texte sombre + icône. Pour dashboard, Semaine, fiches.
- **`dot`** — point coloré + icône + nom. Pour cellules compactes.
- **`mono`** — pas de couleur, juste icône + nom. Pour impression N&B et daltoniens.

Le mode `mono` est explicitement pensé pour les **chefs d'équipe qui impriment le planning** et le distribuent en version papier.

---

## La règle des heures réelles

**Pas de notion de « créneau » dans l'UI.** Pas de *« Matin / Après-midi / Soir »*. Heure de prestation honnête (`06h30 – 08h00`) saisie au moment de la planification.

Cf. tripwire `planned-time-no-rh-aggregation.test.ts` qui interdit toute agrégation `planned_*` par `user_id`.

---

## L'index utile à instaurer

L'écran de pilotage de Guillaume doit, en un coup d'œil :

1. **Donner du calme** (silence positif quand rien à signaler)
2. **Avertir d'une urgence** (rouge MEDU en haut si vigilance)
3. **Inviter à agir** (boutons clairs, libellés en verbe d'action)
4. **Documenter sa propre activité** (compteurs cumulés en bas, sobre)
5. **Rendre la mémoire visible** (fragment IA si pertinent)

L'ordre des sections est important : urgent en haut, descriptif en bas, IA discret.

---

## Liens

- [Vision Produit](vision-produit.md) — le cadre stratégique
- [Doctrine mémoire](doctrine-memoire.md) — règles communes (silence positif, discipline d'apparition)
- [Doctrine RH](doctrine-rh.md) — frontière wording
- [Brief moment magique](../EVOLUTION_CONCEPTUELLE.md) — application au public `/h/[token]`
