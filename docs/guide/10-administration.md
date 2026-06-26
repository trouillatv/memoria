# 10 — Administration

> 📸 **Capture 1** : `/glossaire` (vue **admin** : champ d'ajout + bouton « Charger le vocabulaire » + liste avec corbeilles). Annotations : ① ajouter un terme · ② charger le vocabulaire de démarrage · ③ un terme (définition + alias + catégorie).
> 📸 **Capture 2** : `/glossaire` (vue **manager**, lecture seule) — mention « Consultable par tous ; l'édition est réservée aux administrateurs. »

## 🎯 Objectif
Gérer le **référentiel métier** et les réglages.

## 🕒 Quand l'utiliser
Au paramétrage, puis ponctuellement.

## 🔘 Les éléments clés
- **Glossaire métier** (`/glossaire`) — **consultable par tous**, **éditable par l'admin**. Chaque terme : définition + **alias** (variantes/fautes) + catégorie (document, engin, matériau, ouvrage, acteur…). Il sert deux choses :
  - **corriger les transcriptions** (« cofrage » → Coffrage, « d.o.e » → DOE) ;
  - **apprendre le vocabulaire à l'IA** (DOE = Dossier des Ouvrages Exécutés, chargé d'affaires, banche…).
- **Charger le vocabulaire de démarrage** — ~86 termes BTP/VRD/MOE/gros œuvre en un clic (idempotent).
- Autres réglages admin : utilisateurs, dépenses IA.

## 🧭 Parcours conseillé
Charger le vocabulaire de démarrage → l'adapter à votre métier (VRD, MOE, gros œuvre…) → ajouter vos termes maison et leurs alias.

## 💡 Conseils
Plus le glossaire est riche, mieux les transcriptions sont propres **et** mieux l'IA comprend vos réunions.

## ⚠️ Erreurs fréquentes
Un **manager** voit le glossaire mais ne peut pas l'éditer : c'est volontaire (référentiel partagé, sous contrôle admin).
