# Pilote terrain Phase 3 mobile — prep handoff

**Date prep** : 2026-05-11
**Cible** : 3 chefs d'équipe réels, 3 sites différents, 3-5 jours ouvrés
**But** : valider l'usage de l'app `/m` en conditions réelles avant Phase 5/7+

## Avant de lancer le pilote — checklist

### Devices
- [ ] 3 smartphones agent (Android ≥10 ou iOS ≥15) — peut être leur device perso
- [ ] Tester l'install web (Safari/Chrome → "Ajouter à l'écran d'accueil")
- [ ] Stocker la photo 5-10 fois pour vérifier que IndexedDB tient
- [ ] Tester mode avion pendant 30 secondes — vérifier que la queue retient

### Comptes / accès
- [ ] 1 manager test (toi probablement)
- [ ] 3 chefs d'équipe : créer comptes via `/admin/users` avec rôle `chef_equipe`
- [ ] Distribuer login + mdp temporaire en main propre (pas par mail)
- [ ] Chaque chef change son mdp au premier login (`must_change_password`)

### Données
- [ ] 1 contrat réel par agent (peut être un contrat actuellement en cours)
- [ ] Sites + missions créés dans ce contrat
- [ ] **Ajouter chaque chef d'équipe dans `missions.default_team[]`** des missions
  qu'il doit voir (sinon il ne verra rien — limitation documentée, cf. migration
  `018_field_mvp.sql`)
- [ ] 1-2 récurrences par mission pour avoir des interventions chaque jour
- [ ] Lancer `npm run db:push` puis recharger `/m` côté agent

### Avant J0
- [ ] 10 minutes de présentation in-person avec chaque agent : montrer 5 gestes
  essentiels (login → liste missions → ouvrir intervention → photo → terminer)
- [ ] Donner un canal de feedback simple : WhatsApp / SMS / appel
- [ ] Convenir d'un check-in 18h chaque jour (5 min : "ça s'est passé comment ?")

## 5 gestes à enseigner

1. **Se connecter** : taper login + mdp, changer mdp au 1er login
2. **Voir mes missions** : `/m` → liste du jour
3. **Démarrer une intervention** : tap sur une mission → bouton "Démarrer"
4. **Prendre une photo** : appareil natif s'ouvre → capturer → revenir à l'app
5. **Terminer** : tap "Terminer l'intervention"

Pas plus. Si tu enseignes 8 gestes, l'agent en retient 3.

## Scénarios à observer (sans coller à l'agent)

### Scénario 1 — Journée normale
- L'agent ouvre l'app le matin
- Il fait son rythme normal
- À 18h, check-in : combien d'interventions terminées ? combien de photos prises ?
- Compare à ce que dit le dashboard côté manager

### Scénario 2 — Anomalie
- L'agent rencontre un problème (équipement HS, accès bloqué, salle non propre)
- Il appuie sur "Signaler une anomalie" pendant l'intervention
- Décrit + photo
- Vérifier que ça remonte côté manager

### Scénario 3 — Réseau dégradé
- L'agent travaille dans un parking souterrain ou une salle blindée
- Il prend 5 photos sans réseau
- Sortir, rentrer dans la couverture
- Vérifier que les photos remontent (sync indicator vert) sans intervention manuelle
- Tap sur le sync indicator → sheet "Mes photos en attente" si applicable

### Scénario 4 — "Pas aujourd'hui"
- Une intervention récurrente ne peut pas être faite (jour férié, salle inaccessible)
- L'agent appuie "Pas aujourd'hui" → raison libre
- Vérifier que l'intervention reste visible grisée

## Métriques à mesurer

### Objectives (mesurables)
- % d'interventions terminées vs planifiées (cible > 80% sur la semaine)
- Photos par intervention (cible > 3 en moyenne)
- Temps moyen entre `started_at` et `completed_at` (sanity check : pas 5 min, pas 4h)
- Sync queue : nombre de photos avec attempts > 0 (cible < 5% du total)
- Anomalies levées / résolues

### Subjectives (entretiens 1-1 à J5)
- "Sur 10, à quel point l'app t'a-t-elle aidé ?"
- "Quelle est la chose la plus pénible ?"
- "Qu'est-ce qui te fait perdre du temps ?"
- "Tu utiliserais l'app au quotidien si on déployait ?"
- "Tu as eu peur que tes photos se perdent ? Quand ?"

## Comment recueillir le feedback

Pendant le pilote :
- Carnet papier pour chaque agent (5 lignes par jour : "ce qui a marché / ce qui m'a fait râler")
- WhatsApp pour les bugs urgents

Après le pilote (J5 ou J6) :
- Entretien 30 min chacun, en présentiel ou visio
- Demander : "raconte-moi ta semaine avec MemorIA"

## Risques connus à surveiller

1. **Chef_equipe pas dans `default_team`** → ne voit pas ses interventions générées.
   Si ça arrive, ajouter via `/admin` ou SQL direct sur `missions.default_team[]`.
2. **Photo queue avec 50+ photos** → l'UI sheet devient lourde. Si ça arrive,
   le backoff exponential prend le relais (1h max entre tentatives) mais l'agent
   peut être anxieux. Le rassurer : ses photos sont en sécurité localement (IndexedDB).
3. **Login expiré (Supabase 1h)** → l'agent doit re-logger. Doit être indolore.

## Après le pilote

Plan de relecture J6-J7 :
- Lister les 3 frictions les plus mentionnées
- Décider : (a) fix avant rollout, (b) accepter comme dette, (c) feature en V2
- Si > 30% d'interventions ratent → ne PAS rollouter, itérer.
- Si > 80% d'interventions OK et zéro bug bloquant → décider date de rollout.

## Doctrine pendant le pilote

- **N'observe pas en mode flicage.** Tu observes l'app, pas l'agent.
- **Anonymise les retours** quand tu partages des observations en interne.
- **Le silence d'un agent n'est pas un succès** — s'il dit rien, il n'utilise probablement pas.
