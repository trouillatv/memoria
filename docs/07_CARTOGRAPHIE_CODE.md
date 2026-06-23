# Cartographie du code

Pour chaque domaine fonctionnel, les fichiers clés qui le portent. Les chemins sont relatifs à la racine du dépôt.

> Convention : `app/(dashboard)/**` = back-office connecté · `app/(field)/m/**` = terrain mobile · `app/(auth)/**` = authentification · `app/admin/**` = administration · `app/{a,c,h,i,p,qr,v}/[token]/**` = surfaces publiques par jeton · `lib/db/*.ts` = couche d'accès données (1 fichier par domaine) · `services/**` = IA + météo.

---

## Auth

| Fichier | Rôle |
|---|---|
| `app/(auth)/login/LoginForm.tsx` | Formulaire login client |
| `app/(auth)/login/actions.ts` | Server action login (signInWithPassword) |
| `app/(auth)/accept-invite/actions.ts` | Acceptation invitation |
| `app/(auth)/change-password/actions.ts` | Changement mot de passe forcé |
| `app/(auth)/forgot-password/page.tsx` | Demande de réinitialisation |
| `app/auth/callback/route.ts` | Callback OAuth/email Supabase |
| `lib/db/users.ts` | getCurrentUserWithProfile, getUserRoleById |
| `lib/supabase/server.ts` | Client serveur avec cookies de session |

---

## Dashboard / cockpit

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/dashboard/page.tsx` | Page cockpit (appels parallèles) |
| `app/(dashboard)/dashboard/StatsBand.tsx` | Bande KPI du haut |
| `app/(dashboard)/dashboard/StartBar.tsx` | Barre d'actions de démarrage |
| `app/(dashboard)/dashboard/DashboardInbox.tsx` | Inbox QR / contributions à traiter |
| `app/(dashboard)/dashboard/NotificationsBar.tsx` | Bandeau notifications d'accueil |
| `app/(dashboard)/dashboard/TenantMorningReadingCard.tsx` | Lecture mémoire du matin |
| `app/(dashboard)/dashboard/inbox-actions.ts` | Server actions inbox |
| `app/(dashboard)/dashboard/notifications-actions.ts` | Server actions notifications |
| `lib/db/dashboard.ts` | Requêtes cockpit (getWeekPulse, getCapitalPreuves…) |
| `lib/db/inbox-feed.ts` | Flux inbox unifié |
| `app/(dashboard)/aujourdhui/page.tsx` | Vue « Aujourd'hui » |

---

## AO / Tenders (+ Atelier IA, engagements, audit documentaire)

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/tenders/page.tsx` | Liste des AO |
| `app/(dashboard)/tenders/[id]/page.tsx` | Page principale AO (server component) |
| `app/(dashboard)/tenders/[id]/atelier-actions.ts` | Server actions Atelier IA (chat agents) |
| `app/(dashboard)/tenders/[id]/engagements/page.tsx` | Curation des engagements |
| `app/(dashboard)/tenders/[id]/engagements-actions.ts` | Cycle de vie engagements (extract, curate, reject, convert) |
| `app/(dashboard)/tenders/[id]/audit/page.tsx` | Audit documentaire de l'AO |
| `app/(dashboard)/tenders/[id]/outcome-actions.ts` | Issue de l'AO (gagné/perdu, capital client) |
| `app/(dashboard)/tenders/[id]/voice-note-actions.ts` | Notes vocales AO |
| `app/(dashboard)/tenders/[id]/convert/page.tsx` | Conversion AO → contrat |
| `app/(dashboard)/tenders/[id]/atelier-export.pdf/route.ts` | Export PDF Atelier IA |
| `app/api/tenders/[id]/analyze/route.ts` | Déclenche l'analyse IA |
| `app/api/tenders/[id]/status/route.ts` | Poll du statut d'analyse |
| `app/api/cron/sweep-stuck-tenders/route.ts` | Cron : déblocage analyses bloquées |
| `lib/db/tenders.ts` | CRUD AO, analyses, documents, notes vocales |
| `lib/db/engagements.ts` | Cycle de vie engagements |
| `lib/db/atelier-ia.ts` | État de l'Atelier IA |
| `lib/db/agent-analyses.ts` | Résultats des agents |
| `lib/db/tender-document-sources.ts` | Sources documentaires (audit) |
| `lib/db/tender-client-capital.ts` | Capital relationnel client |
| `lib/db/ao-experience.ts` | Mémoire d'expérience AO |

