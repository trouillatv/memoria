# Parcours métier MemorIA — Audit (2026-05-26)

> **But** : vérifier si MemorIA tient ses promesses *côté utilisateur* — pas si le code compile.
> Trois rôles joués de bout en bout : **Manager exploitation**, **Chef d'équipe terrain**, **Admin/pilote**.
> Audit fondé sur le code réel (fichiers cités). **Aucune correction à ce stade** — on cartographie d'abord.

---

## 1. Matrice des parcours critiques

| # | Parcours | Rôle | Écrans clés | État | Risque dominant |
|---|----------|------|-------------|------|-----------------|
| M1 | Lire la mémoire active du matin | Manager | `/dashboard` | 🟡 OK mais condensé | Pas de raccourci vers l'action |
| M2 | Suivre un contrat (climat → engagements) | Manager | `/contracts`, `/contracts/[id]` | 🟢 OK | Vigilances read-only |
| M3 | Préparer une passation | Manager | `/continuite` → `/handovers/[id]` | 🔴 Incomplet | Brief vierge, non pré-peuplé |
| M4 | Exploiter un AO → contrat/vigilance/à savoir | Manager | `/tenders/[id]`, `…/convert` | 🟡 Fragmenté | À savoir 1-par-1, vigilance sans suite |
| M5 | Importer & rattacher des documents | Manager | `/documents/import` | 🟢 OK | Pas d'import depuis dashboard |
| C1 | Faire ses interventions du jour | Chef | `/m` | 🟢 OK | — |
| C2 | Préparer son arrivée sur site (mémoire/accès) | Chef | `/m/intervention/[id]` | 🟡 Partiel | Plafond 2 fragments, pas de mémoire complète |
| C3 | Signaler une anomalie + preuve | Chef | `/m/intervention/[id]` | 🟡 Partiel | Anomalie impossible avant « Commencer » |
| C4 | Recevoir & reconnaître une passation | Chef | `/h/[token]` | 🔴 Trou | Brief invisible dans l'app mobile |
| C5 | Clôturer une intervention | Chef | `/m/intervention/[id]` | 🟡 Faible | Clôture possible sans aucune preuve |
| A1 | Gérer comptes / rôles | Admin | `/admin/users` | 🟡 Fragile | Changement de rôle **non audité** |
| A2 | Vérifier imports & liens documents | Admin | `/documents`, `/documents/[id]` | 🟢 OK | Pas d'indicateur d'indexation |
| A3 | Surveiller les garde-fous (pages sensibles) | Admin | `/intervenants`, `/litige`, `/admin/observation` | 🟡 | Litige **non audité** ; transparence user nulle |
| A4 | Piloter sans dériver (anti-deux-morts) | Admin | `/admin/observation` | 🟢 OK | Par rôle, jamais nominatif — conforme |

Légende : 🟢 fonctionne · 🟡 friction / partiel · 🔴 trou métier.

---

## 2. Parcours détaillés

### Parcours A — Manager exploitation

**Objectif métier** : piloter la continuité (savoir où ça va / où ça coince), transformer un AO gagné en mémoire opérationnelle, anticiper les passations.
**Préconditions** : rôle `manager` ou `admin` ; ≥1 contrat actif ; idéalement 1 AO importé.
**Données nécessaires** : contrats + sites + engagements ; ≥1 AO avec engagements extraits ; ≥1 fin de contrat < 30 j (pour `/continuite`).

