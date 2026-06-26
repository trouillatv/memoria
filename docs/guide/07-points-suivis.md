# 07 — Points suivis

> 📸 **Capture 1** : `/sites/[id]/subjects` (liste des points). Annotations : ① recherche (taper « DOE ») · ② panneau **« Couverture du graphe »** (barres + « À améliorer ») · ③ **À surveiller en priorité** · ④ un point avec son badge d'état · ⑤ **Nouveau sujet**.
> 📸 **Capture 2** : la fiche d'un point `/sites/[id]/subjects/[id]`. Annotations : ① **état** (Bloqué / En attente / Ouvert…) · ② **Cause** (+ confiance) · ③ **Prochaine étape** · ④ **Dépendances** (« bloque la réception ») · ⑤ **Historique** chronologique · ⑥ **Renommer**.

## 🎯 Objectif
Suivre les **fils qui reviennent** (DOE, porte coupe-feu, étanchéité…) — la **mémoire vivante** d'un chantier. Côté utilisateur on parle de **« point »** ; en interne c'est un *sujet*.

## 🕒 Quand l'utiliser
« Où en est X ? », et pour ne **rien oublier** dans le temps.

## 🔘 Les éléments clés
- **Liste** des points avec état, criticité, compteurs.
- **Couverture du graphe** — % d'objets rattachés à un point + « prochain gain le plus rentable ». Plus c'est haut, mieux la recherche et le risque ressortent.
- **Fiche d'un point** — état · **cause** · **prochaine étape** · dépendances (« X bloque la réception ») · **historique** daté · renommer.

## 🧭 Parcours conseillé
On ne crée pas un point « à froid » : il se **propose** au moment du PV (**Suivre**) ou depuis une action (**Suivre ce point**). Pour consulter : `/sites/[id]/subjects` → ouvrir un point → lire la fiche.

## 💡 Conseils
Un point décrit un **objet métier durable** (« Porte coupe-feu A203 »), jamais une action (« Relancer la MOE »). Autour de lui gravitent réunions, décisions, actions, photos, documents, réserves.

## ⚠️ Erreurs fréquentes
- Vouloir « gérer des sujets » : l'utilisateur ne crée rien explicitement, il **valide** des propositions.
- Une **couverture basse** = la recherche et la Vue Sujet paraissent pauvres ; c'est un problème de **donnée** (rattachement), pas de moteur.
