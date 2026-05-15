# Phase 5 — Dossier de preuves

**Date** : 2026-05-11 (closed)
**Branche** : feat/pilot-ready (slices B.0 → B.5)

## Quoi

Le wedge émotionnel du produit. Quand un client appelle furieux ("vous n'avez pas
nettoyé la salle B mardi"), le DG cleaning ouvre `/preuves`, tape « salle B mardi »,
trouve l'intervention en <8 secondes, prépare un dossier PDF horodaté + un lien
de partage 7 jours en <30 secondes.

## Pourquoi

Identifié comme LE moment WOW du produit. Plus émotionnellement chargé que la
génération de mémoire technique AO car il touche tous les jours dans la vraie vie
(pas seulement quand un AO sort). C'est la fonctionnalité qui transforme MemorIA
d'un outil en un réflexe.

## Stack

- Route interne `/preuves` (admin/manager) — search + filters (site, statut, période) + pagination 50/page
- Route détail `/preuves/[id]` — header + meta band + checklist + photos + lightbox + validations + anomalies
- Migration `022_proof_share_tokens.sql` — table `proof_share_tokens` (token unique 32 chars base64url, expires_at, revoked_at, include_identities, access_count, last_accessed_at)
- Helpers `lib/db/proofs.ts` (searchProofs + getProofDetail anonymisé) + `lib/db/proof-share.ts` (CRUD tokens)
- PDF generator via `@react-pdf/renderer` — header tenant + footer fixe avec QR code + watermark MemorIA
- Route publique `/p/[token]` — sans auth, layout autonome, réutilise les composants `Proof*`
- Route PDF publique `/p/[token]/pdf` — authentifiée par token, généré on-demand (pas de storage)
- QR code via `qrcode` lib pointant vers l'URL publique
- Anonymisation par défaut : "Équipe terrain — N personnes" / "Équipe superviseur" (validations exposent un rôle, jamais une identité)
- Override identités : toggle admin requérant confirmation explicite + audit log

## Doctrine respectée

- **Anonymisation par défaut.** Aucun prénom/nom dans le PDF ni la page publique. Override explicite pour usage juridique uniquement.
- **Sobriété calme.** Pas de "ALERTE", pas de couleur rouge. Le mode sert aussi à réunion client, renouvellement, audit.
- **Pas de tracking analytics** sur la route publique. Seul `recordShareAccess` audit l'accès (access_count + last_accessed_at).
- **Pas de CTA marketing** sur la page publique. Pas de pub.
- **Calm wedge** : on rassure le DG, on ne traque pas l'agent.
- **Faits uniquement** : aucun score de performance, aucun jugement, aucune métrique. Compteurs photos / anomalies / validations.

## Décisions

- **Route /preuves** technique. **Wording UI "Dossier de preuves"** chaleureux.
- **Pas de "litige" dans l'UI** — trop anxiogène. Le mode sert AUSSI au renouvellement, à la réunion client, à l'audit qualité.
- **Token expires 7j par défaut** (max 30j, plafond applicatif). Soft-revoke supporté.
- **PDF on-demand** (pas de storage). Le PDF est regenerated à chaque téléchargement → signed URLs photos toujours fraîches.
- **MAX_PHOTOS_IN_PDF = 50.** Au-delà, footer note "X photos additionnelles via lien public".
- **Composants `Proof*` réutilisés** entre vue interne et vue publique → anonymisation centralisée, un seul endroit où risquer une fuite d'identité.
- **Lookup token par valeur côté `getShareTokenByValue`** filtre déjà revoked + expired → la route publique ne raisonne jamais en booléens fragiles.

## Limites connues

- Photos signed URLs ont TTL 1h → si le visiteur public garde l'onglet ouvert >1h sans refresh, les images peuvent expirer. Acceptable (rare en pratique).
- Pas de zoom/pan sur la lightbox. Pas de download photo individuelle (intentionnel — passage par le PDF complet).
- Pas de prefetch sur les liens des rows /preuves. Si latence perçue, à mesurer en pilote.
- `recordShareAccess` est lit-then-write (pas atomique). Acceptable pour audit, à upgrade RPC si volume croît.
- Pas de "à propos MemorIA" sur la page publique (pas encore de page about marketing — décision assumée).
- Schéma actuel : pas de FK directe `intervention_photos → anomalies`. Les photos `kind='anomaly'` sont rattachées heuristiquement à la première anomalie reportée dans `getProofDetail`. À normaliser si volume d'anomalies multi-photos par intervention augmente.

## Paramètres par défaut

- Pagination `/preuves` : 50/page
- Token : 7 jours, max 30
- `include_identities` : false par défaut
- PDF max photos : 50
- Threshold lightbox photo : open lazily, pas de preload

## Suite

- B.5+ : si pilote terrain demande, ajouter prefetch `/preuves`, download photo individuelle, zoom lightbox
- Phase 7 : cleanup chips déjà fait en Slice A.5 ✓
- Phase 8 : V1.2 réutilisation intelligente avec embeddings sémantiques
- Pilote terrain : 3 agents réels, 3 jours, observer les frictions invisibles autour du flow "client appelle → dossier prêt en 30s"