| Étape | Écran (fichier) | Résultat attendu | Friction / manque |
|---|---|---|---|
| Dashboard | `app/(dashboard)/dashboard/page.tsx` | Comprendre l'état du parc en 5 s | Hero ultra-condensé (1-2 signaux) ; **0 raccourci** vers la zone d'action |
| Contrats | `contracts/page.tsx` | Repérer les contrats sous tension | Climat lisible ; pas de tri par climat |
| Détail contrat | `contracts/[id]/page.tsx` + `ContractVigilancePanel`, `ASavoirPropositionsPanel` | Voir promesses / vigilances / à savoir | 3 panneaux séparés (manquables) ; **vigilance read-only** |
| Site | `sites/[id]/page.tsx` | Contexte complet du lieu | Page très longue ; pas de bouton « préparer passation » |
| Passation | `/continuite` → `handovers/[id]` | Brief prêt à partager | **Brief vierge** : notes manuelles, payload non pré-peuplé (sites/mémoire/équipe) |
| Intervenants | `intervenants/page.tsx` | Voir les porteurs de continuité | Lecture seule ; détail audité |
| Documents | `documents/import/page.tsx` | Importer + rattacher | Doit partir d'un site/contrat ; pas d'import global |
| AO / Atelier IA | `tenders/[id]/page.tsx`, `AtelierIATab.tsx` | Exploiter l'AO, produire des objets | Atelier optionnel (4 clics) ; slash commands non documentés UI |
| AO → contrat | `tenders/[id]/convert` + `engagement-curation-view.tsx` | Curation destination + activation | `destination='mission'` dans l'enum mais **absente de l'UI** (à confirmer) |

**Ambiguïtés UX** : le manager ne sait pas qu'une **vigilance** n'attend aucune action de lui ; l'« à savoir proposé » ≠ « à savoir créé » (matérialisation manuelle, 1 par 1).
**Risques doctrine** : aucun majeur (sujet = lieu/contrat). Attention à ne pas transformer la vigilance en « to-do » impérative.
**Bugs probables** : passation partagée avec payload vide ; conversion AO si engagements destination=null ; pagination contrats > 50.

---

### Parcours B — Chef d'équipe terrain (mobile `/m`)

**Objectif métier** : savoir quoi faire aujourd'hui, arriver sur un site en connaissant l'essentiel, documenter la preuve, recevoir/accuser une passation.
**Préconditions** : rôle `chef_equipe` ; membre actif d'≥1 équipe ; ≥1 intervention planifiée du jour.
**Données nécessaires** : interventions générées (récurrence ou ponctuelles) ; site avec accès/à savoir/mémoire ; un brief `/h/[token]`.

