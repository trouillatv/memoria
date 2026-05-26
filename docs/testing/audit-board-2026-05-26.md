# Audit produit — Board (2026-05-26)

> Audit complet par un **board de 6 auditeurs spécialisés**, chacun avec une lentille distincte,
> ancré sur le **produit réel** : code (fichier:ligne), 30 écrans capturés en live
> (`tmp/walkthrough/`), l'audit de parcours (`parcours-metier.md`) et la doctrine MemorIA.
> Lentilles : Stratégie · UX/design · Doctrine/éthique · Architecture/sécurité · IA/mémoire · Pilote/GTM.

## Verdict global

**MemorIA est sur une trajectoire défendable, et plus solide que prévu là où ça compte** : la doctrine
n'est pas déclarative, elle est **gravée dans le code** (tripwire CI `forbidden-symbols`, allowlist
`user_id` confinée, kill switch ENV, exclusion admin, litige jamais embeddé). Le moat (passation
pré-peuplée + capital client AO) est **techniquement réel**, pas un vœu.

Le risque n'est **pas conceptuel, il est démonstratif et relationnel** :
1. la meilleure feature (passation) est **invisible** en l'état (0 brief seedé, premier écran = liste ERP) ;
2. deux fissures **éthiques de relation** (transparence côté personne nulle ; heatmap individuelle symbolique) ;
3. une **fuite doctrinale vivante** (score cosine exposé en % dans l'UI AO).

Aucun bloquant n'est structurel ; tous sont corrigeables en heures/jours.

---

## Convergences du board (≥2 lentilles d'accord)

- **La promesse est implémentée mais pas montrée** (Stratégie + Pilote + UX) : backend de passation riche
  (`lib/db/handover.ts` pré-peuple sites/à-savoir/anomalies/équipes), mais 0 brief seedé + porte d'entrée
  `/missions` → le client voit une coquille. *Le ROI #1 est de rendre la promesse VISIBLE, pas de coder plus.*
- **Glissement ERP au premier contact** (UX + Stratégie) : `/missions` (131 lignes, doublons, 0 CTA) masque
  le dashboard mémoriel. Corrigé sur `fix/audit-live-parcours-metier`, **pas encore sur `main`**.
- **Fissure éthique = relation, pas structure** (Doctrine + Archi + UX) : pas de score/ranking/pointage RH,
  mais transparence côté personne = 0 et heatmap densité individuelle qui *lit* surveillance.
- **Couche IA = socle sûr mais sous-exploité** (IA + Stratégie) : coût maîtrisé et robuste, mais le
  différenciant promis (détection de contradictions, « le mur ») **n'existe pas encore**.

---

## Findings consolidés (dédupliqués)

### P0 — à traiter avant élargissement / démo client
| # | Finding | Lentille | Preuve |
|---|---------|----------|--------|
| 1 | **Promesse passation non démontrable** : 0 brief seedé, `/continuite` vide. Backend prêt. | Stratégie, Pilote | `parcours-metier.md` §M3/C4 ; `lib/db/handover.ts:342-496` |
| 2 | **Score cosine exposé en UI** : « Proximité avec votre mémoire : X% » = internal_score interdit. | IA (doctrine) | `app/(dashboard)/tenders/[id]/EvidencePanel.tsx:147,219` |
| 3 | **Transparence côté personne = 0** : la personne consultée ne sait pas qu'elle l'est (audit unilatéral). | Doctrine | `intervenants/[id]/page.tsx:136-148` |
| 4 | **Premier contact = `/missions`** (ERP) au lieu du dashboard. | UX, Stratégie | corrigé sur branche, à merger sur `main` |

### P1 — avant montée en charge
| # | Finding | Lentille | Preuve |
|---|---------|----------|--------|
| 5 | **Route PDF litige non auditée** (la *préparation* l'est, le *téléchargement* non). | Archi | `litige/dossier/route.ts` (0 `logAuditEvent`) vs `litige/actions.ts:157,207` |
| 6 | **Mot de passe en dur partagé `memoria2026`** pour créations/resets. | Archi | `app/admin/users/...actions.ts` (`TEMP_PASSWORD`) |
| 7 | **Audit log best-effort silencieux** : `logAuditEvent` avale l'échec → garde-fou #1 théorique. | Doctrine, Archi | `lib/audit/log.ts:58-61` |
| 8 | **Heatmap « Densité 90 j » par personne** : rendu = grammaire présentéisme (mais données = planning, pas pointage). | Doctrine, UX | `intervenants/[id]/page.tsx` (heatmap) |
| 9 | **Atelier IA à 4 clics + provider `mock` exposé** au manager : le moat est caché. | Stratégie, UX | `tenders/[id]/page.tsx` ; écran `manager/14` |
| 10 | **Chaîne d'action incomplète** : vigilances/engagements extraits sans suite (curation 1-par-1). | Stratégie, IA | `tenders/[id]/engagements`, `contracts/[id]` |
| 11 | **Coût IA non borné à l'échelle** : embeddings non-batchés + refresh résonances en N+1 par trace. | IA | `lib/ai/embeddings.ts:70` ; `refresh-site-readings.ts` |
| 12 | **« Le mur » (memory_contradiction) inexistant** : différenciant promis non livré (Phase 3 différée). | IA, Stratégie | pas de détecteur structurel ; `contradicteur.v1` = agent LLM only |
| 13 | **Connexions spontanées de Guillaume non instrumentées** : la métrique-clé du pilote manque. | Pilote | `admin/observation` (section « à instrumenter V2 ») |
| 14 | **Time-to-value à froid** : tenant réel vide = écrans « 0% / 0 note » anxiogènes. | Pilote, UX | `contracts/[id]`, `sites`, `documents` |

### P2 — polish / dette
- `/h/[token]` absent du bypass `proxy.ts` (auth.getUser inutile + risque de régression). `proxy.ts:23-31`.
- `recordHandoverShareAccess` : incrément non atomique (read-then-write) vs RPC `/p/`. `handover.ts:710`.
- **Garde-fou anti-prod seulement sur 1 script** (`reset-and-seed-nc-demo.ts`) ; `seed-demo.ts` et `db-push.ts` ne l'ont pas.
- RGPD : `payload` JSONB du brief immuable → pas de purge ciblée d'une identité/contact.
- Classement implicite par volume sur `/intervenants` (atténué par tri alpha).
- Frictions UX : contrat « 0% partout » (recadrer en action), doublons « Activité récente » site, 16 cartes « À venir » noyant le jour, colonnes mortes Score/Échéance sur `/tenders`, « [DEMO] » visible.
- Deux moteurs de résonance (token-overlap V5.1 + embeddings) à faire converger.
- `getTenantId() = sites.limit(1)` : hypothèse mono-tenant câblée (faille d'isolation future).

---

## Plan d'action recommandé (ordre)

**Lot A — démontrabilité & merge (1-2 j, débloque la démo)**
1. Merger `fix/audit-live-parcours-metier` sur `main` (post-login `/dashboard`, CTA passation, briefs dans `/m`).
2. Seeder ≥1 passation réaliste de bout en bout (créée → partagée → visible `/m` → 1 reconnue).
3. Corriger le **P0 cosine** `EvidencePanel.tsx:219` → libellé qualitatif (« reliée à votre mémoire ») + test CI scannant le JSX.

**Lot B — défendre « pas RH » (avant tout client réel)**
4. Transparence : self-page « vous avez été consulté X fois (par rôle) ».
5. Auditer la route PDF litige + rendre `logAuditEvent` non-silencieux (métrique d'échec dans monitoring).
6. Recadrer/déplacer la heatmap densité par personne (sujet = lieu) ou relabelliser « jours d'intervention ».

**Lot C — pilote observable**
7. Instrumenter connexions spontanées Guillaume (`last_sign_in_at` / sessions).
8. Adoucir les états vides + masquer les fuites techniques (`mock`, colonne Score).

**Lot D — montée en charge (post-pilote)**
9. Batcher embeddings + débouncer le refresh résonances.
10. Sortir `memoria2026` du code ; étendre le garde-fou anti-prod aux autres scripts d'écriture.

---

## Note de rigueur (correction factuelle)

Le board a infirmé une affirmation de `parcours-metier.md` : **la préparation d'un dossier litige EST auditée**
(`litige/actions.ts:157,207` → `litige_dossier_prepared`). Le trou réel est limité à la **route de
génération PDF** (`litige/dossier/route.ts`, non loggée). `parcours-metier.md` est corrigé en conséquence.
