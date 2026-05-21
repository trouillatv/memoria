# Passation — Le passage de témoin automatique

> **Le killer feature de MemorIA. Le tournant produit. La preuve par le code que la continuité opérationnelle est possible.**

**Date** : 2026-05-22 (Sprint C livré).
**Statut** : Production. Migration 079 appliquée. Polish mobile-first + QR livré Sprint D'.

---

## Le problème résolu

Voici le cauchemar opérationnel quotidien :

> Sandrine couvre 4 sites depuis 2 ans. Elle démissionne ou bascule dans une autre équipe. Joseph la remplace. Joseph arrive sur le site CHT Magenta lundi à 5h30 et **n'a aucune idée** que :
> - Le SAS B est en travaux et qu'il faut passer par le C après 19h
> - Le client Pascal préfère qu'on le prévienne par WhatsApp et pas par mail
> - Il y a eu 3 anomalies « produit manquant » sur ce site en mars
> - Il existe un plan d'accès stocké dans MemorIA avec le code badge
> - Une autre équipe (Beta) a déjà fait du back-up ici et peut dépanner

**Tout ça était dans la tête de Sandrine. Sandrine n'est plus là. La mémoire est perdue.**

Sur 50 sites, ce scénario se reproduit 3-4 fois par an. Chaque fois c'est un client mécontent, une intervention ratée, un agent qui se prend la tête.

---

## La solution

Quand un événement de transition se déclenche (départ d'agent, changement d'équipe, prise de nouveau site), MemorIA compile **en 2 secondes** un brief de continuité avec **tout ce qui est dans sa mémoire** sur les sites concernés.

Deux types de briefs :

### Type 1 — Changement d'équipe (`member_change`)
Déclenché depuis `/intervenants/[id]` : bouton **« Préparer un passage de témoin »**.

Saisie :
- Sujet : la personne qui bascule
- Équipe d'origine (optionnel — sinon prend toutes ses équipes actives)
- Équipe de destination (optionnel)

Sortie : brief multi-sites focalisé sur ce que la personne couvrait.

### Type 2 — Prise de nouveau site (`team_takes_site`)
Déclenché depuis `/equipes/[id]` : bouton **« Brief pour une prise de site »**.

Saisie :
- L'équipe qui prend
- Le site concerné

Sortie : brief mono-site avec toute la mémoire accumulée par les équipes précédentes.

---

## Le contenu du brief

Pour chaque site concerné, MemorIA compile :

| Bloc | Source | Cap |
|---|---|---|
| **À savoir** | `site_notes` avec `kind='a_savoir'` et `active_until` actif | 8 max |
| **Anomalies actives** | `intervention_anomalies` `status='open'` + 90 derniers jours | 5 max |
| **Documents rattachés** | `document_links` `target_type='site'` (`status='active'`, **litiges exclus**) | 6 max |
| **Équipes voisines** | équipes ayant aussi couvert ce site (back-up potentiel) | 4 max |
| **Compteurs** | total interventions documentées + dernière date | — |

Plus :
- **Notes manager** : zone éditoriale libre (1 seule partie du brief qui reste modifiable post-création)

Tri par fréquence d'intervention (sites les plus connus en premier).

---

## Le snapshot immuable

> **Une fois généré, le payload JSONB du brief ne change plus.**

Un brief de mars 2026 reflète **mars 2026** même rouvert en juin. Implications structurantes :

1. **Audit** — on peut prouver ce qui a été transmis à qui
2. **Responsabilité** — qui savait quoi à quel moment, irréfutable
3. **Continuité** — la mémoire transmise ne se réécrit pas

Le snapshot transforme le brief d'**information temporaire** en **objet opérationnel persistant**. C'est ce qui le rend juridiquement défendable.

Seul `payload.manualNotes` reste éditable (zone éditoriale manager). Le reste est figé.

---

## Le cycle de vie

```
draft (à transmettre) → shared (URL publique) → acknowledged (reconnu) → archived
```