---

## Contrats

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/contracts/page.tsx` | Liste des contrats |
| `app/(dashboard)/contracts/[id]/page.tsx` | Fiche contrat avec onglets |
| `app/(dashboard)/contracts/[id]/sites/page.tsx` | Sites rattachés |
| `app/(dashboard)/contracts/[id]/sites-actions.ts` | Server actions sites du contrat |
| `app/(dashboard)/contracts/[id]/missions/page.tsx` | Missions / récurrences |
| `app/(dashboard)/contracts/[id]/missions-actions.ts` | Server actions missions |
| `app/(dashboard)/contracts/[id]/recurrences-actions.ts` | Templates de récurrence |
| `app/(dashboard)/contracts/[id]/interventions/page.tsx` | Interventions du contrat |
| `app/(dashboard)/contracts/[id]/rapport-mensuel/page.tsx` | Rapport mensuel |
| `app/(dashboard)/contracts/[id]/asavoir-actions.ts` | « À savoir » → site (lien terrain) |
| `app/(dashboard)/contracts/[id]/capsule/page.tsx` | Capsule de continuité contrat |
| `lib/db/contracts.ts` | CRUD contrats |
| `lib/db/missions.ts` | CRUD missions |
| `lib/db/intervention-templates.ts` | Templates de récurrence |
| `lib/db/monthly-report.ts` | Rapport mensuel |
| `lib/recurrence/` | Génération paresseuse des interventions |

---

## Sites & mémoire du lieu

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/sites/page.tsx` | Liste des sites |
| `app/(dashboard)/sites/[id]/page.tsx` | Fiche site (server component) |
| `app/(dashboard)/sites/[id]/IdentityHeader.tsx` | En-tête identité du site |
| `app/(dashboard)/sites/[id]/TraceStream.tsx` | Flux de traces (TraceStream) |
| `app/(dashboard)/sites/[id]/CurrentState.tsx` | État courant du chantier |
| `app/(dashboard)/sites/[id]/SiteReadingsList.tsx` | Lectures mémoire IA du site |
| `app/(dashboard)/sites/[id]/SiteMemoryQuery.tsx` | Interroger ce site |
| `app/(dashboard)/sites/[id]/SiteScopesSection.tsx` | Sous-périmètres interrogeables |
| `app/(dashboard)/sites/[id]/actions.ts` | Server actions fiche site |
| `app/(dashboard)/sites/[id]/journal/page.tsx` | Journal chantier (jour par jour) |
| `app/(dashboard)/sites/[id]/journal/JournalView.tsx` | Vue journal + météo |
| `app/(dashboard)/sites/[id]/journal/actions.ts` | Server actions journal |
| `app/(dashboard)/sites/[id]/recit/page.tsx` | Récit narratif du chantier (/recit) |
| `app/(dashboard)/sites/[id]/recit/SiteNarrativeView.tsx` | Timeline narrative (projection) |
| `app/(dashboard)/sites/[id]/scopes/[scopeId]/page.tsx` | Détail d'un sous-périmètre |
| `app/(dashboard)/sites/[id]/scope-actions.ts` | Server actions scopes |
| `app/(dashboard)/sites/[id]/site-brief-actions.ts` | Préparer ma visite (brief auto) |
| `app/(dashboard)/sites/[id]/memory-query-actions.ts` | Interrogation mémoire site |
| `app/(dashboard)/sites/[id]/resonance-actions.ts` | Résonances IA du site |
| `lib/db/sites.ts` | CRUD sites |
| `lib/db/site-cockpit.ts` | Données agrégées de la fiche site |
| `lib/db/site-journal.ts` | Journal jour par jour |
| `lib/db/site-day-log.ts` | Log journalier (1 entrée/jour) |
| `lib/db/site-day-log-meta.ts` | Métadonnées du log (météo, contexte) |
| `lib/db/site-narrative.ts` | Récit narratif |
| `lib/db/memory-scopes.ts` | Sous-périmètres mémoire |
| `lib/db/scope-suggestions.ts` | Suggestions de scopes |
| `lib/db/site-memory.ts` | Mémoire vivante du site |
| `lib/db/site-memory-signals.ts` | Détecteurs déterministes (états fragiles) |

