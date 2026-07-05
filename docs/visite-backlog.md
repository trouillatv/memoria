# Visite terrain — backlog (idées non bloquantes)

Idées validées « à faire un jour » mais volontairement mises de côté : on veut
d'abord que Guillaume **vive avec MemorIA 1 à 2 semaines** pour laisser émerger
les vrais irritants (gestes répétitifs, clics inutiles, infos qui manquent au
quotidien) — ces retours valent mieux que des idées imaginées à l'avance.

Statut au moment du gel : la chaîne **capturer → comprendre → valider → CR** est
en place (écrans 1/2/3), avec « Reprendre une visite » et « Objet au démarrage ».

## Priorités de reprise (ordre validé)

> **Règle d'or** : *terrain = capturer vite ; débrief = transformer en actions.*
> On ne met pas de charge cognitive sur le terrain ; l'intelligence arrive au débrief.

1. **📎 « Ajouter un média » à une visite (depuis le téléphone)** — *indispensable.*
   Sources : Appareil photo · Galerie · Fichier · Vocal. Types acceptés : photo,
   vidéo, vocal, **PDF, document, capture d'écran**. C'est la brique qui débloque
   le flux WhatsApp/PDF/photos reçues/documents fournisseur (et pose les bases du
   moteur d'import). Distinct du live camera : on peut enrichir une visite avec ce
   qu'on a déjà sur le téléphone.
2. **📝 Annotation photo** (PR dédiée, priorité haute). Une photo brute dit « regarde
   quelque part » ; annotée, « regarde exactement ici ». Outils : cercle · flèche ·
   surlignage · texte court · **rouge par défaut**. **Sauvegarde de l'image annotée
   EN PLUS de l'original** (jamais détruire la preuve).
3. **🎤→✅ Vocal → suggestion d'action AU DÉBRIEF** (jamais pendant la capture, sinon
   on casse le rythme). Terrain : vocal libre (« prévoir reprise étanchéité côté
   nord avant fermeture »). Débrief : MemorIA propose « Action détectée : … » →
   boutons **✅ Créer l'action / ✏️ Modifier / ❌ Ignorer**.
4. **📋 Liste d'actions au niveau CHANTIER, alimentée par les visites.** Une visite
   *propose* → l'utilisateur *valide* → l'action entre dans la liste du **chantier**.
   Les visites suivantes détectent « cette action existe déjà — la mettre à jour ? ».
   La SOURCE peut être n'importe quelle visite ; la **vérité vit au niveau chantier**,
   pas au niveau visite.

## À reprendre après la phase d'usage réel

- **⭐ Photo principale (couverture du CR)** — pendant le tri, marquer une photo
  comme « principale » ; le PDF l'utilise en couverture au lieu des 2 premières
  (rarement les bonnes).
- **📝 Annotation des photos** — cercle rouge / flèche / texte sur une photo.
  Très demandé par Guillaume, probablement utilisé tous les jours. Chantier
  technique (canvas tactile + sauvegarde de l'image annotée) → itération dédiée.
- **📍 Géolocalisation plus intelligente** — au-delà du point par capture.
- **📎 Lien automatique photo ↔ réserve/action** — rattacher les photos à la
  réserve/action qu'elles illustrent, sans saisie manuelle.
- **📄 Version HTML du compte-rendu** (in-app, façon maquette écran 3) — le CR
  narratif est aujourd'hui servi en PDF ; la version écran (Résumé + points +
  « Télécharger le PDF ») viendra ensuite.
- **CR plus narratif encore** — « Objet · Ce qui ressort · Points observés ·
  Photos · Suite » plutôt qu'un enchaînement de sections.
- **Cohérence photo/vidéo « sur le téléphone »** — comportement OS de l'appareil
  photo (la vidéo va dans la galerie, pas la photo). Décision produit : sauvegarde
  locale volontaire des médias ?

## 🎯 Décision de cadrage (2026-07) — « uniquement WhatsApp »

> Guillaume : *« Prenons uniquement WhatsApp et oublions le reste. »* On garde la
> section « moteur d'import universel » ci-dessous comme **fond d'architecture**
> (elle reste vraie : WhatsApp n'est qu'un adaptateur), mais la **feuille de route
> exécutable** se réduit à **4 niveaux WhatsApp**, du moins risqué au plus ambitieux.
> On ne construit qu'un seul chemin à la fois.

### Les 4 niveaux WhatsApp

- **Niveau 1 — Import d'un export WhatsApp `.zip` (MVP).** L'utilisateur fait
  « Exporter la discussion » dans WhatsApp → obtient un `.zip` (`_chat.txt`
  horodaté + médias). On le dépose dans MemorIA → parse → reconstruction
  chronologique → visite → pipeline existant (tri écran 2 → CR écran 3). **Zéro
  coût récurrent, zéro infra externe.** C'est le cœur ; tout le reste s'y branche.
