# Chantier E — Rapport mensuel client

**Date** : 2026-05-12 (closed)
**Branche** : feat/monthly-report

## Quoi

Génération automatique du rapport mensuel à envoyer au client final. Avant : le DG passe 2-3h sur Excel+Word. Après : prévisualisation, sélection 6-12 photos parmi 30 candidates, note optionnelle, génération PDF horodaté + lien partage 30j en <3 minutes par contrat.

## Pourquoi

Le rapport mensuel client est un livrable contractuel obligatoire. C'est probablement la fonctionnalité qui transforme NetoIAge d'outil interne en livrable client attendu. Le client attend le rapport NetoIAge le 5 du mois. C'est ce qui crée la stickiness.

## Stack

- `lib/db/monthly-report.ts` — agrégation factuelle par contrat × mois (interventions, photos candidates, anomalies, segments boucle, tendance vs M-1, capital cumulé)
- Migration 026 — extension `proof_share_tokens` avec `contract_id`, `report_month`, `selected_photo_ids[]`, `dg_note`. CHECK XOR entre dossier preuve et rapport mensuel.
- `lib/pdf/monthly-report.tsx` — @react-pdf/renderer, 4 pages (couverture+indicateurs / photos sélectionnées / anomalies / capital+note DG), footer fixe QR + watermark
- Route `/contracts/[id]/rapport-mensuel?month=YYYY-MM` — preview interactive, sélection photos, note DG
- Route `/p/[token]` — étendue pour dispatch dossier preuve vs rapport mensuel
- Route `/p/[token]/pdf` — étendue idem

## Doctrine V4 respectée

Anti-rapport bullshit IA :
- Aucun texte généré IA dans le rapport
- Aucun score qualité calculé
- Aucun "satisfaction semble élevée" / "qualité remarquable"
- Compteurs + dates + listes factuelles + photos uniquement
- Note libre = signature humaine du DG (sa voix, pas l'IA)

Anti-anonymisation :
- Aucun nom d'agent dans le rapport (héritage Phase 5)
- "Équipe terrain" uniquement

## Décisions clés

- **À la demande, pas cron** : le DG approuve manuellement chaque rapport. Cron 1er du mois envisagé V2 si pilote demande.
- **Default month = mois précédent** : le mois "fini". Edge case janvier → décembre précédent. Bouton "Suivant" désactivé pour empêcher rapport mois en cours.
- **Sélection photos 6-12 max** : 6 pré-sélectionnées par défaut (caption non vide + diversité site). Cap dur 12.
- **Note 300 chars max** : signature courte, pas un mini-blog.
- **PDF 4 pages max** : couverture / photos / anomalies / capital. Resté concentré.
- **Réutilise infra Phase 5** : `proof_share_tokens` étendue plutôt que nouvelle table. Migration 026 légère.
- **30 jours validité** par défaut (vs 7 jours pour dossier preuve unitaire).

## Limites connues

- Photos signed URLs TTL 1h — le PDF généré au moment de la création est valide à l'instant T ; pour téléchargement tardif (J+25), les signed URLs sont régénérées à la volée.
- `AuditEntityType` n'a pas `contract` dans l'enum — l'audit log utilise `'report'` avec `contract_id` en metadata.
- Pas de portail client (login client) — c'est intentionnel V1. Lien temporaire suffit.
- Pas de génération automatique (cron) — manuelle pour cette V1.

## Paramètres par défaut

- Default month = mois précédent calendaire
- Photos sélection : 6 pré-sélectionnées, cap 12
- Note DG : 0-300 chars (optionnelle)
- Token validité : 30 jours
- PDF : 4 pages max

## Suite

- Pilote terrain : vérifier que le DG envoie effectivement les rapports
- V2 si validé : cron 1er du mois génère drafts automatiques
- V2 si validé : compteur de "rapports envoyés" sur le dashboard cockpit
- V2 si demandé : portail client (login lecture seule par contrat)
