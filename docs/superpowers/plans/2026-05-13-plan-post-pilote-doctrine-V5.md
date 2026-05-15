# Plan de codage post-pilote — Doctrine V5 opérationnalisée

> ⚠️ **CE PLAN N'EST PAS UN SPRINT À LANCER.** C'est un **document d'attente** qui capture les recos consolidées des 6 scénarios + de la doctrine V5. À activer **uniquement après** que le pilote terrain (13-17 mai 2026) ait produit ses signaux de réalité brute. Ouvrir ce doc le lundi 20 mai et confronter chaque slice aux **frictions réellement observées**.

**Statut** : EN ATTENTE
**Date de gel** : 2026-05-13
**Date d'activation envisagée** : 20 mai 2026 (post-pilote)
**Branche envisagée** : `feat/post-pilote-doctrine-v5`

---

## Principe d'activation

Au démarrage du sprint, **chaque slice ci-dessous est filtrée par le carnet d'observation Guillaume** :

| Filtre | Action |
|---|---|
| La friction prédite par l'agent a été observée en pilote | ✅ Inclure la slice |
| La friction prédite ne s'est pas matérialisée | ❌ Exclure la slice |
| Une friction non prévue a émergé | 🆕 Ajouter une slice basée sur l'observation, pas sur l'hypothèse |

Si moins de 5 slices sont validées par observation, **ne pas lancer de sprint** — itérer le pilote 1 semaine de plus.

---

## Test de chaque slice contre la Doctrine V5

Avant inclusion finale, chaque slice doit passer le test ultime V5 :

1. **Charge mentale** : réduit-elle le chaos, oublis, anxiété ? OUI obligatoire.
2. **Humains anonymes** : la valeur tient si humains = ID abstraits ? OUI obligatoire.
3. **Frontière dominante** : lutte-t-elle contre WhatsApp/Excel sur leur fonction émotionnelle ? NON obligatoire.

---

## Catalogue des slices candidates (12 slices, ~25h subagents)

Classées par persona, ancrées dans la doctrine V5.

### Bloc 1 — Guillaume / DG / Pilier 4 "Amplifier sa voix"

#### Slice P1 — Voice note du DG sur rapport mensuel (Agent 1, reco 1.A)
**Doctrine** : Pilier 4. Le rapport est un rituel relationnel, pas un livrable informationnel. La vraie voix de Guillaume vit dans ses notes vocales WhatsApp, pas dans le français-administratif.

**UX** : Sur `/contracts/[id]/rapport-mensuel`, à côté du champ texte "Note du DG", ajouter un bouton micro qui enregistre 30-60s d'audio. Audio inclus dans le PDF (lien lecteur) et dans la page publique (player intégré).

**Charge mentale** : ↓↓ (Guillaume passe de 10 min de rédaction à 30s de voice note)
**Effort** : M (~4h — Web Speech API ou upload audio + storage)
**Garde-fou** : pas de transcription IA. La voix est la voix.

#### Slice P2 — Preview "Tester l'envoi sur moi-même" (Agent 1, reco 1.B)
**Doctrine** : Pilier 4. Anxiété de réception = trou noir post-envoi.

**UX** : Bouton "M'envoyer un test" avant "Approuver et partager". Génère le même mail qu'au client mais à Guillaume. Il voit exactement ce que Sylvie va voir.

**Charge mentale** : ↓↓
**Effort** : S (~2h)

#### Slice P3 — Réutiliser la note du mois dernier (Agent 1, reco 1.C)
**Doctrine** : Pilier 2 (réduire la peur de la page blanche le 3 du mois).

**UX** : Sous le champ note, link "Reprendre la note d'avril" qui pré-remplit avec la dernière note utilisée.

**Charge mentale** : ↓
**Effort** : XS (~1h)

---

### Bloc 2 — Guillaume / DG / Mémoire commerciale (Agent 2)

#### Slice C1 — Statut won/lost minimaliste (Agent 2, reco 2.A)
**Doctrine** : Pilier 1 ("mémoire opérationnelle"). Closure émotionnelle AVANT analyse. 3 champs exactement.

**DB** : enum `tender_outcome` ('pending' | 'won' | 'lost' | 'withdrawn' | 'not_responded'). Colonnes `outcome_at`, `outcome_reason` (text 200), `outcome_tag` (enum 5 valeurs : prix, qualité, relation, timing, autre).

**UX** : Sur `/tenders/[id]`, quand status='submitted', bouton "Marquer le résultat" → modale 3 champs.

**Charge mentale** : ↓ (closure)
**Effort** : M (~4h migration + UX)
**Anti-CRM** : refus catégorique d'ajouter pipeline/forecast/relances.

#### Slice C2 — Encart mémoire au démarrage d'AO similaire (Agent 2, reco 2.B)
**Doctrine** : Pilier 2. Mémoire injectée AU BON MOMENT, pas en dashboard analytics permanent.

