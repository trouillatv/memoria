# Brief pour Claude Code — Faire ressembler le CR auto-généré au modèle BECIB

## 0. Le problème en une phrase

L'original (La Cravache / Mont-Dore) est un **gabarit maison habillé** rempli par une **rédaction narrative** ;
l'auto-généré (Extension Médipôle) est un **export de données brut** sans charte et avec un **plan de sections différent**.
On ne corrige pas ça en retouchant la sortie : il faut reconstruire un **gabarit réutilisable** et y verser les données.

---

## 1. Principe directeur (à imposer à Claude Code)

1. **Séparer le fond et la forme.** Les données du CR (intervenants, points, statuts, planning, photos…) vivent dans un
   modèle structuré (JSON). La présentation vit dans **un seul gabarit** réutilisable. On ne mélange jamais les deux.
2. **Le PDF original = source de vérité.** Toute décision de style (couleur, police, marge, tableau, bandeau, pied de page)
   se calque sur `LA_CRAVACHE_GDE_-_PV_03_du_31_10_25.pdf`, pas sur des suppositions.
3. **Itérer en comparant page à page.** Générer → rendre en PDF → comparer visuellement à l'original → corriger l'écart.
   Répéter jusqu'à correspondance.

---

## 2. Ce qu'il faut donner à Claude Code (entrées)

- `LA_CRAVACHE_GDE_-_PV_03_du_31_10_25.pdf` → **référence de style et de structure** (le « gold standard »).
- `cr-chantier_test.pdf` → **l'entrée à transformer** (les données actuellement produites).
- Ce brief.
- Le **logo BECIB** en vectoriel (SVG/PDF) et les logos clients (ex. Ville du Mont-Dore) — sinon, les extraire en
  haute résolution du PDF original.

---

## 3. Choix technique recommandé

Pour ce niveau de fidélité de mise en page, par ordre de préférence :

- **HTML + CSS → PDF** via **WeasyPrint** (Python) ou **Puppeteer/Playwright** (Node). Idéal : CSS `@page` gère
  en-têtes/pieds répétés, numéros de page, sauts de page. Charte facile à régler au pixel.
- **LaTeX** si l'équipe est à l'aise (très bon pour les tableaux et la pagination, plus rigide à itérer).
- **DOCX** (python-docx + modèle .dotx) **uniquement** si la sortie doit rester éditable dans Word — fidélité visuelle
  plus difficile à garantir.

Recommandation : **HTML/CSS → WeasyPrint**, avec les données en **JSON**.

---

## 4. Spécification de mise en page (la charte à reproduire)

> Faire échantillonner par Claude Code les **couleurs et polices exactes** depuis l'original ; les valeurs ci-dessous
> sont des points de départ à valider.

### En-tête (toutes pages)
- Ligne de fil d'Ariane en haut : `Mairie du MONT-DORE / BECIB / LA CRAVACHE GDE / CR réunion de chantier`
  + cartouche `Numéro DNS | Version | Modification : ordre | Date`.
- **Logo BECIB** en haut à gauche (marque carrée colorée + « BECIB » + baseline « MAÎTRISE D'ŒUVRE INGÉNIERIE CONSEIL /
  Infrastructures, Aménagement, Paysage »).
- Page 1 uniquement : **logo client** centré (ex. Ville du Mont-Dore).

### Bloc-titre (page 1)
- **Encadré** à bordure bleu marine : titre projet en **gras MAJUSCULES centré**.
- Sous le cadre : `COMPTE-RENDU N°xx DE LA REUNION DE CHANTIER` + `Du <date> - semaine <n>`, centré, souligné.

### Bandeaux de section (2 niveaux)
- **Niveau 1** (sections numérotées : 1 INTERVENANTS, 4 POINTS EXAMINES, 5 AVANCEMENT, 6 SECURITE, 7 PHOTOS) :
  rectangle plein **bleu marine**, numéro à gauche, **titre blanc gras MAJUSCULES**, **filet rouge** en accent,
  petit marqueur pointillé à l'extrême gauche.
- **Niveau 2** (AVANCEMENT, INTEMPERIES/ALEAS, PLANNING) : rectangle **gris clair**, texte marine, filet rouge.
- **Sous-titres internes** (TRAVAUX PRELIMINAIRES…, TERRASSEMENTS GENERAUX, ASSAINISSEMENT, DIVERS, FAIT, PREVISIONS) :
  petites **capitales soulignées** marine.

