# NetoIAge — Résumé projet

## Qu'est-ce que c'est

SaaS de gestion opérationnelle pour entreprises de nettoyage industriel. L'outil couvre trois axes : réponse aux appels d'offres (AO), suivi terrain des interventions, et constitution de dossiers de preuve en cas de litige.

**Principe directeur (Doctrine V5)** : mémoire opérationnelle par la preuve. Le produit rassure plus qu'il n'automatise. Il est transparent pour ceux qui exécutent, présent pour ceux qui signent.

## Utilisateurs

| Rôle | Périmètre |
|---|---|
| `admin` | Gestion utilisateurs, monitoring, accès total |
| `manager` | AO, contrats, missions, planning semaine, rapport mensuel |
| `chef_equipe` | Briefing, interventions terrain, photos, anomalies |

## Les trois axes produit

### 1. Mémoire commerciale (AO)
- Dépôt et analyse IA des appels d'offres
- Atelier IA : 7 agents spécialisés (lecteur AO, mémoire technique, contradicteur, financier, terrain, conformité, général)
- Extraction et curation des engagements contractuels
- Mémoire des AO passés (won/lost/withdrawn) pour enrichir les futurs dossiers
- Note vocale DG sur chaque AO finalisé

### 2. Mémoire terrain (Field)
- Planification semaine par glisser-déposer (vue équipes)
- Briefing du soir automatique avec partage WhatsApp
- Mode terrain mobile (`/m/intervention/[id]`) pour les chefs d'équipe
- Photos avant/après, anomalies, checklist d'engagement, validation
- Récurrence automatique des interventions (5 patterns : daily, weekdays, weekly, monthly, one_shot)
- Fiche site enrichie (codes accès, contact, instructions)

### 3. Mémoire de la preuve (Litige)
- Page `/preuves` : agrégation des interventions validées avec photos
- Dossier PDF généré en < 30s ("j'ai les preuves")
- Mode Litige express : filtrage par client/contrat/période + niveau de confiance
- Partage public via token (lien signé Supabase Storage)
- Rapport mensuel client par contrat

## Stack technique

- **Framework** : Next.js 16.2.6 App Router + Turbopack
- **Backend** : Supabase (Auth, PostgreSQL, Storage, Row Level Security)
- **IA** : factory multi-provider (Anthropic Claude, Gemini, mock), orchestrateur d'agents
- **PDF** : @react-pdf/renderer (route handlers)
- **Tests** : Vitest + @testing-library/react
- **Style** : Tailwind CSS v4, shadcn/ui, sonner (toasts)

## État au 2026-05-13

8 sprints doctrine V5 complétés. Application pilote-ready. Monitoring admin en cours de développement.
