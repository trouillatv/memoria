# Script de démonstration — CAPSE NC
## MemorIA · Bureau d'études HSE / Audit / Inspection

*Durée : 12–15 minutes · Public : direction CAPSE + clients potentiels*
*Dernière mise à jour : 2026-07-24*

---

## Avant la présentation

### Préparer l'environnement

```bash
# Seeder les données CAPSE (une seule fois, ou relancer pour réinitialiser)
npx tsx scripts/dev/seed-capse-demo.ts --confirm-reset-on=<fragment-url> --yes
```

Connexion : `capse@memoria.nc` / `capse-memoria-2026!`

Ouvrir deux onglets :
- Onglet 1 : **Bureau** — `https://app.memoria.nc` (ou local)
- Onglet 2 : **Terrain** — même URL, barre latérale réduite

Vérifier que le compte `capse@memoria.nc` est connecté et que le dashboard affiche des données.

### Ce que la démo démontre (pas ce qu'elle promet)

La démo montre uniquement des fonctionnalités existantes et opérationnelles. Aucune capture d'écran future, aucun prototype.

---

## Vocabulaire de la démo

Ne pas utiliser le vocabulaire interne de MemorIA — utiliser celui de CAPSE.

| CAPSE dit | On dit en démo | Jamais |
|---|---|---|
| Mission d'inspection | "Mission" ou "chantier de mission" | "chantier de bâtiment" |
| Inspection terrain | "visite d'inspection" | "visite de chantier" |
| Constat / Non-conformité | "constat" ou "action corrective" | "action" seul (ambigu) |
| Réserve | "réserve" | — |
| Rapport d'inspection | "compte-rendu de visite" ou "rapport" | — |
| Intervenant / Tiers | "intervenant" ou "casting du site" | — |

---

## Parcours — 12 à 15 minutes

### Introduction (1 min)

> "MemorIA est la mémoire de vos missions. Aujourd'hui, je vous montre comment CAPSE pourrait suivre une mission HSE sur un site industriel à Ducos — de l'inspection terrain jusqu'au rapport — et retrouver six mois plus tard ce qui s'est passé, qui a décidé quoi, ce qui a été levé."

---

### 1. Le tableau de bord — ce qui mérite l'attention (2 min)

**Où :** Accueil (`/`)

Montrer la section **"Ce qui mérite votre attention aujourd'hui"** :

> "Dès la connexion, CAPSE voit ce qui ne peut pas attendre : une inspection prévue demain tombe sur un jour férié. Un détecteur incendie planifié est en retard. Des douches de sécurité à installer — délai proche."

Montrer les **Actions prioritaires** (colonne droite) :

> "Les constats les plus urgents, triés par délai. Pas besoin de fouiller — le système sait ce qui brûle."

Montrer la section **"Vos missions"** :

> "Quatre sites actifs. Pour chacun : combien d'actions en retard, combien de réserves ouvertes, dernière inspection. En 10 secondes, le responsable sait où regarder."

---

### 2. Le site vitrine — Atelier industriel Ducos (3 min)

**Où :** Cliquer sur "Atelier industriel — Zone Ducos"

**Onglet Actions :**

> "14 constats sur ce site. On voit tout : ce qui est levé, ce qui est planifié, ce qui reste ouvert. Chaque constat est rattaché à son inspection d'origine."

Cliquer sur une action ouverte (ex. "Installer les douches de sécurité secteur C") :

> "Ce constat est né de l'audit initial il y a 90 jours. On voit à qui il est affecté, la date limite, l'inspection d'origine. Un clic remonte jusqu'au rapport terrain."

**Onglet Réserves :**

> "Deux réserves. Une levée — la réserve sur les issues de secours, confirmée lors de l'inspection de contrôle il y a 7 jours. Une ouverte — les douches de sécurité, en cours."

**Capsules (onglet Mémoire) :**

> "Ce que tout inspecteur doit savoir avant d'entrer sur ce site. Badge niveau 2, EPI obligatoires bâtiment C, référent joignable. Pas dans un email — dans la mémoire du site."

---

### 3. L'inspection terrain — le cœur du produit (3 min)

**Où :** Onglet Visites → cliquer sur "Inspection de contrôle — levée des non-conformités critiques" (J-7)

Montrer la **liste des points vérifiés (watchlist)** :

> "L'inspecteur arrive avec sa liste de points à vérifier, prépopulée à partir des constats précédents. Chaque point est coché sur le terrain."