### Tableaux
- **Intervenants** : lignes groupées par rôle (MAITRISE D'OUVRAGE, MAITRISE D'ŒUVRE, ENTREPRISE TITULAIRE, PARTENAIRES) ;
  colonnes `Représentant | Tél. | Mob. | Fax/e-mail | I | P | AE | AN | D` avec croix `X` ;
  ligne de légende au-dessus `(I : Invité - P : Présent – AE : Absent excusé – AN : Absent non excusé – D : diffusion)`.
- **Points examinés** : structure **deux colonnes** → gauche `POINTS`, droite `ACTION` (codes responsables).
  En-têtes de bloc gris (`POINTS ADMINISTRATIFS | ACTION`, `POINTS TECHNIQUES | ACTION`).
- **Planning** : tableau à bandes de couleur — `MARCHE` (noir), `INTEMPERIES` (bleu), `PROLONGATIONS` (vert),
  `RETARD` (rouge), valeurs dans la couleur de la bande.

### Listes
- Puces **chevron `>`** pour les points techniques (pas de puces rondes).
- **Gras** sur les engagements/décisions clés et les statuts importants.

### Pied de page (toutes pages)
- Fil d'Ariane en **italique gris** + cartouche `Numéro DNS | Version | Modification : ordre | Date`.
- **Pastille ronde bleu marine** en bas à droite avec le **numéro de page** + `/ <total>`.

### Fin de document
- Encadré centré **PROCHAINE REUNION** (date/heure/lieu en gras).
- Signature alignée à droite : `POUR BECIB, <auteur>`.

### Repères couleur (à confirmer par échantillonnage)
- Marine bandeaux ≈ `#1F2A5A`–`#2E3192` · Accent rouge ≈ `#E2001A` · Gris sous-bande ≈ `#D9D9D9`
- Planning : bleu ≈ `#0070C0` · vert ≈ `#00B050` · rouge ≈ `#C00000`
- Police corps : sans-serif type Arial/Liberation Sans (à vérifier).

---

## 5. Structure documentaire imposée (l'ordre BECIB)

Le générateur doit **mapper les données** vers cette trame, pas l'inverse :

1. **INTERVENANTS** — tableau avec présence I/P/AE/AN/D.
2. **ORDRE DU JOUR**.
3. **REMARQUES SUR CR PRECEDENT** + NOTA des 48 h.
4. **POINTS EXAMINES**
   - *Points administratifs* : Contrat, Sous-traitance, MOA (situations de travaux)…
   - *Points techniques* : Travaux préliminaires / Essais-Contrôle / DOE ; Terrassements généraux ; Assainissement ; Divers.
5. **AVANCEMENT, PLANNING** — Avancement (Fait / Prévisions) ; Intempéries-Aléas ; tableau Planning (Marché/Intempéries/Prolongations/Retard).
6. **SECURITE, ENVIRONNEMENT** — checklist de rappels.
7. **PHOTOS** — grille légendée.
8. **PROCHAINE REUNION** + signature.

> Les blocs de l'auto-généré (« Suivi de la réunion précédente », « Décisions proposées », « Actions à faire »,
> « Réserves / points bloquants ») doivent être **repliés** dans cette trame : les actions/décisions deviennent des points
> dans la bonne rubrique avec leur statut et leur responsable ; les réserves vont dans le suivi/les remarques.

---

## 6. Règles rédactionnelles (la « pensée », pas seulement la forme)

C'est ici que les deux documents diffèrent le plus. Chaque **point** doit être rédigé, pas listé :

- **Phrase professionnelle complète** qui consigne l'observation **ou** la décision, avec le **contexte et le motif**
  quand c'est utile (« le MOE rappelle que l'état de surface a été validé par le club et la mairie le 24/10… »).
- **Tracer qui dit/demande quoi et ce qui est décidé** (« l'exploitant demande… = ce n'est pas possible car… »).
- Terminer par un **statut** : `= fait` / `= OK` / `= en cours` / `= à faire` / `= en attente` / `= attente décision`.
- Renseigner la **colonne ACTION** avec le ou les responsables (codes, ex. `ETV`, `MOA`, `MOE`, `CLUB`, `FSH`,
  combinaisons `ETV/MOA`).
- Utiliser les formules de cadrage maison : **« Pour mémoire »**, **« Pour rappel »**, **« De manière générale »**.
- **Gras** sur les engagements, décisions, dates et conditions déterminantes.
- Ton **neutre, factuel, décisionnel** ; pas de style télégraphique à puces sèches.

---

## 7. Glossaire / terminologie à respecter

Imposer un **lexique cohérent** (et un fichier glossaire que le générateur réutilise) :

- **Acteurs** : MOA (maîtrise d'ouvrage), MOE (maîtrise d'œuvre), ETV (entreprise titulaire), FSH (responsable Sécurité
  et Hygiène), CLUB/exploitant.
