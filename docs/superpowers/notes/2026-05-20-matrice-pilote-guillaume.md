# Matrice pilote Guillaume

**Date :** 2026-05-20
**Statut :** Instrument de pilotage, non bloquant. À mettre à jour au fil des commits.
**But :** Vue d'ensemble de ce qui est livré, ce qui reste, et l'ordre d'attaque conseillé. Croise les besoins Guillaume avec les 5 piliers MemorIA et les 3 axes ([[noyau-memoria-5-piliers]]).

---

## 1. Ce qui est LIVRÉ (commits cette session)

| # | Besoin Guillaume                                          | Pilier        | Axe       | Commit / surface          | État |
|---|-----------------------------------------------------------|---------------|-----------|---------------------------|------|
| 1 | Saisie heures réelles 06h30/08h00 vs « matin »            | Interventions | Mémoire   | `a8186a4` purge créneau   | ✅   |
| 2 | Vue semaine ordonnée par heure de prestation              | Interventions | Mémoire   | `f474120` ordre planned_start | ✅ |
| 3 | Drag-drop préserve l'horaire si jour change               | Interventions | Mémoire   | (session précédente)      | ✅   |
| 4 | Édition horaire depuis vue semaine (drawer + dialog)      | Interventions | Mémoire   | (session précédente)      | ✅   |
| 5 | Conflit horaire (équipe sur 2 sites qui chevauchent)      | Équipes       | Copilote  | (session précédente)      | ✅   |
| 6 | Wording 100% horaire dans messages + textboxes + erreurs  | Interventions | Mémoire   | `a8186a4` purge créneau   | ✅   |
| 7 | Bandeau vigilance rouge en haut du dashboard manager      | Tous          | Copilote  | `90b4885` dashboard       | ✅   |
| 8 | Vigilance rouge en haut /semaine + /aujourdhui            | Tous          | Copilote  | `dff364d`                 | ✅   |
| 9 | Vigilance rouge en haut mobile chef /m                    | Interventions | Copilote  | `dff364d`                 | ✅   |
| 10| Doctrine alertes légère (non bloquante)                   | —             | —         | mémoire `alertes-doctrine-legere` | ✅ |

**Verrous doctrinaux maintenus** :
- Tripwire `planned-time-no-rh-aggregation` actif ✅
- `[[litige-no-automatic-reading]]` respecté ✅
- Aucune agrégation par `user_id` introduite ✅
- Silence positif partout (zone vigilance disparaît si rien) ✅

---

## 2. Ce qui RESTE À LIVRER (ordre d'attaque conseillé)

Ordonné par **impact terrain Guillaume × effort**. Les 4 premiers items sont actionnables sans doctrine supplémentaire.

