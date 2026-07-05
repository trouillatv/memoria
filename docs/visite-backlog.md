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

## 🚀 Prochaine grosse évolution pressentie — Mode « Import WhatsApp »

**Douleur réelle observée** : quand Guillaume reçoit ~20 photos + ~15 vocaux sur
WhatsApp, il passe son temps à faire la correspondance entre les deux et à
reconstruire mentalement la visite.

**Idée** : importer un LOT de photos + vocaux et laisser MemorIA
**reconstruire automatiquement une visite** :

1. Import d'un lot de fichiers (photos, vocaux, éventuellement vidéos).
2. **Remise en ordre chronologique** (métadonnées EXIF / date de fichier ;
   fallback ordre d'import).
3. **Transcription** des vocaux (pipeline déjà en place).
4. Reconstruction d'une **visite** (site_report + visit_capture) avec les médias
   remis dans le fil du temps, prête pour le tri (écran 2) et le CR (écran 3).
5. Bonus : rapprochement photo ↔ vocal proche dans le temps (« ce vocal parle
   probablement de cette photo »).

**Pourquoi c'est fort** : ça branche MemorIA sur le canal réel des conducteurs
(WhatsApp) sans changer leurs habitudes, et ça supprime la corrélation manuelle
photo/vocal — exactement le goulot d'étranglement du conducteur.

**À cadrer** : point d'entrée d'import (upload multi-fichiers mobile/desktop),
gestion des formats, coût (transcription en lot — rester sur du texte pour l'IA,
un seul appel de résumé à la fin comme aujourd'hui), et l'affectation au bon site.
