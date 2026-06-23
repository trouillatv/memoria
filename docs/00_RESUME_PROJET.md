# MemorIA — Résumé projet

## Qu'est-ce que c'est

MemorIA est une **mémoire opérationnelle augmentée** pour les chantiers et les organisations qui les pilotent. Le produit **capte** ce qui se passe (réunions, audio, photos, déclarations terrain), le **structure** en objets métier réutilisables (actions, réserves, décisions, obligations, sujets, blocages), et le **restitue** au bon moment (préparer une réunion, interroger un site, raconter un chantier, produire une preuve).

**Ce n'est pas** un ERP, ni un Gantt, ni un drive, ni un chatbot. C'est la mémoire d'un *lieu* et de son histoire — l'outil **survit aux ruptures humaines** (CDD qui finit, contrat qui change de main) et **contextualise** plutôt qu'il ne génère.

> Historique : MemorIA est né comme SaaS de gestion pour le nettoyage industriel (axes AO / terrain / preuve). Il a pivoté (mig 099+) vers la **mémoire opérationnelle multi-métier** — le cœur est désormais la réunion de chantier, le compte-rendu (CR/PV) et la mémoire du lieu. La preuve est devenue un **sous-produit** de valeur, plus la finalité.

## Positionnement

- **Multi-métier**, pas seulement BTP : VRD/MOE (pilote BECIB), propreté (pilote AGP), électricité, CVC, SSI… Le vocabulaire est paramétrable (glossaire), les objets sont génériques.
- **Le moat** : assembler la mémoire *utile* au moment où elle sert ; comprendre l'état réel d'un chantier mieux qu'un humain qui oublie. Déterministe d'abord, LLM encadré ensuite.
- **3 rôles mémoriels** transverses aux métiers : Producteur (capte) · Porteur (coordonne) · Consommateur (preuve).

## Utilisateurs

| Rôle | Périmètre |
|---|---|
| `admin` | Gestion utilisateurs, glossaire, observation d'usage, monitoring, accès total |
| `manager` | AO, contrats, réunions/CR, sites & mémoire, actions, preuves, planning |
| `chef_equipe` | Interface mobile terrain : interventions, photos, anomalies, déclarations |
| *externe* | Sans login, via jeton signé : déclaration d'entreprise (`/a`, `/i`), passation (`/h`), journal QR (`/qr`), preuve (`/p`) |

## Les piliers produit

### 1. Copilote AO
Dépôt + analyse IA d'un appel d'offres (contraintes, risques, checklist, score, mémoire technique), **extraction d'engagements typés**, Atelier IA multi-agent, **audit documentaire** (provenance navigable à 3 niveaux de confiance), conversion en contrat → site.

### 2. Réunions → Compte-rendu / PV
Enregistrement audio multi-sources → transcription (corrigée par le **glossaire métier**) → analyse IA → **validation humaine typée** (l'IA rédige, l'humain valide ; « points à confirmer avant PV ») → **PDF auto-rempli au gabarit du client** (docxtemplater + LibreOffice). Détecte actions, décisions, risques→blocages, prévisions.

### 3. Mémoire du lieu
Pour chaque site : **mémoire du lieu** (TraceStream), **journal** (brut + météo Open-Meteo), **Récit du chantier** (jalons lus comme une histoire + synthèse déterministe), **sujets** (l'histoire d'un problème), **obligations** (objet prescriptif), **blocages** (mémoire de contexte), **préparer la réunion** (détecteurs déterministes), **recherche par sujet**.

### 4. Preuve & continuité
Dossier de preuve, **passation** (URL/QR/PDF), déclarations d'entreprises via QR (Fait/Bloqué + photo + signature), inbox « Nouveau depuis hier », notifications.

## Stack technique

- **Framework** : Next.js App Router (16.x) + Turbopack · React 19
- **Backend** : Supabase (Auth, PostgreSQL + **pgvector**, Storage, RLS) · **multi-tenant** (organization_id)
- **IA** : factory multi-provider (Anthropic Claude, Gemini, mock) + orchestrateur d'agents ; **déterministe vs LLM** explicite
- **Documents** : docxtemplater + LibreOffice (Word/Excel → PDF, gabarit client) ; @react-pdf (secours) ; unpdf (extraction AO)
- **Météo** : Open-Meteo (sans clé) enrichit `site_day_log`
- **Tests** : Vitest (projet `unit` sans DB en CI + `integration` sur vraie Supabase)
- **Style** : Tailwind CSS v4, shadcn/ui, sonner

## État au 2026-06-24

~161 migrations. Multi-tenant. Phase de **test terrain** sur deux pilotes (BECIB/MOE et AGP/propreté). Cœur CR gelé ~90 % ; l'énergie va à la **mémoire chantier** (préparation de réunion, recherche par sujet, obligations, récit). Prochaine priorité de fond : **compréhension utilisateur** (observation des parcours, déjà outillée via `/admin/usage`) plutôt que nouvelles features.