---

## Réunions / Compte-rendu

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/meetings/page.tsx` | Liste des réunions |
| `app/(dashboard)/meetings/actions.ts` | Création / gestion réunions |
| `app/(dashboard)/meetings/[id]/page.tsx` | Détail réunion |
| `app/(dashboard)/meetings/[id]/PvPanel.tsx` | Panneau PV (génération / accès) |
| `app/(dashboard)/meetings/[id]/pv-actions.ts` | Server actions PV (analyse, génération) |
| `app/(dashboard)/meetings/[id]/pv/validation/page.tsx` | Écran de validation/reconstruction du PV |
| `app/(dashboard)/meetings/[id]/pv/validation/PvHumanPoints.tsx` | Points à confirmer avant PV |
| `app/(dashboard)/meetings/[id]/pv/validation/PvActionsBlock.tsx` | Actions du PV |
| `app/(dashboard)/meetings/[id]/pv/validation/PvDecisionsBlock.tsx` | Décisions du PV |
| `app/(dashboard)/meetings/[id]/pv/validation/PvPrevisionRow.tsx` | Prévisions structurées |
| `app/(dashboard)/meetings/[id]/pv/route.ts` | Rendu PV (DOCX/PDF) |
| `app/(dashboard)/meetings/[id]/pv/final/route.ts` | Version finale figée du PV |
| `app/(dashboard)/meetings/[id]/briefing/page.tsx` | Briefing de préparation réunion |
| `app/(dashboard)/meetings/[id]/PrepareMeetingBlock.tsx` | « Préparer cette réunion » + questions à poser |
| `app/(dashboard)/meetings/[id]/BlocagesPanel.tsx` | Panneau blocages de la réunion |
| `app/(dashboard)/meetings/[id]/ActionsCuration.tsx` | Curation des actions extraites |
| `app/(dashboard)/meetings/[id]/action-curation-actions.ts` | Server actions curation actions |
| `app/(dashboard)/meetings/[id]/MeetingMemoryHealth.tsx` | Santé de la mémoire (couverture) |
| `app/(dashboard)/meetings/[id]/memory-actions.ts` | Server actions mémoire réunion |
| `app/(dashboard)/meetings/[id]/share-actions.ts` | Partage actions vers entreprise |
| `app/(dashboard)/blocage-actions.ts` | Server actions blocages (transverses) |
| `lib/db/site-reports.ts` | Comptes-rendus / réunions |
| `lib/db/report-human-points.ts` | Points à confirmer (validation humaine) |
| `lib/db/report-point-actions.ts` | Actions par point examiné |
| `lib/db/report-added-points.ts` | Points ajoutés éditorialement |
| `lib/db/points-examines.ts` | Spine des points examinés |
| `lib/db/report-final-versions.ts` | Versions finales figées |
| `lib/db/report-analysis-runs.ts` | Runs d'analyse IA du CR |
| `lib/db/pv-signal-decisions.ts` | Décisions issues des signaux |
| `lib/db/meeting-followup.ts` | Suivi inter-réunions |
| `lib/db/action-codes.ts` | Codes d'action (gabarit PV) |

---

## Objets métier (actions · réserves · livraisons · décisions · blocages · sujets · obligations)

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/actions/page.tsx` | Menu central des actions de chantier |
| `app/(dashboard)/actions/actions.ts` | Server actions site_actions |
| `lib/db/site-actions.ts` | CRUD site_actions (3e pilier) |
| `lib/db/action-distribution.ts` | Distribution / relances des actions |
| `app/(dashboard)/sites/[id]/reserves/page.tsx` | Réserves du site |
| `app/(dashboard)/sites/[id]/reserves/actions.ts` | Server actions réserves |
| `lib/db/site-reserve.ts` | CRUD réserves |
| `app/(dashboard)/sites/[id]/livraisons/page.tsx` | Livraisons / réceptions |
| `app/(dashboard)/sites/[id]/livraisons/actions.ts` | Server actions livraisons |
| `lib/db/site-delivery.ts` | CRUD réceptions fournisseur |
| `lib/db/site-decisions.ts` | Décisions de chantier (entité durable) |
| `lib/db/decision-constants.ts` | Cycle de vie / constantes décisions |
| `app/(dashboard)/sites/[id]/DeclareBlocage.tsx` | Déclaration d'un blocage |
| `lib/db/site-blocages.ts` | CRUD blocages |
| `lib/db/blocage-constants.ts` | Constantes blocages |
| `app/(dashboard)/sites/[id]/subjects/page.tsx` | Sujets du site (unité de mémoire) |
| `app/(dashboard)/sites/[id]/subjects/actions.ts` | Server actions sujets |
| `lib/db/subjects.ts` | CRUD sujets + timeline |
| `lib/db/subject-relations.ts` | Relations entre sujets |
| `app/(dashboard)/sites/[id]/obligations/page.tsx` | Obligations du site (objet prescriptif) |
| `app/(dashboard)/sites/[id]/obligations/actions.ts` | Server actions obligations |
| `app/(dashboard)/sites/[id]/obligations/source/page.tsx` | Source CCTP d'une obligation |
| `lib/db/obligations.ts` | CRUD obligations + bibliothèque |
| `lib/db/site-previsions.ts` | Prévisions structurées |