**UX** : À la création/import d'un nouveau tender, panel droit "AO similaires passés" (matching trigram sur titre + client) → si AO perdu détecté, encart sobre "Avril 2026 — perdu sur OPT-NC pour [raison]. Tag : [prix]."

**Charge mentale** : ↓ (rappel contextuel, pas notification)
**Effort** : M (~3h — réutilise pg_trgm de Phase 4)

---

### Bloc 3 — Maeva / Manager / Pilier 3 "Frontières humaines"

#### Slice M1 — Bouton "Partager dans WhatsApp" sur intervention (Agent 3, reco 3.A)
**Doctrine** : Pilier 3 ARCHÉTYPE. Bridge vers outil humain dominant. MemorIA n'absorbe pas WhatsApp, il le complète.

**UX** : Sur cellule de `/semaine` et sur page intervention, bouton "Partager les détails" → copie dans presse-papier un texte format :
```
🏥 CHT Magenta — Bionettoyage bloc B
Mardi 14 mai, créneau matin
Détails : https://app.memoria.nc/p/[token]
```

**Charge mentale** : ↓↓ (Maeva colle dans WhatsApp en 2 secondes)
**Effort** : S (~2h — réutilise share_token)
**Anti-dispatch** : pas de notification, pas de presence implicite, pas de tracking d'ouverture.

#### Slice M2 — Briefing du soir (Agent 3, reco 3.B)
**Doctrine** : Pilier 3 corollaire. Jouer la PRÉPARATION où MemorIA gagne, pas la RÉSOLUTION où WhatsApp gagne.

**UX** : Email/PDF auto envoyé à Maeva chaque soir 18h résumant le lendemain :
- 23 interventions, 4 équipes, 0 site sans couverture
- 1 point de vigilance : "CHT bloc B sans validation client confirmé"

**Charge mentale** : ↓↓ (Maeva se couche en paix)
**Effort** : M (~5h — cron + helper + PDF léger)

---

### Bloc 4 — Joseph / Chef d'équipe / Pilier 5 "Transparent"

#### Slice J1 — "Bonjour Joseph" + vocabulaire validé (Agent 4, reco 4.A)
**Doctrine** : Pilier 5. Dignité > sophistication. Vocabulaire terrain > vocabulaire consultant.

