# Cartographie du code

Pour chaque fonctionnalité, les fichiers qui la portent.

---

## Auth

| Fichier | Rôle |
|---|---|
| `app/(auth)/login/LoginForm.tsx` | Formulaire login client |
| `app/(auth)/login/actions.ts` | Server action login (supabase.auth.signInWithPassword) |
| `app/(auth)/accept-invite/AcceptInviteForm.tsx` | Formulaire acceptation invitation |
| `app/(auth)/change-password/ChangePasswordForm.tsx` | Formulaire changement mdp forcé |
| `lib/db/users.ts` | getCurrentUserWithProfile, getUserRoleById |
| `lib/supabase/server.ts` | Création client avec cookies session |

---

## AO / Tenders

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/tenders/[id]/page.tsx` | Page principale AO (server component) |
| `app/(dashboard)/tenders/[id]/TenderSidebar.tsx` | Navigation latérale AO |
| `app/(dashboard)/tenders/[id]/AtelierIATab.tsx` | Interface chat Atelier IA |
| `app/(dashboard)/tenders/[id]/engagements/page.tsx` | Page curation engagements |
| `app/(dashboard)/tenders/[id]/engagement-curation-view.tsx` | Composant liste + édition engagements |
| `app/(dashboard)/tenders/[id]/engagements-actions.ts` | Server actions engagements (extract, curate, reject, archive, createManual, createContract) |
| `app/(dashboard)/tenders/[id]/atelier-export.pdf/route.ts` | Route handler PDF export Atelier IA |
| `app/api/tenders/[id]/analyze/route.ts` | Déclenche analyse IA |
| `app/api/tenders/[id]/status/route.ts` | Poll statut analyse |
| `lib/db/tenders.ts` | CRUD AO, analyses, documents, voice notes |
| `lib/db/engagements.ts` | Cycle de vie engagements |
| `services/ai/initial-analysis.ts` | Analyse IA initiale |
| `services/ai/engagement-extraction.ts` | Extraction engagements par IA |
| `services/ai/orchestrator.ts` | Agents parallèles Atelier IA |

---

## Dashboard

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/dashboard/page.tsx` | Page cockpit (appels parallèles) |
| `app/(dashboard)/dashboard/StatsBand.tsx` | Bande KPI du haut |
| `app/(dashboard)/dashboard/AtRiskEngagementsWidget.tsx` | Engagements sans couverture |
| `app/(dashboard)/dashboard/ContractsUnderTensionWidget.tsx` | Contrats en difficulté |
| `lib/db/dashboard.ts` | Toutes les requêtes cockpit (getWeekPulse, getCapitalPreuves…) |

---

## Planning / Semaine

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/semaine/TeamWeekGridClient.tsx` | Grille DnD client |
| `app/(dashboard)/semaine/TeamWeekGrid.tsx` | Layout colonnes équipes |
| `app/(dashboard)/semaine/CellDrawer.tsx` | Drawer détail cellule |
| `app/(dashboard)/semaine/ReassignTeamDialog.tsx` | Réaffectation équipe |
| `lib/db/week-planning.ts` | Requêtes planning semaine |

---

## Contrats / Missions

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/contracts/[id]/page.tsx` | Fiche contrat avec onglets |
| `app/(dashboard)/contracts/[id]/contract-tabs.tsx` | Onglets (Sites/Missions/Interventions/Compliance/Rapport) |
| `app/(dashboard)/contracts/[id]/missions/[missionId]/edit/mission-editor.tsx` | Éditeur mission + récurrence |
| `app/(dashboard)/contracts/[id]/missions/[missionId]/edit/RecurrenceSection.tsx` | Gestion templates récurrence |
| `app/(dashboard)/contracts/[id]/interventions-actions.ts` | Server actions interventions |
| `app/(dashboard)/contracts/[id]/missions-actions.ts` | Server actions missions |
| `app/(dashboard)/contracts/[id]/recurrences-actions.ts` | Server actions templates |
| `app/(dashboard)/contracts/[id]/engagement-compliance.tsx` | Tableau compliance engagements |
| `lib/db/missions.ts` | CRUD missions |
| `lib/db/intervention-templates.ts` | Templates de récurrence |
| `lib/recurrence/` | Logique génération interventions paresseuse |