---

## Casting / intervenants

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/intervenants/page.tsx` | Cartographie des intervenants |
| `app/(dashboard)/intervenants/[id]/page.tsx` | Fiche intervenant |
| `app/(dashboard)/intervenants/actions.ts` | Server actions intervenants |
| `app/(dashboard)/intervenants/[id]/offboarding-actions.ts` | Offboarding (continuité mémoire) |
| `lib/db/intervenants.ts` | CRUD intervenants |
| `lib/db/site-intervenants.ts` | Rôle ↔ site ↔ entreprise |
| `lib/db/companies.ts` | Entreprises (casting) |
| `lib/db/company-contacts.ts` | Contacts d'entreprise |
| `lib/db/intervention-companies.ts` | Entreprises sur intervention |

---

## Météo

| Fichier | Rôle |
|---|---|
| `services/weather/open-meteo.ts` | Client Open-Meteo (sans clé, sans scraping) |
| `app/(dashboard)/sites/[id]/journal/SiteWeatherFetch.tsx` | Récupération météo dans le journal |
| `app/(dashboard)/sites/[id]/journal/DayWeatherForm.tsx` | Saisie/édition météo du jour |
| `lib/db/site-day-log-meta.ts` | Stockage météo enrichie (site_day_log) |

---

## Glossaire (admin)

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/glossaire/page.tsx` | Page glossaire (admin-only) |
| `app/(dashboard)/glossaire/GlossaryManager.tsx` | Gestion du vocabulaire métier |
| `app/(dashboard)/glossaire/glossary-actions.ts` | Server actions glossaire |
| `lib/db/glossary.ts` | CRUD termes |
| `lib/db/glossary-seed.ts` | Vocabulaire de démarrage multi-métier |
| `lib/db/glossary-constants.ts` | Constantes glossaire |

---

## Interventions terrain (mobile /m)