- **Niveau 2 — Export ZIP depuis MemorIA.** L'inverse : depuis une visite/un
  chantier, produire un `.zip` (photos annotées + CR PDF + vocaux) partageable.
  Déterministe, réutilise `site-export`/`buildVisitCrDoc`. Prouve la valeur
  « sortie » avant d'investir dans l'entrée temps réel.
- **Niveau 3 — Partager vers MemorIA (feuille de partage OS).** Depuis WhatsApp,
  « Partager » les médias sélectionnés → MemorIA (PWA `share_target` Android /
  feuille de partage iOS). Un cran plus fluide que l'export ZIP, toujours sans
  numéro ni webhook.
- **Niveau 4 — Assistant WhatsApp conversationnel (numéro WhatsApp Business).**
  Le conducteur écrit à un **numéro MemorIA** comme à un collègue. Il envoie ses
  photos/vocaux au fil de l'eau ; MemorIA répond DANS WhatsApp.

### Niveau 4 en détail — faisabilité de l'assistant conversationnel

Objectif ressenti : *« je parle à MemorIA dans WhatsApp, il me comprend et me
répond. »* Techniquement réaliste avec la **WhatsApp Business Cloud API** (Meta) —
pas un téléphone, un webhook serveur.

- **Recevoir** : `POST /api/webhooks/whatsapp` reçoit chaque message (média ou
  texte). Le serveur télécharge le média via l'API → alimente le **même moteur**
  d'ingestion que les niveaux 1-3. Rien de neuf côté pipeline.
- **Répondre** : l'API permet d'**envoyer des messages** en retour (texte +
  **boutons de réponse rapide** interactifs, listes). MemorIA peut donc répondre
  « ✅ 12 médias reçus — Terminer la visite ? [Oui] [Ajouter encore] ».
