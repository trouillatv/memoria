# 08 — Audit métier : les écrans et leurs verbes

> Audit 2026-07-13 sur les 23 écrans réels (titres, sections, CTA lus dans le code).
> Doctrine : Réunion=décider · Intervention=exécuter · Visite=observer ·
> Mission=organiser · Planning=coordonner · Action=engager.
> Cadrage : 9 écrans sont des hubs/sélecteurs (accueil, chantiers, dashboard, sites,
> clients, documents, équipes, mémoire, recherche) — pas de verbe unique attendu.

## Fiches (Verbe · Objectif · Décision · Ensuite)

### Mobile

| Écran | Verbe | Objectif | Décision prise | Ensuite |
|---|---|---|---|---|
| `/m` accueil | hub (assumé) | « qu'est-ce que je fais maintenant ? » | par où je commence | intervention / chantier / journal / actions |
| `/m/chantiers` | sélecteur | choisir où travailler | quel chantier | `/m/site/[id]` |
| `/m/site/[siteId]` | **mélange lourd** | comprendre l'état, se préparer, démarrer | visiter maintenant ? que savoir avant ? | visite active, CR, actions, sous-pages |
| `/m/visite/[id]` | observer → trier | débrief express en voiture (temps 2) | « ça mérite une suite ? » par capture | récap, clôture `/cr?done=1` |
| `/m/visite/[id]/recap` | observer (relire) | trace complète durable | aucune (consulter, partager) | CR, partage |
| `/m/visite/[id]/cr` | **mélange** vérifier + clore | vérifier le CR, récupérer le PDF | le CR est-il correct ? | retour chantier, modifier, PDF |
| `/m/reunion/[id]` | décider **amputé** | consulter les décisions | **aucune** — lecture seule, renvoi « au bureau » (lien inerte) | retour chantier |
| `/m/intervention/[id]` | **exécuter ✅** | réaliser la mission du jour | démarrer / cocher / signaler / terminer / annuler / décaler | retour `/m` |
| `/m/actions` | **engager ✅** | suivre les points dans le temps | quelle action suivre/clôturer | retour contexte |
| `/m/planning` Journal | **coordonner ✅** | le fil de ma journée | quel événement je lance | visite / intervention / réunion / action |

### Desktop

| Écran | Verbe | Objectif | Décision prise | Ensuite |
|---|---|---|---|---|
| `/dashboard` | hub (assumé) | ce qui mérite l'œil ce matin | vers quoi aller regarder (il POINTE) | sites, AO, continuité, interventions |
| `/sites` | sélecteur | retrouver/gérer les sites par client | quel site ouvrir/créer | `/sites/[id]` |
| `/sites/[id]` | **mélange lourd** (AGIR = 3 verbes en 3 boutons) | comprendre et piloter un chantier | quoi faire ici | visite/CR/action/mémoire/hub |
| `/semaine` | **coordonner ✅** | couverture site×jour | qui va où, quand | missions, création, export |
| `/missions` | organiser… **ton « surveiller »** | santé des cadres récurrents | quelle mission corriger | édition, `/sites/[id]` |
| `/meetings` | **décider ✅** | retrouver/piloter les réunions | laquelle ouvrir/créer | `/meetings/[id]` |
| `/meetings/[id]` | **décider ✅** (cœur) | réunion → décisions, actions, PV | valider, assigner, finaliser | PV validation, briefing |
| `/equipes` | config | composer les équipes | qui appartient où | (implicite : semaine) |
| `/clients` | sélecteur | retrouver un client | lequel ouvrir/créer | `/clients/[id]` |
| `/briefing` | **coordonner** (demain) | préparer/transmettre la couverture | qui couvre quoi demain | semaine, envois |
| `/documents` | consultation | ranger/consulter | où ranger, lequel ouvrir | import, `/documents/[id]` |
| `/memoire` | interroger | question à la mémoire d'entreprise | aucune | traces/sites cités |
| `/recherche` | retrouver | mot-clé sur interventions | aucune | intervention, site |

## Les 5 incohérences les plus coûteuses pour un nouvel utilisateur

1. **« Visite » ne mène pas à la visite en cours.** `/m/visite/[id]` est le débrief
   express ; la visite ACTIVE (collecte) est le `VisitBasket` caché dans
   `/m/site/[siteId]`. Chercher « ma visite en cours » sous *visite* échoue.
2. **L'action n'a pas de source de vérité.** Le même geste existe sur ~8 surfaces
   sous 4 noms (`À reprendre`, `Actions ouvertes`, `Mission du jour`, `Actions à ne
   pas oublier`). Où clôturer « pour de bon » ?
3. **Réunion en cerveau coupé.** On peut LANCER un CR sur mobile, mais
   `/m/reunion/[id]` est une impasse lecture seule avec un chemin `/meetings/{id}`
   inerte « à consulter au bureau ». Le verbe décider est amputé sur le terrain
   sans le dire.
4. **Trois façons d'interroger le passé, trois langages** : `/memoire` (sémantique
   entreprise), `/recherche` (mot-clé interventions), `SiteMemoryQuery` (par
   chantier). Un débutant ne sait pas laquelle fait quoi.
5. **Agendas de coordination dupliqués.** Mobile : carte `Aujourd'hui` de `/m`
   double le Journal. Desktop : `/dashboard` / `/semaine` / `/briefing` répondent
   tous à « qui fait quoi » — quelle page est la base ?

## Tensions secondaires

- `/missions` : verbe *organiser* mais langage *surveiller* (« Priorité du jour »,
  « critiques », santé rouge/orange/vert) — en contradiction de ton avec `/semaine`
  et `/equipes` (« on organise, on ne mesure pas »).
- `/m/visite/[id]/cr` mélange vérification du CR et clôture (`?done=1`).
- `/m/site` importe des composants **depuis le dossier dashboard**
  (SiteMemoryQuery, SiteBriefButton) — les deux hubs chantier divergent de
  vocabulaire (`Ajouter…`/`Aujourd'hui ici` vs `AGIR`/`CONSULTER`).

## Usage de ce document

Ces incohérences ne sont PAS des lots de la vague adoption (sauf recoupements déjà
couverts : n°1 partiellement adressé par la clarification des intentions, n°2 par
la doctrine actions existante). Elles nourrissent les chantiers de conception —
chaque correction d'écran devra d'abord répondre : *quel est son verbe ?*