- **Documents** : PAQ, DOE, DQE, DNS (n° de document), OS (ordre de service).
- **Technique VRD/terrassement** : GNT (grave non traitée), C1B3, scorie, enrobé/bicouche, TN (terrain naturel),
  BV (bassin versant), cunette, fossé, exutoire, paddock, carrière, reprofilage, nivellement.
- **Sécurité** : EPI, PTAC, balisage, blindage de tranchée.
- **Local** : contexte Nouvelle-Calédonie (code de la route NC, etc.).

Règle : utiliser les sigles **sans les réexpliquer à chaque fois**, comme dans l'original.

---

## 8. Méthode de travail pour Claude Code

1. Lire l'original page par page et **inventorier** : couleurs (échantillonnées), polices, marges, structure des
   tableaux, en-tête/pied, pastille de page.
2. Construire le **gabarit** (HTML/CSS) + un **modèle de données JSON** couvrant toutes les sections du §5.
3. Écrire la **fonction de mapping** : données auto-générées → JSON du gabarit (en repliant les blocs hors-trame du §5).
4. Rendre un PDF de test et le **comparer côte à côte** à l'original — corriger chaque écart visuel et structurel.
5. Boucler jusqu'à conformité avec la **checklist** ci-dessous.

---

## 9. Checklist de conformité (à cocher avant livraison)

- [ ] En-tête répété : fil d'Ariane + cartouche DNS, logo BECIB, logo client en p.1.
- [ ] Bloc-titre encadré + sous-titre `COMPTE-RENDU N°xx` souligné.
- [ ] Bandeaux niveau 1 (marine/blanc/filet rouge) et niveau 2 (gris) corrects.
- [ ] Sous-titres internes en petites capitales soulignées.
- [ ] Tableau intervenants avec colonnes de présence I/P/AE/AN/D + légende.
- [ ] Points examinés en 2 colonnes (POINTS / ACTION) avec codes responsables.
- [ ] Statuts `= fait/OK/en cours/à faire` en fin de point.
- [ ] Rédaction narrative avec motifs, « Pour mémoire / Pour rappel », gras sur les décisions.
- [ ] Tableau planning à bandes colorées (Marché/Intempéries/Prolongations/Retard).
- [ ] Section sécurité-environnement en checklist chevron.
- [ ] Photos légendées en grille.
- [ ] Encadré « Prochaine réunion » + signature « POUR BECIB, … ».
- [ ] Pied de page répété : fil d'Ariane italique + cartouche + pastille `n / total`.
- [ ] Lexique/sigles cohérents avec le glossaire.

---

## 10. Prompt prêt à coller dans Claude Code

```
Contexte : je fournis deux PDF. « LA_CRAVACHE_GDE_-_PV_03_du_31_10_25.pdf » est le MODÈLE DE RÉFÉRENCE
(charte et structure de mon bureau d'études BECIB). « cr-chantier_test.pdf » est un compte-rendu
auto-généré dont la mise en forme et le plan ne correspondent PAS au modèle. Le fichier
« brief_claude_code_CR_BECIB.md » décrit la cible en détail.

Objectif : créer un générateur réutilisable qui produit des comptes-rendus de chantier
visuellement et structurellement identiques au modèle de référence.

Contraintes :
1. Sépare les données (JSON) et la présentation (UN gabarit réutilisable).
2. Le PDF de référence fait foi pour TOUTE décision de style : échantillonne les couleurs et
   identifie les polices, marges, tableaux, en-tête/pied de page et pastille de numéro de page
   dans l'original — ne devine pas.
3. Pile technique : HTML + CSS rendu en PDF avec WeasyPrint (ou Puppeteer). Utilise CSS @page
   pour l'en-tête/pied répétés et la numérotation. Données en JSON.
4. Respecte la trame de sections imposée (§5 du brief) et REPLIE les blocs de l'auto-généré
   (Suivi / Décisions / Actions / Réserves) dans cette trame.
5. Rédige chaque point en phrase narrative complète, avec motif, statut final (= fait/OK/en cours/à faire)
   et responsable en colonne ACTION ; utilise le glossaire et les sigles du brief sans les réexpliquer.

Méthode : (a) inventaire de l'original, (b) gabarit + modèle JSON, (c) fonction de mapping
auto-généré → JSON, (d) rendu PDF de test comparé page à page à l'original, (e) itère jusqu'à
cocher toute la checklist §9 du brief.

Livrables : le gabarit, le schéma JSON, la fonction de mapping, un exemple rempli, et un PDF de
démonstration reproduisant le modèle. Commence par l'inventaire de l'original et propose-moi le
schéma JSON avant de coder le rendu.
```