- **Commandes légères** (parsing texte, pas d'IA nécessaire) :
  - `Début visite Médipôle` → ouvre une visite sur le chantier reconnu (match par
    nom sur les chantiers de l'émetteur ; sinon boutons de désambiguïsation).
  - `Fin visite` → clôt la session : reconstruction chrono → tri proposé → CR.
  - Tout média entre-temps est rattaché à la session ouverte de cet émetteur.
- **État de session par émetteur** : une petite table `whatsapp_session`
  (phone → report_id ouvert, chantier, dernière activité). Déterministe. Le
  « conversationnel » = **machine à états simple** (aucune session ouverte →
  attend `Début visite` ; session ouverte → accumule les médias ; `Fin visite` →
  clôt), pas un agent libre. On garde la règle : **MemorIA propose, l'humain
  valide** (le tri et la création de suites restent des gestes de validation, ici
  via boutons WhatsApp).
- **Affectation** : téléphone → conducteur → ses chantiers. Chantier via la
  commande `Début visite <nom>` ou suggestion par la mémoire ; sinon boutons.

**Pourquoi le Niveau 4 en dernier** : il exige compte Meta Developer, app vérifiée,
numéro dédié, serveur public + webhooks signés, gestion médias/quotas, et une
**facturation par conversation** (modèle Meta EN VIGUEUR — à revérifier au moment
venu). Or les niveaux 1-3 délivrent déjà l'essentiel du gain de temps à coût nul.
On n'investit dans le numéro que si l'usage réel prouve le besoin de temps réel.

### Coût & modèle éco (Niveau 4)
- **Vrai coût récurrent** = stockage médias + transcription vocaux + résumé IA
  (déjà optimisé : 1 appel, texte seul, gaté). **Pas** WhatsApp per-média.
- Cloud API : coût lié aux conversations. Pilote (~10 conducteurs × 5 visites/sem
  ≈ 200 conv./mois) → faible devant la valeur (≈ 1 h économisée / visite).
- **Offre** possible : *Standard* (import ZIP / partage, coût mini) vs *Premium*
  (numéro WhatsApp dédié + assistant conversationnel). Le Premium finance l'infra.

---

## 🧠 À CONCEVOIR (pas encore développer) — « Mémoire vivante du chantier »

> Guillaume : *« Je ne le développerais pas tout de suite, mais je commencerais à
> le concevoir. »* Concept : répondre à **« Qu'est-ce qui a changé sur ce chantier
> depuis un mois ? »** — réserves récurrentes, actions qui traînent, entreprises
> qui interviennent le plus, zones à problèmes, évolution dans le temps.

### 🔑 Lecture technique : c'est **déjà là à ~80 %**
Ce n'est PAS un nouveau moteur. Presque tous les signaux existent déjà, en
**déterministe**, dans `lib/db/site-memory-signals.ts` :

| Question de Guillaume | Brique existante |
|---|---|
| Réserves qui traînent / récurrentes | `detectOpenReserves`, `detectRecurringTopics` |
| Actions qui stagnent / en retard | `detectOverdueActions`, `detectUnappliedDecisions`, `detectRecurringActions` |
| Entreprises qui interviennent le plus | `detectActorCongestion` |
| Entreprises absentes / défaillantes | `detectRepeatedAbsences` |
| Évolution dans le temps (frise) | `site-narrative.ts` → `getSiteNarrative` / `buildNarrativeMonths` / `buildStorySummary` |
| Digest synthétique | `site-memory-digest.ts` → `getSiteMemoryDigest` |

`buildSiteMemorySignals(siteId)` agrège déjà tous ces détecteurs. Ils tournent
sur SQL (`site_reserve`, `site_actions`, visites, sujets) — **aucune IA, aucun coût.**

### Ce qui manque réellement (petit)
1. **Fenêtrage temporel** : ajouter un paramètre « depuis N jours / ce mois-ci » aux
   détecteurs (aujourd'hui ils raisonnent surtout `asOf`). C'est un `WHERE date >= …`.
2. **Framing « ce qui a CHANGÉ »** : diff entre deux instantanés (réserves ouvertes
   il y a 1 mois vs aujourd'hui : ouvertes/levées/nouvelles). Déterministe.
3. **UNE synthèse narrative IA** (optionnelle, gatée) : transformer la liste de
   signaux en un paragraphe « voici le mois » — **texte seul, un appel, jamais
   d'images**, avec repli déterministe. Exactement le patron de `runVisitSummary`.
4. **Un écran** « Mémoire du chantier » (question en haut, réponse = signaux
   fenêtrés + frise + synthèse).

### Principe reconduit
MemorIA **observe et restitue** ; il ne décide pas à la place du conducteur. La
mémoire vivante *montre* (« 3 réserves rouvrent chaque mois côté lot plomberie »)
— l'humain agit. Cohérent avec « proposer, pas imposer ».

### Estimation
Vu l'existant, c'est **surtout de l'assemblage + du fenêtrage + un écran**, pas un
chantier IA. À planifier comme une itération courte quand on décidera d'y aller.

---

## 🚀 Fond d'architecture — moteur d'import universel (référence)

> Conservé comme **socle conceptuel** (WhatsApp = un adaptateur parmi d'autres).
> Non exécutable en l'état : la feuille de route active est « uniquement WhatsApp »
> ci-dessus. À rouvrir seulement si une 2ᵉ source (email, dossier…) devient prioritaire.

> Ce n'est pas qu'une feature : c'est un **repositionnement**. Aujourd'hui MemorIA
> suppose qu'on l'utilise PENDANT la visite. Beaucoup de conducteurs travaillent
> autrement : ils mitraillent photos + vocaux, envoient tout sur WhatsApp, et le
> vrai travail (comprendre, corréler photo↔vocal, trier) commence à la réception
> — ~1 h perdue/semaine. L'idée : **ne pas changer leurs habitudes, absorber leur
> chaos, puis le transformer en visite structurée.**

### Douleur observée
Guillaume reçoit ~20 photos + ~15 vocaux (+ vidéos) et doit deviner : quelle photo
montre quoi, quel vocal parle de quelle photo, qu'est-ce qui est réserve/action,
quelles photos ne servent à rien.

### Ce qui est REMARQUABLE : quasi rien de nouveau à développer
Deux portes d'entrée alimentent **exactement le même pipeline** :

```
Visite en direct  ─┐
                   ├─▶  captures → transcription → tri (écran 2) → CR (écran 3) → mémoire du chantier
Import (WhatsApp…) ─┘
```

Réutilisé tel quel : stockage, `visit_capture`, transcription, tri (tags
Mémoire/À surveiller/Réserve/Action), CR + résumé IA, mémoire du site. **Net-new =
seulement l'ingestion + la corrélation.**

### Ce qui est DÉTERMINISTE (donc quasi gratuit) vs IA
- **Reconstruction chronologique** : dates EXIF / horodatage fichier → ordre.
  100 % déterministe.
- **Association photo↔vocal** : proximité TEMPORELLE (photo 14h05 ↔ vocal 14h05).
  Le « confiance 87 % » = score de proximité + écart, **pas de vision IA**.
  Déterministe.
- **Transcription** : pipeline existant.
- **Groupement sémantique** (« ce vocal parle des photos 3-4-5, toiture Est ») :
  seule brique un peu IA — bornée (fenêtre temporelle + 1 appel light sur le
  texte). Optionnel/v2.
- **Résumé** : identique à aujourd'hui (un appel, texte seul, gaté).

→ Le cœur (import + chrono + association) est **cheap** et cohérent avec l'archi.

### Réalité technique des points d'entrée (à cadrer)
- **Le plus simple d'abord** : dépôt **multi-fichiers** (desktop = glisser un
  dossier ; mobile = feuille de partage OS / PWA `share_target`). EXIF/horodatage.
- **« Import WhatsApp »** concrètement : WhatsApp n'a pas d'API d'import. Deux
  voies réalistes : (a) « Exporter la discussion » de WhatsApp → un .zip (médias +
  `_chat.txt` horodaté) qu'on parse ; (b) partage OS des fichiers vers MemorIA.
- **Email** : adresse d'ingestion (forward → parse pièces jointes). Backend mail.
- **Dossier Windows** : = simple upload multi-fichiers desktop.

### 🔑 L'insight d'architecture : UN moteur d'import, plusieurs portes
On ne construit **pas** une intégration WhatsApp. On construit un **moteur d'import
universel** avec un **contrat d'ingestion unique** :

```
ingestBatch(files: Array<{ blob, filename, kind, capturedAt }>, { siteId, createdBy })
  → tri chronologique → visite (site_report + visit_capture) → pipeline existant
```

Chaque « porte » n'est qu'un **adaptateur** qui remplit ce contrat :
- Upload multi-fichiers (desktop/mobile) — lit EXIF/horodatage.
- Feuille de partage OS (Android/iOS `share_target`).
- Parse d'un export WhatsApp `.zip` (`_chat.txt` + médias).
- Webhook WhatsApp Business Cloud API (télécharge les médias reçus).
- Email (pièces jointes), dossier, etc.

→ Le **cœur** (moteur + reconstruction + tri + CR + mémoire) se construit UNE fois ;
brancher une nouvelle source = écrire un petit adaptateur.

### Feuille de route (du plus simple/universel au plus ambitieux)
- **Phase 1 (MVP, ~1-2 sem.)** — **Import de fichiers** (photos/vidéos/vocaux, tout
  ordre) → reconstruction chronologique → visite → pipeline existant. Universel :
  marche pour WhatsApp, Messenger, Signal, email, AirDrop, USB, explorateur…
  *C'est le cœur ; tout le reste s'y branche.*
- **Phase 2** — **Partage OS** Android/iOS vers MemorIA (feuille de partage).
- **Phase 3** — **Import d'un export WhatsApp `.zip`** (robuste, garde dates+vocaux).
- **Phase 4** — **Numéro WhatsApp Business** relié à l'**API officielle** (pas un
  téléphone : Cloud API + webhook `POST /api/webhooks/whatsapp` → le serveur
  télécharge les médias → alimente le MÊME moteur). Le conducteur ne change RIEN.
- **Phase 5** — **Affectation automatique** : téléphone → entreprise → conducteur ;
  chantier via commande vocale/texte (« Début chantier Médipôle » … « Fin ») ou
  suggestion par la mémoire. Sinon choix manuel.

Pourquoi le numéro WhatsApp EN DERNIER : il exige compte Meta Developer, app,
config API, serveur public + webhooks, gestion médias/quotas. Or **le moteur
d'import développé avant est identique** — le webhook ne fait que l'alimenter.

### Inbox chantier (la vue qui unifie)
```
INBOX ── WhatsApp (28 médias) → Créer une visite
      ── Email (12 pièces)    → Créer une visite
      ── Import (15 photos)   → Créer une visite
```
MemorIA devient le point d'entrée de TOUTE information brute, quelle que soit la source.

### Coût & modèle éco
- Le **vrai coût récurrent** = stockage médias + transcription vocaux + résumé IA
  (déjà optimisé : 1 appel, texte seul, gaté). **Pas** WhatsApp per-média.
- WhatsApp Business Cloud API : facturation liée aux conversations/messages (selon
  le modèle Meta EN VIGUEUR — à revérifier au moment de la Phase 4, la tarification
  a évolué). Pour un pilote (~10 conducteurs × 5 visites/sem ≈ 200 conv./mois),
  reste faible devant la valeur (≈ 1 h économisée / visite).
- **Modèle d'offre** possible : *Standard* (visite + import manuel/partage/ZIP,
  coût mini) vs *Premium* (numéro WhatsApp dédié + import auto). Le Premium finance
  l'infra WhatsApp → risque maîtrisé.

### Stratégie de validation (dérisquée)
Ne PAS commencer par le numéro. Commencer par **partage/import** (Phase 1-3, zéro
coût récurrent, faible complexité) pour prouver le gain de temps réel. Si après
quelques semaines Guillaume dit « je l'utilise chaque semaine et je gagne 1 h »,
alors investir dans le numéro WhatsApp Business (Phase 4).

### Décisions produit à trancher le moment venu
- Affectation au chantier (avant/après reconstruction ; suggestion par mémoire).
- Gestion des doublons / ré-imports.
- Coût transcription en lot (rester texte-only pour l'IA, résumé unique à la fin).
