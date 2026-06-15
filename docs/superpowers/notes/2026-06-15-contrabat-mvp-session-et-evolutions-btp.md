# 2026-06-15 — Session readiness MVP Contrabat + évolutions BTP gros œuvre

## Partie 1 — Ce qu'on a fait (session 2026-06-15)

Branche : `claude/contrabat-mvp-readiness-p38e6d`. 9 commits.

### Évaluation de maturité (structurelle + philosophique)
- État des gates au démarrage : `typecheck` 1 erreur (test), `lint` 2 erreurs + 115 warnings, `test` 50 échecs (dont ~122 lignes env-DB faute de `.env.local`).
- Tension de fond identifiée : doctrine forgée pour le **nettoyage** (anti-attribution individuelle, anti-planning par personne) vs besoins **BTP** de Contrabat (planning des hommes, « qui a posé quelle porte »).
- Décision actée : **pilote d'observation, doctrine intacte** au départ — puis assouplissements explicites ci-dessous.

### Décisions produit (tracées au journal `10_JOURNAL_DECISIONS.md`)
1. **Vue agent V6 → V7** : la vue agent autonome (`/intervenants/[id]` : sites connus, contrats, historique, continuité, nom) est **autorisée**. La frontière n'est pas les noms, c'est la **RH/surveillance** (scoring, ranking, performance, comparaison) — qui reste verrouillée dans les deux modes.
2. **Créneaux horaires partout** : l'UI ne dit plus « Matin / Après-midi / Soir ». Heures de début/fin (ou ancrage `7h`/`14h`/`19h`). S'applique à la modale de récurrence ET à la vue d'ensemble équipe×semaine (l'ancien garde-fou « jamais d'heure précise dans la cellule équipe » est levé — l'heure est un ancrage de prestation, jamais un pointage ; `planned_*` jamais agrégé par `user_id`).

### Corrections
- Gates : mock typecheck, `prefer-const` (dashboard), README à jour (22→105 migrations, compteur tests).
- Faux positif doctrinal sur `acknowledgeHandoverBrief` (accusé de réception ≠ générateur d'analyse) → exclusion des verbes consommateurs.
- 8 fichiers de tests de composants : copie UI périmée rattrapée (agents « Lecteur de dossier », onboarding/landing/skip, curation engagements, color picker hex, mémoire AO→dossiers).
- Libellés **AO → dossier** : 6 messages d'erreur (`tenders/`) + 6 libellés admin. Prompts IA / routes / code / DB volontairement intacts.
- Script `scripts/dev/set-demo-password.ts` : `demo@memoria.nc` → `memoria2026` + `must_change_password=false` (app_metadata **et** colonne DB). À lancer en local (`npx tsx`), pas exécutable depuis l'environnement de dev distant (aucune credential Supabase).

### État final
- `typecheck` ✅ 0 erreur · `lint` ✅ 0 erreur · tests : **50 → 9 échecs** (restants = intégration env-DB + 2 doctrinaux pré-existants sur l'UI documentaire, sans rapport).

---

## Partie 2 — Classement des évolutions (vu par un manager BTP gros œuvre)

> Lecture « gros œuvre » : coffrage/ferraillage/coulage, marchés publics, sous-traitance massive, réception & levée de réserves, garantie décennale, journal de chantier, intempéries/pénalités de retard, situations de travaux. La valeur de MemorIA pour nous, ce n'est PAS le planning des hommes — c'est la **preuve datée et opposable de ce qui a été exécuté**. C'est notre assurance contre les litiges, les pénalités et la décennale.

Critères : impact métier × alignement doctrine (mémoire/preuve, pas RH) × effort.

### 🥇 Tier 1 — À faire en premier (fort impact, aligné cœur, effort faible)

1. **Journal de chantier réglementaire** (météo, effectif anonyme du jour, intempéries, faits marquants).
   *Pourquoi* : c'est notre arme n°1 contre les **pénalités de retard** — prouver une journée d'intempérie datée. MemorIA a déjà le journal de site ; il manque la maille « jour de chantier » + météo. Aligné 100 % (descriptif, daté, zéro mesure d'humain).

2. **Traçabilité béton / bons de livraison (BPE)**.
   *Pourquoi* : photo du **bon de livraison** + horodatage serveur opposable, rattachés au coulage/zone. En cas de litige structure (fissures, décennale), savoir quelle toupie a coulé quelle zone, quel jour, est décisif. Parfait fit avec `photo.taken_by` + `taken_at` anti-fraude.

3. **Réserves / levée de réserves (punch list OPR)**.
   *Pourquoi* : nos anomalies, c'est déjà ça — mais il faut la sémantique « réserve » (émise par MOE/architecte) + **levée datée avec photo avant/après** + statut « clôturé » (pas « résolu », cf. doctrine juridique). C'est le quotidien de la réception.

### 🥈 Tier 2 — Forte valeur, demande une décision produit

4. **Sous-traitance : intervenants externes + pièces attachées**.
   *Pourquoi* : en gros œuvre, 40-70 % de la main d'œuvre est sous-traitée. Qui (quel sous-traitant) a fait quoi, avec **attestation assurance/qualif** attachée. Trou actuel — le modèle équipes/intervenants ne couvre pas clairement le sous-traitant. Aligné si on reste « qui a exécuté », pas « notation du sous-traitant ».

5. **Avancement par zone / niveau / maille** (phasage gros œuvre).
   *Pourquoi* : on pense en phases (fondations → R+1 → R+2), pas en personnes. Une vue **couverture/avancement par ouvrage** (% de mailles coulées) est doctrinalement saine (on mesure l'ouvrage, pas l'homme) et très parlante en réunion de chantier.

6. **Page MOE/client entrante (type Ada, QR → saisie)**.
   *Pourquoi* : faire **valider une réserve / un constat** par le MOE ou le client via un lien QR, sans login, et que ça remonte dans le dossier. Demandé explicitement par Adrien (exemple Ada). N'existe pas (les tokens publics sont en lecture seule). Décision produit : ouvrir une saisie entrante cadrée.

### 🥉 Tier 3 — Plus lourd / plus tard

7. **Épingler les photos sur le plan** (pin sur PDF du plan, à terme BIM).
   *Pourquoi* : « porte 42 bâtiment C » devient un clic sur le plan, pas une checklist de 42 lignes. Résout la friction de capture du Tier traçabilité. Effort UI/technique réel.

8. **Alimenter les situations de travaux** (avancement → facturation d'avancement).
   *Pourquoi* : très demandé en gros œuvre, mais c'est la frontière ERP (ProjetBat). MemorIA **alimente** (export % avancement), ne facture pas. Interop, pas remplacement.

9. **Taxonomie AO « marché public BTP »**.
   *Pourquoi* : l'extraction d'engagements est pensée nettoyage. Pour un marché public gros œuvre (délais, pénalités, garanties, normes DTU/Eurocodes, PPSPS), il faut une taxonomie adaptée. Sinon l'analyse IA tourne à vide sur nos AO.

### Ce que je NE demanderais PAS à MemorIA (frontière saine)
- Le planning nominatif heure par heure de mes compagnons (→ mon logiciel de planning / ERP).
- Le chiffrage / la bibliothèque d'ouvrages (→ ProjetBat).
- Les heures pour la paie (→ SIRH).
MemorIA reste la **couche mémoire/preuve**. C'est sa force, et c'est ce qui le rend non-copiable.
