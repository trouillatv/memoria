# Parcours d'Émeline — du chantier au PV diffusé (audit UX)

But : cartographier le parcours réel **de bout en bout**, et chasser les **clics inutiles**. À ce stade, l'UX prime sur le prochain détecteur IA.

---

## Le parcours, étape par étape (état actuel du code)

```
┌─ TERRAIN ──────────────────────────────────────────────────────────────┐
│ 0. La réunion existe (capturée : voix/notes → mémoire structurée)        │
└──────────────────────────────────────────────────────────────────────────┘
            │  Émeline ouvre  /meetings/[id]
            ▼
┌─ 1. RÉUNION (/meetings/[id]) ───────────────────────────────────────────┐
│ Panneau « Compte-rendu de chantier » :                                   │
│   [Points à confirmer] [Aperçu PDF] [DOCX éditable] [Valider le PV]       │
│   Historique documentaire : PV validé · versions finales                 │
└──────────────────────────────────────────────────────────────────────────┘
   │ clic « Points à confirmer »          (→ nouvelle page)
   ▼
┌─ 2. VALIDATION (/meetings/[id]/pv/validation) ──────────────────────────┐
│ Bandeau : « N à traiter — … · Corriger maintenant · ≈ X min »            │
│ 🔴 bloquants → [Compléter] champ [Enregistrer]   (écrit la MÉMOIRE)       │
│ 🟠 importants · points examinés/prévisions → [Exclure] (parasites)       │
│ Contenu qui ira dans le PV (par section)                                 │
└──────────────────────────────────────────────────────────────────────────┘
   │ clic « Réunion » (retour arrière)    ← DÉTOUR (voir Finding A)
   ▼
┌─ 3. APERÇU PDF (/pv, nouvel onglet) ────────────────────────────────────┐
│ Relit le CR (trame Chantier v1, identité de l'org)                       │
└──────────────────────────────────────────────────────────────────────────┘
   │ ferme l'onglet · clic « DOCX éditable » (/pv?format=docx, nouvel onglet)
   ▼
┌─ 4. CORRECTION (hors MemorIA — Word) ───────────────────────────────────┐
│ Retouche ~15 % : formulation, ajout d'une remarque, correction d'un nom  │
└──────────────────────────────────────────────────────────────────────────┘
   │ revient sur la réunion · (saisit une note) · clic « Téléverser »
   ▼
┌─ 5. VERSION FINALE (POST /pv/final → v1, v2…) ──────────────────────────┐
│ Le doc final est archivé comme PREUVE (versionné, jamais écrasé)         │
└──────────────────────────────────────────────────────────────────────────┘
   │ (hors MemorIA)
   ▼
┌─ 6. DIFFUSION (Outlook) ────────────────────────────────────────────────┐
│ Envoi aux intervenants. La note de diffusion garde « envoyé à … »        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Comptage des clics (chemin nominal, hors corrections individuelles)

| # | Action | Clics | Changement de contexte |
|---|---|---|---|
| 1 | Ouvrir la réunion | 1 | page |
| 2 | « Points à confirmer » | 1 | **nouvelle page** |
| – | Corriger chaque bloquant | 3/bloquant (Compléter → saisir → Enregistrer) | inline |
| – | Revenir à la réunion | 1 | **retour arrière** |
| 3 | « Aperçu PDF » | 1 | **nouvel onglet** |
| 4 | « DOCX éditable » | 1 | **nouvel onglet + téléchargement** |
| 5 | (corriger dans Word) | — | **app externe** |
| 6 | Téléverser la version finale | 2 (bouton → sélection fichier) | inline |
| 7 | Diffuser | — | **Outlook** |

---

## Clics inutiles & frictions (par priorité)

### 🔴 Finding A — Le va-et-vient réunion ↔ validation (P0)
La validation est une **page séparée**. Après avoir corrigé, Émeline doit **revenir en arrière** sur la réunion pour télécharger/valider. Or l'écran de validation est l'endroit où elle « finit » le CR.
→ **Reco** : porter les actions de sortie **sur l'écran de validation** (Aperçu PDF · DOCX · Valider) — pied de page « Tout est prêt → générer ». Elle ne rebondit plus.

### 🔴 Finding B — « Valider le PV » a un rôle ambigu (P0)
Aujourd'hui : « Valider » archive le **PDF généré**. Mais le document qui compte est la **version finale téléversée**. Émeline risque de se demander « je valide avant ou après avoir corrigé le DOCX ? ».
→ **Reco** : clarifier deux gestes distincts et nommés :
- **« Figer le CR »** (snapshot du généré, optionnel) ;
- **« Version finale diffusée »** (le doc réellement envoyé = la preuve).
Ou : supprimer « Valider » du chemin nominal et ne garder que *préparer → télécharger → téléverser final*. À trancher avec toi.

### 🟠 Finding C — Pas de chemin linéaire lisible (P1)
Le panneau aligne 4 boutons de même poids (Points à confirmer / Aperçu / DOCX / Valider). Aucun ne dit « commence ici ».
→ **Reco** : un parcours **numéroté** : ① Vérifier (points à confirmer) → ② Relire (PDF) → ③ Corriger (DOCX) → ④ Téléverser le final. Le bouton primaire change selon l'état.

### 🟠 Finding D — Deux téléchargements séparés (PDF puis DOCX) (P1)
Elle relit en PDF, puis re-télécharge en DOCX. Deux gestes pour « voir puis éditer ».
→ **Reco** : sur l'aperçu PDF, un bouton « Modifier (DOCX) » ; ou un seul bouton « Préparer le CR » qui ouvre l'aperçu avec l'action d'édition à côté.

### 🟢 Finding E — Note de diffusion détachée du fichier (P2)
La note se tape avant de choisir le fichier ; deux champs sans lien visuel.
→ **Reco** : au téléversement, une mini-fiche « Version finale » : fichier + note + (futur) destinataires, validés ensemble.

### 🟢 Finding F — Diffusion Outlook hors boucle (P2, futur)
Après le téléversement, rien ne capture « envoyé à qui ». La note le permet manuellement.
→ **Reco (futur)** : bouton « Marquer comme diffusé » + destinataires ; intégration Outlook plus tard (hors MVP).

---

## Ce que je NE toucherais pas (déjà bon)

- La doctrine « corriger la mémoire, pas le document ».
- Le versioning des versions finales (preuve conservée).
- La trame unique déterministe + identité de l'org.

---

## Ordre de traitement proposé

1. **Finding A + C** : refondre le panneau/validation en **un parcours linéaire** (le plus gros gain ressenti, zéro nouveau concept).
2. **Finding B** : clarifier « Valider » vs « Version finale » (décision produit — à trancher avec toi).
3. **D, E** : raffinements.
4. **F** : diffusion/Outlook — plus tard.

> Principe : Émeline doit pouvoir aller de la réunion au PV diffusé **sans jamais se demander « où je clique maintenant ? »**.
