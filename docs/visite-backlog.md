# Visite terrain — backlog (idées non bloquantes)

Idées validées « à faire un jour » mais volontairement mises de côté : on veut
d'abord que Guillaume **vive avec MemorIA 1 à 2 semaines** pour laisser émerger
les vrais irritants (gestes répétitifs, clics inutiles, infos qui manquent au
quotidien) — ces retours valent mieux que des idées imaginées à l'avance.

Statut au moment du gel : la chaîne **capturer → comprendre → valider → CR** est
en place (écrans 1/2/3), avec « Reprendre une visite » et « Objet au démarrage ».

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

## 🚀 Évolution STRATÉGIQUE — 2ᵉ porte d'entrée : Import / « Inbox chantier »

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

### Séquencement proposé
1. **v1 (MVP)** : dépôt multi-fichiers → reconstruction chronologique → visite
   prête pour le tri existant. Affectation au bon chantier (choix manuel).
2. **v2** : association photo↔vocal proposée (« MemorIA pense que ce vocal décrit
   cette photo — ✓ / ✏️ / ❌ ») + groupes multi-photos.
3. **v3 — « Inbox chantier »** : plusieurs sources (WhatsApp export, email,
   dossier) listées en boîte de réception → « Créer une visite » depuis chacune.
   MemorIA devient l'endroit où TOUTE information brute entre dans le système.

### Décisions produit à trancher le moment venu
- Où affecter au chantier (avant/après reconstruction ; suggestion par mémoire).
- Gestion des doublons / ré-imports.
- Coût transcription en lot (rester texte-only pour l'IA, résumé unique à la fin).