| # | Besoin                                                        | Pilier        | Axe       | Effort | Doctrine prête ? | Prochaine étape concrète                                   |
|---|---------------------------------------------------------------|---------------|-----------|--------|------------------|------------------------------------------------------------|
| A | **Purger créneau aussi sur `/aujourdhui`** (SLOT_FR/SLOT_TONE)| Interventions | Mémoire   | S (1h) | ✅ acquise        | Remplacer groupes par tri planned_start chronologique      |
| B | **Briefing du soir chef d'équipe** (récap fin de journée)     | Interventions | Mémoire   | M (1j) | 🟡 wording à figer | Maquette : interventions demain + photos manquantes + anomalies ouvertes |
| C | **Préparation matinale chef** (séquence du jour ordonnée)     | Interventions | Mémoire   | S (½j) | ✅ acquise        | Page mobile `/m` est déjà ordonnée — vérifier hiérarchie visuelle |
| D | **Page « Mémoire du site »** (4 ans, voici ce qu'il a appris) | Sites         | Mémoire   | L (3j) | 🟡 densité à doser| Maquette texte (1 paragraphe émergent) + 4 sections (anomalies récurrentes / accès / habitudes / personnes-connaissances) |
| E | **Alertes contrat expirant / preuve absente** (matrice §3.1)  | Contrats      | Copilote  | M (1j) | ✅ acquise        | `lib/alerts/registry.ts` + 2 alertes pilotes : contrat J-30, intervention non clôturée J+2 |
| F | **Continuité équipe — « sites connus de cette équipe »**      | Équipes       | Mémoire   | M (1j) | 🟡 garde-fou Q1   | Vue site-side uniquement (« ce site a été couvert par équipe A, B, C ces 30 derniers jours ») |
| G | **Timeline site compacte** (événements clés sur 12 mois)      | Sites         | Mémoire   | L (3j) | 🟡 obsolescence   | Maquette : 1 ligne par mois, agrégat des artefacts marquants |
| H | **Cold start / bootstrap** (import archives, AO historiques)  | Atelier IA    | Preuve    | XL     | 🔴 spec à écrire  | Plus tard — pas un sujet pilote                            |
| I | **Obsolescence mémoire** (fraîcheur, vieillissement)          | Tous          | Mémoire   | M      | 🔴 doctrine à écrire | Pas avant 30j d'usage réel — données nécessaires           |
| J | **Hiérarchie attention** (résonances rares, silence intel.)   | Tous          | Mémoire   | M      | 🟡 jury 4 classes existant | Étendre [[jury-resonances-4-classes]] avec mécanique de rotation |

**Recommandation d'ordre** : **A → C → E → B → F → D → G** pour les 2 prochaines semaines de pilote. H/I/J après 30 j d'usage.

---

## 3. Ce qui reste en DOCTRINE (pas prêt à coder)

Pas bloquant — alerte courte, on code quand le besoin presse.

| Sujet                                       | Question ouverte                                            | Statut              | Référence                       |
|---------------------------------------------|-------------------------------------------------------------|---------------------|---------------------------------|
| Page personne / employé                     | Comment livrer activité opérationnelle sans dériver RH ?    | ÉCARTÉE 2026-05-20  | `notes/2026-05-20-etude-page-personne.md` |
| Matrice alertes complète                    | 6 zones grises §3.3 à trancher                              | Référence longue    | `notes/2026-05-20-matrice-doctrine-alertes.md` |
| Continuité équipe                           | Comment éviter le scoring par accident ?                    | Garde-fou Q1 (sujet objet) | [[refus-erp-rh-pointage-gps]] |
| Obsolescence mémoire                        | Quand une procédure devient « ancienne » ?                  | Pas urgente         | `noyau-memoria-5-piliers` P5    |
| Notifications externes (push / SMS / WhatsApp) | Format hors-UI qui ne casse pas la doctrine                | Pas urgent          | référence briefing pilote 2026-05-13 |
| Cold start                                  | Quels artefacts importer en bootstrap ?                     | Spec à écrire       | `noyau-memoria-5-piliers` P4    |

---

## 4. Critères de sortie du pilote Guillaume

Le pilote est considéré comme **réussi** quand :

- [ ] 30 jours d'usage réel terrain (Guillaume + ses chefs d'équipe)
- [ ] ≥ 50 interventions réelles documentées (preuves + horaires)
- [ ] ≥ 5 anomalies signalées et traitées via MemorIA
- [ ] Aucune doctrine cassée hors-UI (cf. briefing 2026-05-13 — pas de screenshot WhatsApp avec noms)
- [ ] Guillaume valide manuellement les 2 alertes pilotes (E) après une semaine
- [ ] Au moins 1 « moment mémoire » (résonance qui aide à agir, validée écho juste) observé
- [ ] Aucun changement de doctrine sous pression terrain (ouvertures payantes respectées — cf. [[doctrine-openings-pay-cost]])

Le pilote est considéré comme **échoué** si :

- ❌ Plus de 3 alertes par jour ressenties comme du bruit → matrice trop large, reculer
- ❌ Une dérive vers le scoring/comparaison employés détectée (audit log)
- ❌ Un chef d'équipe pleure dans sa voiture (Sandrine scenario du briefing pilote 2026-05-13)
- ❌ Le marché pousse vers ERP RH et on cède

---

## 5. Engagement de cette session

Ce qui peut être attaqué **dans la même journée** si tu valides :

1. **Item A** — purger créneau dans /aujourdhui (cohérence avec /semaine), ~1h
2. **Item E** — coder `lib/alerts/registry.ts` minimal avec 2 alertes (contrat J-30, intervention non clôturée J+2), tripwire CI, ~1j

Sur les autres : il faudra une session dédiée.

---

## 6. Cohérence doctrinale (rappel des refus)

Même cadre pour CHAQUE item futur — test rapide ACID avant de coder :

1. Sujet objet, pas personne ? (cf. [[refus-erp-rh-pointage-gps]])
2. Pas d'agrégation `user_id` ? (tripwire actif)
3. Silence positif autorisé si rien ?
4. Densité contrôlée si ça peut sonner souvent ?
5. Réversible (admin peut désactiver) ?

Si oui aux 5 → on code. Sinon → mémoire `alertes-doctrine-legere` puis on tranche.