Montrer les **captures GPS** :

> "Chaque observation est géolocalisée au moment de la prise de note. On voit où dans le site, à quelle heure."

Montrer le **CR généré** (bouton PDF) :

> "Le rapport d'inspection est généré automatiquement depuis les notes terrain. En sortie de visite, le rapport existe. Pas de saisie à double."

---

### 4. Le casting — qui fait quoi (2 min)

**Où :** Onglet Casting (ou Intervenants) sur le site Ducos

> "Sur ce site : le Directeur HSE, la Responsable sécurité, l'inspecteur APAVE, le représentant CHSCT. Chaque action corrective est affectée à l'un d'eux."

Cliquer sur **Jean-Pierre Chauvin** (Directeur HSE) :

> "Sa fiche montre ses actions en cours, les décisions qu'il a portées, les constats sous sa responsabilité. Si dans 6 mois quelqu'un demande 'qui a décidé d'installer les douches ?', la réponse est là."

---

### 5. Les décisions de mission — la traçabilité (1 min)

**Où :** Onglet Décisions sur le site Ducos

> "Lors de l'audit initial, 4 décisions ont été prises. Chacune est reliée à son constat d'origine et à son responsable. Ce n'est pas un compte-rendu de réunion — c'est la mémoire causale : pourquoi on a décidé ça, qui a décidé, quelle action en découle."

---

### 6. Le planning — voir venir (1 min)

**Où :** Planning (`/planning`)

> "L'audit HSE mensuel est planifié. La réunion de suivi est dans 14 jours. Le contrôle extincteurs dans 3 semaines. Tout ce qui est programmé est visible — conflits détectés automatiquement si une inspection tombe un jour férié."

---

### 7. Le mobile terrain — la capture sans saisie (1 min)

**Où :** Passer en mode terrain (réduire la fenêtre ou ouvrir sur téléphone)

> "L'inspecteur arrive sur site avec son téléphone. Il note, photo, position GPS. En voiture au retour, il valide le rapport. Au bureau, le rapport est déjà là."

Si sur Android : montrer le **partage depuis la galerie photo** → l'image arrive directement dans MemorIA.

---

### 8. La recherche — retrouver en 10 secondes (1 min)

**Où :** Barre de recherche (⌘K)

Taper "douches sécurité" :

> "Retrouver ce qui a été dit sur les douches de sécurité — dans quel rapport, à quelle date, dans quel contexte. La mémoire interrogeable."

Taper "Élodie" :

> "Retrouver toutes les actions où Élodie Wénéhoua est mentionnée."

---

## Questions fréquentes à anticiper

**"On peut importer nos anciens rapports ?"**
> Oui — via l'import de documents. MemorIA les indexe et les rend cherchables. La migration peut se faire progressivement.

**"C'est quoi la différence avec un tableur partagé ?"**
> Le tableur n'a pas de mémoire : il dit ce qui est ouvert, pas pourquoi ça a été décidé, ni qui l'a validé. MemorIA lie le constat, la décision, le responsable et la preuve de levée.

**"Qui peut accéder à quoi ?"**
> CAPSE a son espace isolé. Chaque client n'accède qu'à ses propres données. Les rôles (manager, inspecteur) définissent ce qui est visible.

**"Le rapport est exportable en Word ?"**
> Oui — PDF et Word. Le template peut être adapté au format CAPSE.

**"On peut gérer plusieurs sites en même temps ?"**
> Oui — le dashboard agrège tous vos sites actifs. L'inspecteur voit ses missions du jour sur son téléphone.

---

## Ce qu'on ne montre pas

- La génération d'intelligence croisée (analyse entre plusieurs missions) — disponible mais pas au centre de cette démo
- L'import de documents techniques (plans, DUERP) — fonctionnel mais long à démontrer
- La configuration du planning récurrent — trop technique pour une présentation

---

## Fin de la démo

> "MemorIA n'est pas un logiciel de sécurité. C'est la mémoire de vos missions. Dans 6 mois, quand un client vous demande 'c'était quoi la NC sur les douches de sécurité chez Pacifique Industrie, et elle a été levée quand ?', vous avez la réponse en 10 secondes."

---

*Script produit le 2026-07-24 pour la présentation CAPSE NC de mardi.*
*Données de démo : `scripts/dev/seed-capse-demo.ts`*