**UX** :
- `/m` header : "Bonjour {first_name}" au lieu de "Mes missions"
- Préparer un mini-A/B en pilote : "Mes missions" vs "Mes passages" — choisir selon retour terrain
- Si "passage" préféré, refactor wording mobile (pas l'admin)

**Charge mentale** : ↓ (psychologique)
**Effort** : XS (~30min code + validation terrain)

#### Slice J2 — Bouton photo plein-largeur (Agent 4, reco 4.B)
**Doctrine** : Pilier 5. L'humidité du bloc + gants = un FAB classique rate 2 photos sur 3.

**UX** : Sur la page intervention mobile, remplacer le bouton photo actuel par un bouton **pleine-largeur 80px** "📷 Prendre une photo", positionné en bas, sticky.

**Charge mentale** : ↓↓ (sur le terrain)
**Effort** : S (~1h CSS)

#### Slice J3 — Session 24h + login mémorisé (Agent 4, reco 4.C)
**Doctrine** : Pilier 2. Friction cumulative = charge mentale invisible.

**Action** : étendre `supabase auth` session à 24h (default 1h). Ajouter "Garder ma session active" coché par défaut.

**Charge mentale** : ↓↓↓ (Joseph re-tape 5x moins son mdp)
**Effort** : S (~1h config + tests)
**Risque** : à valider côté sécurité hospitalière (CHT). Peut-être 8h plutôt que 24h selon contexte.

---

### Bloc 5 — Sylvie / Client final / Pilier 6 "Infrastructure invisible"

#### Slice S1 — Co-branding NetCal + MemorIA sur PDF (Agent 5, reco 5.A)
**Doctrine** : Pilier 6. Le héros visible = prestataire. MemorIA = infrastructure.

**UX** : Header PDF rapport mensuel ET dossier de preuves :
- Logo prestataire (upload par tenant) à gauche, "PDF émis par {Tenant name}" sous le logo
- "Infrastructure : MemorIA" en footer, petit

**Charge mentale** : ↓ (Sylvie reconnaît son prestataire, fait confiance)
**Effort** : S (~3h — upload logo + intégration PDF + page publique)

#### Slice S2 — Signature DG (image scannée) (Agent 5, reco 5.B)
**Doctrine** : Pilier 4 + 6. Incarne le document.

**UX** : Champ "Ma signature" sur `/account` (upload image PNG transparent). Si présente, ajoutée en bas du PDF avec "Guillaume Martin — Dirigeant".

**Charge mentale** : ↓ (Sylvie voit que c'est Guillaume qui assume)
**Effort** : S (~2h)

#### Slice S3 — URL stable de vérification + bouton "Sauvegarder ce PDF" (Agent 5, reco 5.C)
**Doctrine** : Pilier 6. Sylvie veut archiver pour son dossier qualité.

**UX** :
- Sur la page publique `/p/[token]`, ajouter un bouton "Télécharger pour archivage" très visible
- Le QR du PDF pointe vers une URL **stable et permanente** (même après expiration du share_token) qui prouve l'authenticité (sans afficher le contenu)

**Charge mentale** : ↓ (Sylvie n'a pas peur du lien temporaire)
**Effort** : M (~4h — nouvelle table `proof_verification_tokens` permanente, séparée de `proof_share_tokens` temporaire)

---

## Récapitulatif par effort

| Slice | Effort | Doctrine | Priorité hypothèse |
|---|---|---|---|
| J1 — Bonjour Joseph | XS | P5 | 🔴 si terrain valide |
| P3 — Réutiliser note mois dernier | XS | P2 | 🟢 confort |
| M1 — Partager dans WhatsApp | S | P3 archétype | 🔴 |
| P2 — Preview test envoi | S | P4 | 🟠 |
| J2 — Bouton photo plein-largeur | S | P5 | 🔴 si friction observée |
| J3 — Session 24h | S | P2 | 🔴 si déconnexions répétées |
| S1 — Co-branding | S | P6 | 🔴 si client demande crédibilité |
| S2 — Signature DG | S | P4+6 | 🟠 |
| P1 — Voice note DG | M | P4 | 🟠 dépend des retours sur la note actuelle |
| C1 — Won/lost minimal | M | P1 | 🟢 si Guillaume perd un AO en mai |
| C2 — Encart mémoire AO similaire | M | P2 | 🟢 dépend de C1 |
| M2 — Briefing du soir | M | P3 | 🟠 |
| S3 — URL stable | M | P6 | 🟠 |

**Total effort si tout pris** : ~25h subagents (~3 jours de travail).
**Total effort si subset prudent (top 5 priorités 🔴)** : ~9h (~1 jour).

---

## Slices catégoriquement REFUSÉES (anti-doctrine V5)

Quand le terrain demandera ces features, opposer la doctrine :

| Demande probable | Refus | Argument doctrinal |
|---|---|---|
| Notification push à l'agent réassigné | ❌ | Pilier 3 corollaire — pas de dispatch temps réel |
| Score qualité agent | ❌ | Maxim 1 (V3) — mesure individu interdite |
| Comparaison Alpha vs Beta | ❌ | Métrique d'équipe interdite |
| Disponibilités équipe en temps réel | ❌ | Lutte contre WhatsApp sur fonction émotionnelle |
| Génération IA de la note DG | ❌ | Pilier 4 — désincarne le document |
| Auto-réassignation IA | ❌ | Maeva doit garder la décision |
| Module "absences" | ❌ | RH, hors scope |
| GPS / pointage | ❌ | Maxim 1 (V3) — surveillance |
| Compte de connexion par agent | ❌ | Maxim 9 (V5) — surveillance hors UI |
| Auto-envoi rapport mensuel le 1er | ❌ | Pilier 4 — Guillaume reste l'auteur |
| Forecast revenue / pipeline | ❌ | CRM creep |

---

## Slices d'observation pilote (à ajouter si signaux remontent)

À ne PAS coder à l'avance. À écouter activement pendant pilote :

- 🔍 Frustration vocabulaire mobile (passage vs mission)
- 🔍 Déconnexions répétées Joseph/Sandrine
- 🔍 Tentation de Guillaume de poster noms dans WhatsApp pilote
- 🔍 Sandrine qui pleure dans sa voiture (Agent 6 prédit jeudi matin)
- 🔍 Tarek qui crée spontanément un canal d'entraide
- 🔍 Sylvie qui demande "pourquoi le lien expire"
- 🔍 Joseph qui demande à imprimer ses missions papier

Si UNE de ces observations est confirmée → slice ajoutée à la roadmap. Si NON → on n'invente pas.

---

## La règle de réactivation

Le 20 mai 2026 à 9h, ouvrir ce doc et :

1. **Confronter chaque slice** au carnet papier de Guillaume
2. **Garder uniquement les slices validées par friction observée**
3. **Ajouter les slices nées de l'observation imprévue**
4. **Trier par effort × valeur observée** (pas par valeur supposée)
5. **Lancer le sprint** avec max 5-8 slices, pas 13

Si le pilote a échoué subjectivement (Sandrine en résistance, Guillaume a posté des noms) → la priorité absolue redevient la **doctrine V5 culturelle**, pas le code. Reporter le sprint d'1 semaine et refaire un briefing humain élargi.

---

## La phrase à retenir

> **« Le pilote produit de la réalité brute. Le sprint post-pilote consomme cette réalité brute. Coder avant le pilote = optimiser des hypothèses intellectuelles. »**