| Statut | Sens |
|---|---|
| `draft` | Créé, pas encore partagé. Manager peut éditer les notes. |
| `shared` | Token public actif. Compteur d'accès. Expiration paramétrable 1-60 jours. |
| `acknowledged` | Le destinataire a confirmé « C'est lu, j'ai compris » via bouton public OU le manager l'a marqué côté admin. |
| `archived` | Soft-delete. Consultable dans onglet dédié, ne ré-apparaît plus en `draft`. |

---

## Le partage public `/h/[token]`

Token URL-safe (base64url, 32 chars) généré côté serveur via `crypto.randomBytes(24)`. Pattern aligné sur `proof_share_tokens`.

**4 états gérés** : 404 (token inconnu) / archivé / expiré / actif.

**Audit silencieux** :
- `access_count` incrémenté à chaque consultation
- `last_accessed_at` mis à jour
- Pas de cookie, pas d'analytics tiers

**Polish Sprint D'** :
- Mobile-first absolu (lu sur téléphone à 5h30 sous parking)
- Sommaire cliquable si plusieurs sites
- Bouton « C'est lu, j'ai compris » → bascule `acknowledged` sans login
- Open Graph metadata propre pour prévisualisation WhatsApp/Slack/iMessage
- `robots: noindex` (pages publiques non indexées)

**QR code** côté manager (modale partage) — génération via lib `qrcode`, PNG 200×200 prêt à screenshoter pour WhatsApp.

---

## La frontière doctrinale

Le brief documente **les sites** et la mémoire utile à transmettre. **Jamais** la personne qui s'en va.

| ✅ Autorisé (sujet = mémoire / site) | ❌ Interdit (sujet = personne) |
|---|---|
| « 3 sites concernés par cette passation » | « Évaluation de la personne qui part » |
| « Voici les consignes À savoir » | « Pourquoi elle part » |
| « Anomalies actives sur ces sites » | « Sa performance passée » |
| « Équipes voisines pour back-up » | « Sa note de fin de contrat » |

**Self-exclu** : une personne ne peut pas générer son propre brief de passage de témoin. Garde-fou doctrinal — un brief de passation n'est pas un dossier personnel.

---

## La résolution intégrée (Sprint D)

Depuis le brief, le manager peut **résoudre une anomalie inline** (bouton compact `ResolveAnomalyButton`). Application directe de la doctrine [[lien-utile-aide-a-agir]] : la mémoire ne se contente pas de montrer, elle ouvre une action.

Conséquence : les briefs **futurs** ne montreront plus cette anomalie. Le brief courant reste immuable (snapshot), mais la mémoire vive est nettoyée.

---

## Volumes & garde-fous

Caps appliqués dans `lib/db/handover.ts` :
- **Sites par brief** : 12 max
- **Anomalies par site** : 5 max
- **Documents par site** : 6 max
- **Équipes voisines par site** : 4 max

Au-delà, le brief deviendrait illisible. La discipline de cap est explicite (constantes nommées `SITE_CAP`, `ANOMALY_PER_SITE`, etc.).

**Litiges exclus** automatiquement (doctrine `litige-no-automatic-reading`).

---

## Métriques observation pilote

Cf. memory `ordre-sprints-post-passage-temoin` pour les critères chiffrés. Volumes essentiels :

- Briefs créés / semaine
- Briefs partagés (`shared_token IS NOT NULL`)
- Briefs consultés (`SUM(access_count)`)
- Briefs reconnus
- Délai création → partage
- Délai partage → consultation
- Ratio reconnaissances / partages

Signaux d'alerte :
- 🚨 0 brief créé en 14 jours = feature invisible
- 🚨 Briefs créés mais 0 partagés = Guillaume n'ose pas envoyer
- 🚨 Feedback « trop d'info » > 2 = brief fantôme

---

## Liens

- [Vision Produit](vision-produit.md) — le cadre
- [Continuité opérationnelle](continuite-operationnelle.md) — pourquoi c'est central
- [Doctrine mémoire](doctrine-memoire.md) — règles du contenu
- [Doctrine RH](doctrine-rh.md) — la frontière personne / mémoire
- `lib/db/handover.ts` — implémentation (allowlist agrégats par team/user)
- `app/h/[token]/page.tsx` — la vitrine publique