| Fichier | Rôle |
|---|---|
| `app/(field)/m/page.tsx` | Accueil terrain mobile |
| `app/(field)/m/sites/page.tsx` | Liste sites (terrain) |
| `app/(field)/m/site/[siteId]/page.tsx` | Fiche site terrain (« Aujourd'hui ici ») |
| `app/(field)/m/site/[siteId]/report-actions.ts` | Compte-rendu depuis le terrain |
| `app/(field)/m/site/[siteId]/delivery-actions.ts` | Livraisons depuis le terrain |
| `app/(field)/m/intervention/[id]/page.tsx` | Interface intervention mobile |
| `app/(field)/m/intervention/[id]/actions.ts` | Server actions intervention |
| `app/(field)/m/intervention/[id]/voice-note-actions.ts` | Notes vocales / audio de secours |
| `app/(field)/m/meeting-actions.ts` | Capture réunion depuis le terrain |
| `app/(dashboard)/interventions/[id]/page.tsx` | Vue manager d'une intervention |
| `app/(dashboard)/interventions/[id]/intervention-actions.ts` | Server actions (complete, validate, photo…) |
| `lib/db/interventions.ts` | CRUD interventions |
| `lib/db/field-today.ts` | Données « aujourd'hui ici » |
| `lib/db/spontaneous-intervention.ts` | Intervention spontanée hors planning |

---

## Preuves & partage public (jetons /a /c /h /i /p /qr /v)

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/preuves/page.tsx` | Liste preuves avec filtres |
| `app/(dashboard)/preuves/[id]/page.tsx` | Fiche preuve / dossier vivant |
| `app/(dashboard)/preuves/[id]/dossier/route.ts` | PDF dossier preuve |
| `app/(dashboard)/litige/page.tsx` | Wizard litige express |
| `app/(dashboard)/litige/dossier/route.ts` | PDF litige |
| `app/(dashboard)/handovers/page.tsx` | Passages de témoin |
| `app/h/[token]/page.tsx` | Brief public passage de témoin (vitrine produit) |
| `app/h/[token]/pdf/route.ts` | PDF du brief |
| `app/a/[token]/page.tsx` | Contribution externe scopée (action) |
| `app/i/[token]/page.tsx` | Partage intervention (checklist à quantité) |
| `app/p/[token]/page.tsx` | Partage preuve public |
| `app/p/[token]/pdf/route.ts` | PDF preuve publique |
| `app/c/[token]/page.tsx` | Capsule de continuité publique |
| `app/v/[token]/page.tsx` | Vérification preuve publique |
| `app/qr/[token]/page.tsx` | Arrivée QR site (inbox terrain) |
| `app/(dashboard)/sites/[id]/qr/page.tsx` | Gestion du QR d'un site |
| `app/api/share-comment/route.ts` | Commentaire sur surface partagée |
| `lib/db/proofs.ts` | Requêtes preuves |
| `lib/db/proof-share.ts` | Jetons de partage preuve |
| `lib/db/proof-dossier.ts` | Assemblage dossier preuve |
| `lib/db/proof-verification.ts` | Vérification d'intégrité |
| `lib/db/handover.ts` | Passages de témoin |
| `lib/db/capsule-share.ts` | Jetons capsule |
| `lib/db/intervention-tokens.ts` | Jetons d'intervention |
| `lib/db/site-qr.ts` | QR par site |

---

## Équipes

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/equipes/page.tsx` | Liste équipes |
| `app/(dashboard)/equipes/[id]/page.tsx` | Fiche équipe |
| `app/(dashboard)/equipes/actions.ts` | Server actions équipes |
| `app/(dashboard)/semaine/page.tsx` | Planning semaine (grille DnD) |
| `app/(dashboard)/semaine/actions.ts` | Server actions planning |
| `lib/db/teams.ts` | CRUD équipes + membres |
| `lib/db/team-profile.ts` | Profil / compétences d'équipe |
| `lib/db/week-planning.ts` | Requêtes planning semaine |
| `lib/db/site-team-knowledge.ts` | Connaissance équipe ↔ site |

---

## Admin (users · usage · personnes · dépenses IA · monitoring)

| Fichier | Rôle |
|---|---|
| `app/admin/layout.tsx` | Layout admin (garde rôle admin) |
| `app/admin/page.tsx` | Accueil admin |
| `app/admin/users/page.tsx` | Liste utilisateurs |
| `app/admin/users/actions.ts` | create, changeRole, forceReset, updatePhone, delete |
| `app/admin/usage/page.tsx` | Analytics d'usage (parcours / heatmap / friction) |
| `app/admin/personnes/page.tsx` | Analyse d'usage par personne (option B, audité) |
| `app/admin/personnes/[id]/page.tsx` | Fiche personne (admin audité) |
| `app/admin/depenses-ia/page.tsx` | Dépenses IA (XPF) |
| `app/admin/observation/page.tsx` | Observation produit |
| `app/admin/monitoring/page.tsx` | Monitoring santé (IA / opérationnel / adoption) |
| `app/admin/feedback/page.tsx` | Feedbacks utilisateurs |
| `app/admin/organisations/page.tsx` | Organisations / multi-tenant |
| `app/admin/backfill/page.tsx` | Outils de backfill |
| `app/admin/feedback/actions.ts` | Server actions feedback |
| `lib/db/usage-events.ts` | Événements d'usage |
| `lib/db/user-journey.ts` | Parcours utilisateur |
| `lib/db/admin-monitoring.ts` | Métriques monitoring |
| `lib/db/ai-usage-rollup.ts` | Agrégat coûts/usage IA |
| `lib/db/activity-logs.ts` | Journal d'activité |
| `lib/audit/log.ts` | logAuditEvent() |

---

## Recherche & mémoire interrogeable

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/recherche/page.tsx` | Recherche transverse / découverte guidée |
| `app/(dashboard)/recherche/SearchBar.tsx` | Barre de recherche |
| `app/(dashboard)/memoire/page.tsx` | Mémoire de l'organisation |
| `app/(dashboard)/memoire/[siteId]/page.tsx` | Interroger la mémoire d'un site |
| `app/(dashboard)/memoire/org-memory-actions.ts` | Server actions interrogation mémoire |
| `app/api/cron/refresh-memory-readings/route.ts` | Cron : pré-calcul des lectures mémoire |
| `lib/db/search.ts` | Recherche FTS |
| `lib/db/memory-search.ts` | Recherche sémantique bornée |
| `lib/db/site-export.ts` | Export mémoire d'un site |

---

## Documents / Bibliothèque

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/documents/page.tsx` | Liste / dépôt de documents |
| `app/(dashboard)/documents/import/page.tsx` | Import (pipeline d'ingestion) |
| `app/(dashboard)/documents/[id]/page.tsx` | Fiche document |
| `app/(dashboard)/documents/[id]/download/route.ts` | Téléchargement document |
| `app/(dashboard)/documents/actions.ts` | Server actions documents |
| `app/(dashboard)/library/page.tsx` | Bibliothèque (knowledge_items) |
| `app/(dashboard)/library/actions.ts` | CRUD items bibliothèque |
| `lib/db/documents.ts` | CRUD documents |
| `lib/db/report-documents.ts` | Documents liés aux CR |
| `lib/db/knowledge.ts` | Requêtes knowledge |
| `lib/db/library-usage.ts` | Usage de la bibliothèque |
| `services/pdf/extract.ts` | Extraction texte PDF |

---

## IA (services/ai)

| Fichier | Rôle |
|---|---|
| `services/ai/factory.ts` | Sélection provider selon AI_PROVIDER |
| `services/ai/providers/anthropic.ts` | Provider Anthropic |
| `services/ai/providers/gemini.ts` | Provider Gemini |
| `services/ai/providers/mock.ts` | Provider mock (tests) |
| `services/ai/orchestrator.ts` | Lancement parallèle des agents Atelier IA |
| `services/ai/agents/registry.ts` | Registre des agents (terrain, conformité, financier, contradicteur, lecteur-ao, mémoire technique, opportunity-scorer) |
| `services/ai/chat.ts` | Boucle de chat Atelier IA |
| `services/ai/initial-analysis.ts` | Analyse initiale d'un AO |
| `services/ai/engagement-extraction.ts` | Extraction des engagements |
| `services/ai/site-report-analysis.ts` | Analyse de compte-rendu chantier |
| `services/ai/document-generation.ts` | Génération de documents (templates) |
| `services/ai/source-validation.ts` | Validation des sources citées |
| `services/ai/library-context.ts` | Contexte bibliothèque pour les prompts |
| `services/ai/prompts/` | Prompts versionnés (*.v1.ts) |
| `services/ai/tracking.ts` | Log usage tokens → table ai_usage |
| `lib/db/memory-corrections.ts` | Capture passive des corrections (apprentissage) |

---

## Manuels (/manuel · /comprendre · book)

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/manuel/page.tsx` | Manuel utilisateur |
| `app/(dashboard)/comprendre/[doc]/page.tsx` | Pages « Comprendre » par document |
| `lib/docs/book.ts` | Contenu structuré du manuel (book) |

---

## Notifications / feed

| Fichier | Rôle |
|---|---|
| `app/(dashboard)/dashboard/NotificationsBar.tsx` | Bandeau notifications d'accueil |
| `app/(dashboard)/feedback-reply-actions.ts` | Réponse feedback (type feedback_reply) |
| `app/api/feedback/route.ts` | Réception feedback |
| `lib/db/notifications.ts` | Table générique notifications + discipline d'apparition |
| `lib/db/inbox-feed.ts` | Flux inbox unifié (QR + contributions) |

---

## Couche données (lib/db) — index par thème

> 104 fichiers, un par domaine de données. Les principaux sont déjà référencés ci-dessus ; ce tableau regroupe l'ensemble par thème.

| Thème | Fichiers |
|---|---|
| Utilisateurs / orgs | `users.ts`, `organisations.ts`, `clients.ts`, `onboarding.ts`, `org-catalog.ts` |
| Cockpit / vues | `dashboard.ts`, `today-view.ts`, `missions-cockpit.ts`, `site-cockpit.ts`, `inbox-feed.ts` |
| AO / Tenders | `tenders.ts`, `engagements.ts`, `atelier-ia.ts`, `atelier-export.ts`, `agent-analyses.ts`, `tender-document-sources.ts`, `tender-client-capital.ts`, `ao-experience.ts` |
| Contrats / missions | `contracts.ts`, `missions.ts`, `system-missions.ts`, `intervention-templates.ts`, `monthly-report.ts`, `site-engagements.ts` |
| Sites & mémoire du lieu | `sites.ts`, `site-cockpit.ts`, `site-journal.ts`, `site-day-log.ts`, `site-day-log-meta.ts`, `site-narrative.ts`, `site-memory.ts`, `site-memory-signals.ts`, `memory-scopes.ts`, `scope-suggestions.ts`, `site-export.ts`, `site-photos.ts` |
| Réunions / CR | `site-reports.ts`, `points-examines.ts`, `report-human-points.ts`, `report-point-actions.ts`, `report-added-points.ts`, `report-final-versions.ts`, `report-analysis-runs.ts`, `report-documents.ts`, `report-photos.ts`, `report-photo-meta.ts`, `report-audio-sources.ts`, `audio-source-constants.ts`, `action-codes.ts`, `pv-signal-decisions.ts`, `meeting-followup.ts` |
| Objets métier | `site-actions.ts`, `action-distribution.ts`, `site-reserve.ts`, `site-delivery.ts`, `site-decisions.ts`, `decision-constants.ts`, `site-blocages.ts`, `blocage-constants.ts`, `subjects.ts`, `subject-relations.ts`, `obligations.ts`, `site-previsions.ts` |
| Casting | `intervenants.ts`, `site-intervenants.ts`, `companies.ts`, `company-contacts.ts`, `intervention-companies.ts` |
| Interventions terrain | `interventions.ts`, `intervention-participants.ts`, `intervention-voice-notes.ts`, `intervention-access-events.ts`, `intervention-tokens.ts`, `spontaneous-intervention.ts`, `field-today.ts`, `chef-equipe-preparation.ts` |
| Preuves & partage | `proofs.ts`, `proof-share.ts`, `proof-dossier.ts`, `proof-verification.ts`, `handover.ts`, `capsule-share.ts`, `site-qr.ts` |
| Briefing / continuité | `evening-briefing.ts`, `continuity.ts` |
| Équipes / planning | `teams.ts`, `team-profile.ts`, `week-planning.ts`, `week-vigilance.ts`, `site-team-knowledge.ts` |
| Glossaire | `glossary.ts`, `glossary-seed.ts`, `glossary-constants.ts` |
| Recherche / documents | `search.ts`, `memory-search.ts`, `documents.ts`, `knowledge.ts`, `library-usage.ts` |
| Admin / usage / IA | `usage-events.ts`, `user-journey.ts`, `activity-logs.ts`, `admin-monitoring.ts`, `ai-usage-rollup.ts`, `memory-corrections.ts`, `notifications.ts` |
