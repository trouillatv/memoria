# Le moat par effet de stack

> **Pourquoi MemorIA est défendable face à des concurrents qui auraient plus de moyens.**

**Date** : 2026-05-22
**Statut** : Analyse stratégique.

---

## La thèse

Le moat de MemorIA n'est **pas une feature isolée**. C'est la **composition** de plusieurs couches qui s'enrichissent mutuellement.

Un concurrent peut copier :
- Un dashboard
- Une checklist
- Un planning
- Un upload photo
- Un système de tags

Mais pour copier :
> *« Quand Sandrine part, Joseph récupère automatiquement ce qu'elle savait sur les 4 sites qu'elle couvrait, avec les consignes À savoir, les anomalies récentes filtrées par fraîcheur, les documents rattachés, les équipes voisines pour back-up, le tout dans un brief immuable partageable en QR code. »*

… il faut **tout le sous-jacent**. Pas une feature. Une **architecture**.

---

## Les 12 couches qui composent le moat

### Couches mémoire
1. **Mémoire terrain** (`trace_embeddings`) — notes, photos, anomalies embeddées
2. **Mémoire documentaire** (`documents` + `knowledge_chunks`) — CCTP, plans, protocoles
3. **Pont sémantique** (`cross_store_resonances`) — résonances entre terrain et docs, filtres AND obligatoires
4. **Mémoire commerciale** (AO précédents + outcomes + notes vocales)

### Couches d'organisation
5. **Hiérarchie** Contrat → Site → Mission → Intervention
6. **Équipes** comme conteneur logistique avec spécialités déclarées
7. **Engagements** liés aux missions (boucle de preuve)

### Couches de capture
8. **Mobile chef d'équipe** (`/m`) — checklist, photos, voice notes, anomalies
9. **À savoir** persistantes attachées aux sites
10. **Preuves d'accès** (clés/badges) pour audit

### Couches de transmission
11. **Briefs de passage de témoin** avec snapshot immuable
12. **Partage public** `/h/[token]` mobile-first + QR

---

## Pourquoi c'est inimitable rapidement

### Effet 1 — Compositionnel
Chaque couche prend du temps à construire **et** à enrichir. La mémoire terrain ne vaut rien à J+0 — elle vaut beaucoup à J+180. Un concurrent qui démarre aujourd'hui a 6 mois de retard **pour chaque site**.

### Effet 2 — Doctrinal
Les couches ne sont pas neutres. Elles obéissent à des doctrines : *« écho juste, pas vérité »*, *« silence positif »*, *« litige jamais lecture automatique »*. Un concurrent qui copie les features sans les doctrines produit **un système toxique** (briefs anxiogènes, faux positifs RH, hallucinations IA).

### Effet 3 — Architectural
Le passage de témoin (sprint C) interroge **8 tables différentes** en parallèle pour compiler un brief. Sans `team_members`, `interventions`, `site_notes`, `intervention_anomalies`, `documents`, `document_links`, `sites`, `contracts` — pas de brief possible.

Un concurrent qui n'a que 3 tables (typique d'une app planning) ne peut pas répliquer.

### Effet 4 — Temporel
Le **snapshot immuable** des briefs n'est pas juste un détail. C'est une **promesse juridique** : *« on peut prouver ce qu'on a transmis »*. Pour un concurrent qui démarre, il faut décider cette discipline dès J+0, sinon refonte coûteuse plus tard.

### Effet 5 — Culturel
La doctrine RH (pas de score, pas de comparaison) est **contre-intuitive** dans la tech moderne. Un concurrent VC-funded va naturellement vers le *« top performers dashboard »*. Il pensera que c'est sa différenciation. C'est précisément ce qui le **disqualifiera** dans les secteurs sensibles (nettoyage, sécurité, hôpital) où la perception flicage tue le projet.

---

## Les anti-moats à surveiller

### Anti-moat 1 — Un concurrent qui copie les surfaces visibles
Quelqu'un voit `/h/[token]` et fait pareil. Surface jolie, vide derrière. **Marche-t-il ?** Probablement pas pour des clients exigeants. Mais sur le marché PME peu averti, peut-être.

**Mitigation** : insister sur la **qualité du contenu** des briefs (filtre fraîcheur, sources, équipes voisines). Le concurrent qui copie la surface produira des briefs vides ou hallucinés.

### Anti-moat 2 — Un acteur sectoriel établi qui ajoute « de l'IA »
Un éditeur ERP nettoyage qui ajoute *« Maintenant avec IA »* sur son module existant. Crédibilité commerciale (ils ont déjà les clients), mais zéro doctrine et zéro architecture mémoire.

**Mitigation** : la doctrine n'est pas un retrofit. Les clients exigeants (qui finissent par dicter le marché) sauront distinguer.

### Anti-moat 3 — Un nouveau LLM qui fait *« tout en 1 prompt »*
Demain, on demande à GPT-7 *« compile-moi le brief de Joseph pour ces 4 sites »* avec accès Gmail/Drive, et il le fait. La doctrine **discipline coût IA** (async pré-calcul, pas LLM live) est-elle dépassée ?

**Mitigation** : MemorIA garde le contrôle de la **vérification humaine** (validation avant exposition), du **snapshot immuable** (preuve juridique), et de la **frontière doctrinale** (pas RH). Un LLM omniscient ne donne pas ces 3 propriétés gratuitement.

---

## Le moat humain

Au-delà du moat technique, il y a un moat **humain** :

- **Vincent** comprend SI/Data/IA + culture PME calédonienne + filiation bâtiment public
- **Guillaume** est un pilote bienveillant (cousin), donc on a du temps pour apprendre
- **La doctrine est écrite, datée, versionnée** — chaque collaborateur futur peut la lire et la respecter (mode d'emploi + EVOLUTION_CONCEPTUELLE + foundations)

Ces 3 éléments forment un **avantage de connaissance tacite** difficile à reproduire.

---

## Stratégie de défense

### À court terme (pilote, 6 mois)
- **Pas d'ouverture grand public** — pilote uniquement
- **Pas de blog technique** révélant la doctrine — la doctrine reste interne tant que le moat n'est pas mature
- **Pas de marketing « IA »** — *« continuité opérationnelle »* dans la com, jamais *« propulsé par GPT »*

### À moyen terme (post-pilote, 6-18 mois)
- **Annonce ciblée** dans des secteurs où la doctrine RH est cruciale (nettoyage syndiqué, hôpital, sécurité)
- **Témoignages pilotes** sur la **continuité** (« on a perdu personne mais on n'a rien perdu »)
- **Open-source des tripwires CI** comme signal de sérieux

### À long terme (18 mois+)
- **Plateforme partagée** entre plusieurs clients pour multiplier la mémoire commerciale cross-AO
- **Marketplace de spécialités** (équipes avec tag *« vitres-hauteur »* trouvables par AO)
- **Standard de fait** sur le format de brief de passation (comme PDF/A pour les archives)

---

## La phrase

> **MemorIA n'est pas une feature qui se copie. C'est une composition qui se construit dans le temps, sous une doctrine qui ne se retrofit pas.**

---

## Liens

- [Vision Produit](vision-produit.md) — le moat dans son contexte stratégique
- [Continuité opérationnelle](continuite-operationnelle.md) — la rupture qui révèle le moat
- [Passation](passation.md) — le révélateur du moat
- [Doctrine RH](doctrine-rh.md) — la doctrine non-retrofittable
- [Doctrine mémoire](doctrine-memoire.md) — les règles architecturales du moat