| Étape | Écran (fichier) | Résultat attendu | Friction / manque |
|---|---|---|---|
| Interventions du jour | `(field)/m/page.tsx` | Voir sa journée, agir | 🟢 clair ; alertes rouges régularisation/tâches. **Aucun indicateur « brief à lire »** |
| Ouvrir intervention | `m/intervention/[id]/page.tsx` | Démarrer | CTA « Commencer » clair |
| Consignes (accès/à savoir/mémoire) | `SiteAccessCard`, `SiteResumeCard`, `MobileSiteReadings` | Savoir avant d'entrer | Code d'accès lisible ✅ ; **checklist obligatoire affichée APRÈS le CTA** ; **plafond 2 fragments mémoire** ; pas de lien « mémoire complète » |
| Signaler anomalie | `anomaly-trigger.tsx`, `anomaly-modal.tsx` | Déclarer un problème + photo | 5 catégories rapides ✅ ; **impossible avant « Commencer »** (site fermé à l'arrivée = blocage logique) |
| Photo / preuve | `photo-capture-button.tsx`, `checklist-mobile.tsx` | Documenter | Queue offline ✅ ; **pas de feedback de synchro** (X photos en attente ?) |
| Brief partagé reçu | `/h/[token]/page.tsx` | Lire la passation | URL externe sans login ✅ ; **invisible dans `/m`**, aucune notif, aucun historique |
| Reconnaître passation | `PublicAcknowledgeButton` + `actions-public.ts` | « C'est lu » tracé | **Uniquement depuis `/h/[token]`** ; rien côté `/m` |
| Pré-site (mémoire au bon moment) | `MobileSiteReadings`, reprise | Contexte avant d'arriver | Surfacé au bon endroit ✅ mais **tronqué** (2 fragments) |
| Clôturer | `complete-button.tsx` | Marquer terminé | **Aucune barrière preuve** : clôture possible 0 photo / 0 tâche / accès fermé |

**Ambiguïtés UX** : alerte « Équipe sans chef d'équipe » non bloquante mais anxiogène ; le chef ne sait pas s'il a un brief en attente.
**Risques doctrine** : ✅ pas de pointage/GPS/heure réelle imposée — conforme. **Mais** confiance totale à la discipline (cf. clôture sans preuve) = audit flou (acceptable doctrinalement, à assumer).
**Bugs probables** : brief perdu (lien SMS expiré) ; photos non synchronisées invisibles ; anomalie d'arrivée non déclarable.

---

### Parcours C — Admin / pilote

**Objectif métier** : exploiter sainement, vérifier que les garde-fous tiennent, qu'aucun écran ne glisse vers le RH toxique / ERP froid.
**Préconditions** : rôle `admin` ; `INTERVENANTS_PAGE_ENABLED` connu ; données pilote.

| Étape | Écran (fichier) | Verdict doctrine | Manque / risque |
|---|---|---|---|
| Comptes / rôles | `admin/users` | ⚠️ | **Changement de rôle/téléphone NON audité** ; MDP reset `memoria2026` en dur |
| Imports & indexation | `documents`, `documents/[id]` | ✅ | Audit d'ouverture OK ; pas de spinner d'indexation, pas d'annulation |
| Liens documents | `documents/[id]` (rattachements polymorphes) | ✅ | OK |
| Intervenants (page sensible) | `intervenants/[id]` | 🔴 à surveiller | 6 garde-fous présents (audit, pas de score, wording, kill switch ENV, allowlist, tripwire) **mais transparence user = 0** (ne sait pas qu'il est tracé) |
| Litige | `litige/LitigeWizard.tsx` | 🔴 trou | **Création de dossier NON auditée**, pas d'historique, TTL URL invisible — action potentiellement juridique |
| Observation pilote | `admin/observation` | ✅ | Tout par **rôle** / feature, jamais nominatif. Anti-deux-morts explicite. Conforme |

**Risques doctrine (verdict)** : la doctrine *contenu* tient (zéro score humain, zéro ranking, wording descriptif, observation par rôle). Le risque réel n'est **pas** un glissement RH mais un **audit trail incomplet** (litige + users + transparence intervenants).
**Bugs probables** : oubli d'activation d'un kill switch ENV → 404 silencieux sans page de statut ; reset MDP non tracé.

---

## 3. Trous métier priorisés

### P0 — bloquant pour la promesse produit
1. **Passation = brief vierge** (M3). Le cœur de MemorIA (« survivre aux ruptures humaines ») repose sur la passation, mais le brief n'est **pas pré-peuplé** (sites du contrat + mémoire 14 j + équipe). → La promesse de continuité n'est pas tenue automatiquement.
2. **Brief invisible côté chef** (C4). Le chef reçoit le lien par SMS, **aucun accès/notif/historique dans `/m`**. Lien perdu = mémoire perdue. Brise la boucle passation → reconnaissance.
3. **Litige non audité** (A3). Action sensible (juridique) sans trace de création. Risque de responsabilité.

### P1 — friction forte / promesse partielle
4. **Mémoire de site tronquée sur mobile** (C2) : 2 fragments max, pas de « mémoire complète » avant l'arrivée → « la mémoire au bon moment » est partielle.
5. **Vigilances sans chaîne d'action** (M2/M4) : extraites, affichées, mais aucune suite (dispatch, suivi, résolution).
6. **À savoir AO → site, 1 par 1** (M4) : pas de matérialisation par lot.
7. **Anomalie impossible avant « Commencer »** (C3) : workflow dénaturé (site fermé à l'arrivée).
8. **Changement de rôle non audité** (A1).

### P2 — polish / V2
9. Raccourcis « dashboard → action » (M1).
10. Feedback de synchro photos (C5).
11. Spinner/preview d'indexation documents (A2).
12. Page de statut des kill switches ENV (A3).
13. Transparence « vous êtes consulté » sur la page intervenant (A3).
14. `destination='mission'` : finir ou retirer de l'enum (M4, à confirmer).

---

## 4. Cohérence produit (les 7 questions)

| Question | Verdict | Détail |
|---|---|---|
| Le manager comprend ce qu'il voit ? | 🟡 | Oui pour contrats/sites ; le **rôle des vigilances** (observationnel, pas d'action) n'est pas explicité. |
| Le chef sait quoi faire ? | 🟢 | La journée est claire ; **sauf** les briefs (invisibles) et la checklist (sous le pli). |
| La mémoire apparaît au bon moment ? | 🟡 | Oui à l'ouverture d'une intervention, **mais tronquée** ; côté manager, condensée. |
| L'Atelier IA produit des objets opérationnels ? | 🟢→🟡 | Oui (engagements → vigilance / à savoir / contrat), **mais** la matérialisation reste manuelle et fragmentée. |
| Les documents nourrissent la mémoire ? | 🟢 | Import + rattachement + embedding sélectif ; reste gated par l'usage réel (peu de données). |
| Les passations évitent la perte de contexte ? | 🔴 | **Non garanti** : brief vierge + invisible côté chef = le maillon le plus faible. |
| Le dashboard reste calme et utile ? | 🟢 | Calme ✅ ; « utile » limité par l'absence de raccourcis d'action. |

---

## 5. Proposition de tests E2E (Playwright) — *quand on y arrivera*

Suite minimale par rôle (happy paths d'abord), avec seed dédié (`__test_*`, cf. `scripts/dev/cleanup-test-data.ts`).

- **auth & rôles** : login manager / chef / admin ; redirections (`chef_equipe` → `/m`, non-admin hors `/admin`).
- **manager-contrat** : dashboard charge → ouvrir un contrat → voir promesses/vigilances/à savoir.
- **manager-ao** : ouvrir AO → onglet Atelier → vérifier qu'un message agent revient ; conversion → contrat créé.
- **manager-passation** : `/continuite` → préparer → brief créé → partager → token public ouvrable.
- **chef-jour** : `/m` liste les interventions du jour ; ouvrir → commencer → cocher tâche → ajouter photo → terminer.
- **chef-anomalie** : signaler (in_progress) → photo jointe → apparaît dans la liste.
- **brief-public** : `/h/[token]` s'ouvre sans login → « C'est lu » → statut `acknowledged` + audit.
- **garde-fous** : `/intervenants/[id]` consultée par admin → ligne d'audit créée ; tripwire CI (forbidden symbols / planned-time) reste vert.

Tooling : `@playwright/test`, base de test isolée (⚠️ la base est partagée prod — prévoir un projet Supabase de test **avant** d'automatiser des écritures), data-testids déjà présents (`recurrence-submit`, `teams-list`, `drawer-intervention-*`…).

---

## 6. Automatiser vs test humain

**Automatiser (Playwright / unit)** — déterministe, régressions :
- Auth, redirections par rôle, gating des pages sensibles.
- Création/clôture d'intervention, génération de récurrence (idempotence), création de passation + acknowledge.
- Présence des garde-fous techniques : audit log écrit, kill switch 404, tripwires doctrine (déjà en CI).
- Calculs purs : climat contrat, `describeTemplate`, `computeContractClimate`, fenêtres temps.

**Garder en test HUMAIN** — jugement, « écho juste », ressenti :
- *La mémoire apparaît-elle au bon moment ?* (pertinence des fragments, pas leur présence).
- *Le manager/chef comprend-il sans formation ?* (test d'utilisabilité, 5 utilisateurs réels — Guillaume + équipe).
- *L'écran est-il calme ou anxiogène ?* (les « deux morts » : ERP froid vs surconstruction).
- *Le ton est-il descriptif, jamais évaluatif ?* (revue éditoriale des libellés).
- *Une vraie passation évite-t-elle réellement la perte de contexte ?* (test terrain : un chef reprend un site qu'il ne connaît pas, à partir du seul brief).

> **Règle** : Playwright protège ce qu'on **sait** vouloir ; le test humain découvre ce qu'on **ne sait pas encore** être cassé (les P0 ci-dessus en sont la preuve — aucun n'aurait été trouvé par un test technique).

---

## Prochaines décisions (à valider, pas encore exécutées)
1. Traiter les **3 P0** (passation pré-peuplée, brief visible côté chef, audit litige) — ce sont les vrais risques produit.
2. Mettre en place un **projet Supabase de test** avant toute automatisation d'écriture (base prod partagée).
3. Écrire la suite Playwright **happy-path** une fois les P0 cadrés.
4. Planifier 1 session de **test humain** avec Guillaume sur le parcours passation (le maillon faible).