---

## Interventions terrain

| Fichier | Rôle |
|---|---|
| `app/(field)/m/intervention/[id]/page.tsx` | Interface mobile terrain |
| `app/(dashboard)/interventions/[id]/page.tsx` | Vue manager d'une intervention |
| `app/(dashboard)/interventions/[id]/execution-panel.tsx` | Checklist + notes |
| `app/(dashboard)/interventions/[id]/anomalies-panel.tsx` | Signalement anomalies |
| `app/(dashboard)/interventions/[id]/validation-panel.tsx` | Validation |
| `app/(dashboard)/interventions/[id]/participants-panel.tsx` | Participants |
| `app/(dashboard)/interventions/[id]/intervention-actions.ts` | Server actions (complete, validate, skip, upload photo…) |
| `lib/db/interventions.ts` | CRUD interventions |

---

## Briefing

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/briefing/page.tsx` | Page briefing + formatBriefingShareText() |
| `app/(dashboard)/briefing/SiteNotesPopover.tsx` | Notes site en popover |
| `app/(dashboard)/briefing/TeamCompositionPopover.tsx` | Composition équipe |
| `components/share/ShareInterventionButton.tsx` | Bouton partage WhatsApp (mobile/desktop) |
| `lib/db/evening-briefing.ts` | getEveningBriefing() avec couverture par site |

---

## Preuves / Litige

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/preuves/page.tsx` | Liste preuves avec filtres |
| `app/(dashboard)/preuves/[id]/page.tsx` | Fiche preuve détaillée |
| `app/(dashboard)/preuves/[id]/ProofPhotoGrid.tsx` | Grille photos |
| `app/(dashboard)/preuves/[id]/dossier/route.ts` | PDF dossier preuve |
| `app/(dashboard)/litige/LitigeWizard.tsx` | Wizard litige express |
| `app/(dashboard)/litige/dossier/route.ts` | PDF litige |
| `app/p/[token]/page.tsx` | Partage public |
| `lib/db/proofs.ts` | Requêtes preuves |
| `lib/db/proof-share.ts` | Tokens partage |

---

## Équipes

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/equipes/page.tsx` | Liste équipes |
| `app/(dashboard)/equipes/EditTeamMembersDialog.tsx` | Gestion membres |
| `app/(dashboard)/equipes/TeamReferentEditor.tsx` | Édition référent |
| `app/(dashboard)/equipes/actions.ts` | Server actions équipes |
| `lib/db/teams.ts` | CRUD équipes + membres |

---

## Admin

| Fichier | Rôle |
|---|---|
| `app/admin/layout.tsx` | Layout admin (garde rôle admin) |
| `app/admin/users/page.tsx` | Liste utilisateurs |
| `app/admin/users/actions.ts` | Server actions : create, changeRole, forceReset, updatePhone, delete |
| `app/admin/monitoring/page.tsx` | Monitoring (en développement) |
| `lib/db/users.ts` | updateUserRoleAsAdmin, softDeleteUserAsAdmin, updateUserProfileAsAdmin |
| `lib/audit/log.ts` | logAuditEvent() |

---

## IA

| Fichier | Rôle |
|---|---|
| `services/ai/factory.ts` | Sélection provider selon AI_PROVIDER env |
| `services/ai/providers/` | Implémentation Anthropic / Gemini / mock |
| `services/ai/orchestrator.ts` | Lancement parallèle agents Atelier IA |
| `services/ai/agents/` | Logique spécifique par agent |
| `services/ai/prompts/` | Prompts versionnés (string templates) |
| `services/ai/tracking.ts` | Log usage tokens → table ai_usage |

---

## Bibliothèque

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/library/page.tsx` | Vue liste/carte |
| `app/(dashboard)/library/KnowledgeItemDrawer.tsx` | Drawer édition item |
| `app/(dashboard)/library/actions.ts` | CRUD items |
| `lib/db/knowledge.ts` | Requêtes knowledge |
| `services/ai/library-context.ts` | Construit le contexte bibliothèque pour les prompts IA |
