# Structure des dossiers

```
NetoIAge/
├── app/
│   ├── (auth)/                        — Routes publiques non authentifiées
│   │   ├── login/
│   │   ├── accept-invite/
│   │   └── change-password/
│   │
│   ├── (dashboard)/                   — App principale (session requise)
│   │   ├── layout.tsx                 — Layout dashboard avec nav latérale
│   │   ├── dashboard/                 — Cockpit manager
│   │   ├── missions/                  — Vue globale missions
│   │   ├── semaine/                   — Grille semaine (DnD équipes)
│   │   │   └── export/                — Route export Excel
│   │   ├── contracts/
│   │   │   └── [id]/
│   │   │       ├── missions/
│   │   │       │   └── [missionId]/edit/
│   │   │       ├── interventions/
│   │   │       ├── sites/
│   │   │       └── rapport-mensuel/
│   │   ├── tenders/
│   │   │   ├── [id]/
│   │   │   │   ├── engagements/
│   │   │   │   ├── convert/           — Création contrat depuis AO
│   │   │   │   └── atelier-export.pdf/ — Route handler PDF Atelier IA
│   │   │   ├── memoire/               — Journal mémoire commerciale
│   │   │   └── new/
│   │   ├── interventions/
│   │   │   └── [id]/                  — Fiche intervention (manager)
│   │   ├── preuves/
│   │   │   └── [id]/
│   │   │       └── dossier/           — Route handler PDF preuve
│   │   ├── briefing/                  — Briefing du soir
│   │   ├── preparation/               — Préparation chefs d'équipe
│   │   ├── equipes/                   — Gestion équipes
│   │   ├── sites/                     — Vue globale sites
│   │   ├── library/                   — Bibliothèque connaissance
│   │   ├── litige/
│   │   │   └── dossier/               — Route handler PDF litige
│   │   └── account/                   — Compte utilisateur
│   │
│   ├── (field)/                       — Interface mobile chefs d'équipe
│   │   └── m/intervention/[id]/       — Fiche intervention terrain
│   │
│   ├── admin/                         — Backoffice admin
│   │   ├── layout.tsx
│   │   ├── users/                     — Gestion utilisateurs
│   │   └── monitoring/                — Monitoring adoption + santé opérationnelle
│   │
│   ├── api/
│   │   └── tenders/[id]/
│   │       ├── analyze/               — Déclenche analyse IA
│   │       └── status/                — Poll statut analyse
│   │
│   ├── p/[token]/                     — Preuve publique (sans auth)
│   │   └── pdf/
│   └── v/[token]/                     — Vérification publique
│
├── lib/
│   ├── db/                            — Couche accès données par entité
│   │   ├── users.ts
│   │   ├── tenders.ts
│   │   ├── engagements.ts
│   │   ├── missions.ts
│   │   ├── interventions.ts
│   │   ├── intervention-templates.ts
│   │   ├── proofs.ts
│   │   ├── teams.ts
│   │   ├── sites.ts
│   │   ├── contracts.ts
│   │   ├── dashboard.ts
│   │   ├── evening-briefing.ts
│   │   ├── knowledge.ts
│   │   ├── monthly-report.ts
│   │   ├── proof-share.ts
│   │   ├── week-planning.ts
│   │   └── ...
│   ├── supabase/
│   │   ├── server.ts                  — Client server (RLS respecté)
│   │   └── admin.ts                   — Client admin (bypass RLS)
│   ├── audit/
│   │   └── log.ts                     — logAuditEvent()
│   ├── pdf/                           — Composants React PDF
│   ├── recurrence/                    — Logique génération interventions
│   ├── format.ts                      — Utilitaires formatage dates/nombres
│   └── utils.ts                       — cn(), helpers généraux
│
├── services/
│   └── ai/
│       ├── factory.ts                 — Sélection provider
│       ├── orchestrator.ts            — Agents parallèles
│       ├── chat.ts                    — Atelier IA chat
│       ├── initial-analysis.ts        — Analyse AO
│       ├── engagement-extraction.ts   — Extraction engagements
│       ├── agents/                    — Logique par agent
│       ├── prompts/                   — Prompts versionnés
│       ├── providers/                 — Anthropic, Gemini, mock
│       └── tracking.ts                — Usage tokens
│
├── components/
│   ├── ui/                            — Composants shadcn/ui
│   ├── layout/                        — Shell, nav, breadcrumb
│   ├── providers/                     — ThemeProvider, etc.
│   └── share/                         — Boutons partage WhatsApp
│
├── types/
│   ├── db.ts                          — Types métier (interfaces DB)
│   └── sources.ts                     — Type Source (provenance IA)
│
├── supabase/
│   └── migrations/                    — Migrations SQL numérotées (001→036)
│
├── tests/
│   ├── setup.ts                       — Mocks globaux Vitest
│   ├── teardown.ts                    — Cleanup __test data après run
│   ├── components/
│   ├── lib/
│   ├── services/
│   └── doctrine/                      — Tests conformité doctrine
│
├── scripts/
│   └── dev/
│       ├── cleanup-test-data.ts       — Nettoyage manuel données __test
│       └── check-db-state.ts
│
├── docs/                              — Ce dossier
├── AGENTS.md / CLAUDE.md              — Instructions AI
├── vitest.config.ts
├── tsconfig.json
└── package.json
```
