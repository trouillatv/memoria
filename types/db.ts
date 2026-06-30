// Types métier — alignés sur les enums et tables Supabase.
// On peut générer automatiquement avec un script type-gen futur,
// pour l'instant on tient les types à la main pour ne pas dépendre du DB password.

import type { Source } from './sources'
export type { Source, SourceType } from './sources'

export type UserRole = 'admin' | 'manager' | 'chef_equipe'
export type MissionStatus = 'pending' | 'in_progress' | 'completed' | 'issue'
export type TenderStatus =
  | 'draft' | 'extracting' | 'analyzing' | 'ready' | 'failed' | 'submitted' | 'archived'
export type TenderOutcome = 'pending' | 'won' | 'lost' | 'withdrawn' | 'not_responded'
export type TenderOutcomeTag = 'prix' | 'qualite' | 'relation' | 'timing' | 'autre'
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'
export type KnowledgeCategory =
  | 'references_clients' | 'moyens_humains' | 'materiel'
  | 'procedures' | 'qualite' | 'anciens_memoires'

/** Type de contrat d'un intervenant (migration 076, Vincent 2026-05-21).
 *  Information structurelle non comparative. Jamais affichée en classement. */
export type EmploymentType = 'cdi' | 'cdd' | 'cdi_chantier'

export interface DbOrganization {
  id: string
  name: string
  slug: string | null
  created_at: string
}

export interface DbUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  must_change_password: boolean
  created_at: string
  deleted_at: string | null
  // Migration 089 — multi-tenancy
  organization_id: string | null
  // Sprint 4 PC — coordonnée WhatsApp 1-à-1 (Maxim 9 : jamais groupe collectif).
  // Format E.164 imposé par CHECK constraint en DB (migration 035).
  phone: string | null
  // Migration 076 (Vincent 2026-05-21) — création intervenant.
  commune: string | null
  employment_type: EmploymentType | null
  // Migration 081 (Vincent 2026-05-22) — Sprint E continuité anticipée.
  // Sujet : la mémoire opérationnelle, jamais la valeur de la personne.
  contract_end_date: string | null
  // Migration 084 (Vincent 2026-05-26) — thème UI préféré, réappliqué au login.
  theme_preference: string | null
  // Migration 093 (Vincent 2026-06-12) — porte d'entrée préférée.
  // 'dashboard' = pilotage (Guillaume), 'terrain' = /m (Adrien, Fred).
  home_preference: 'dashboard' | 'terrain'
}

export interface DbActivityLog {
  id: string
  user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface DbKnowledgeItem {
  id: string
  title: string
  category: KnowledgeCategory
  content_markdown: string
  file_path: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DbTender {
  id: string
  title: string
  client_name: string | null
  deadline: string | null
  status: TenderStatus
  opportunity_score: number | null
  error_msg: string | null
  /** Opportunité (dossier) à laquelle l'AO est rattaché (mig 175) — 0..1. */
  dossier_id: string | null
  created_by: string
  created_at: string
  updated_at: string | null
  deleted_at: string | null
  // Mémoire commerciale — doctrine V5 verrou V1 (mémoire ≠ recommandation)
  outcome: TenderOutcome | null
  outcome_at: string | null
  outcome_reason: string | null
  outcome_tag: TenderOutcomeTag | null
  outcome_set_by: string | null
  // Mémoire commerciale MC-4 — voice note DG sur AO finalisé (doctrine V5 cas validé).
  // Archive personnelle. Path interne bucket `tender-voice-notes`.
  voice_note_path: string | null
  voice_note_duration_seconds: number | null
  voice_note_recorded_at: string | null
  voice_note_recorded_by: string | null
}

export interface DbTenderDocument {
  id: string
  tender_id: string
  storage_path: string
  filename: string
  size_bytes: number | null
  page_count: number | null
  extracted_text: string | null
  uploaded_at: string
}

export interface DbTenderAnalysisConstraint {
  label: string
  detail?: string
  required?: boolean
  category?: string
  sources?: Source[]
}

export interface DbTenderAnalysisRisk {
  label: string
  severity: 'low' | 'medium' | 'high'
  detail?: string
  sources?: Source[]
}

export interface DbTenderAnalysisChecklistItem {
  item: string
  required: boolean
  sources?: Source[]
}

/** A6 — référence documentaire traçable (jamais de texte/extracted_text). */
export interface DbTenderAnalysisDocumentSource {
  id: string
  type?: string
}

export interface DbTenderAnalysis {
  id: string
  tender_id: string
  provider: AIProviderName
  model: string | null
  prompt_versions: Record<string, string> | null
  summary: string | null
  constraints: DbTenderAnalysisConstraint[] | null
  risks: DbTenderAnalysisRisk[] | null
  checklist: DbTenderAnalysisChecklistItem[] | null
  technical_memo: string | null
  library_snapshot: { items_count: number; total_chars: number } | null
  raw_response: unknown | null
  /** A6 — sources [doc:id] utilisées par le recall A3 (réf. seules, dédupé). */
  document_sources: DbTenderAnalysisDocumentSource[] | null
  created_at: string
}

export type ChatAgentName =
  | 'general' | 'lecteur_ao' | 'memoire_technique'
  | 'contradicteur' | 'financier' | 'terrain' | 'conformite'

export interface DbTenderConversation {
  id: string
  tender_id: string
  name: string
  position: number
  created_at: string
  updated_at: string
}

export interface DbTenderChatMessage {
  id: string
  tender_id: string
  conversation_id: string | null
  user_id: string | null
  agent_name: ChatAgentName | null
  role: 'user' | 'agent' | 'system'
  content: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface DbTenderChatAttachment {
  id: string
  message_id: string
  storage_path: string
  filename: string
  size_bytes: number | null
  extracted_text: string | null
  created_at: string
}

export type AgentAnalysisStatus = 'pending' | 'running' | 'ready' | 'failed'

export interface DbAgentAnalysis {
  id: string
  tender_id: string
  agent_name: ChatAgentName
  status: AgentAnalysisStatus
  summary: string | null
  key_points: Record<string, unknown> | null
  raw_content: string | null
  metadata: Record<string, unknown> | null
  error_msg: string | null
  created_at: string
  updated_at: string
}

// =================================
// Engagement & Contracts (Phase 1 — boucle stratégique AO ↔ Field)
// =================================

export type ContractStatus = 'active' | 'paused' | 'terminated' | 'archived'

export interface DbContract {
  id: string
  tender_id: string | null
  name: string
  client_name: string
  start_date: string
  end_date: string | null
  status: ContractStatus
  /** V6.3 — heures de prestation prévues/mois (cible du contrat, jamais par personne). */
  volume_horaire_mensuel: number | null
  /** V6.3 — rythme contractuel (libellé libre, ex. « hebdomadaire »). */
  frequence: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by: string | null
}

export type EngagementSourceType = 'ao_clause' | 'memoire_engagement' | 'manual'

// Destination d'une proposition extraite (Atelier IA v2, migration 083).
export type EngagementDestination = 'contract_engagement' | 'vigilance' | 'a_savoir' | 'mission'

export type EngagementCategory =
  | 'frequency'
  | 'quality'
  | 'compliance'
  | 'delivery'
  | 'sla'
  | 'reporting'
  | 'other'

export type EngagementStatus =
  | 'extracted'
  | 'curated'
  | 'active'
  | 'completed'
  | 'archived'

// Phase 4.1 (migration 046) — Niveau de preuve attendu pour considérer
// l'engagement comme exécuté de façon défendable.
export type EngagementProofRequirement = 'photo' | 'anomaly_documented' | 'none'

// Migration 153 (Sprint 1 typage) — NATURE prescriptive de l'engagement.
// Première brique de l'atome « Assertion ». NULL = non typé.
export type EngagementKind =
  | 'objectif'
  | 'obligation'
  | 'livrable'
  | 'controle'
  | 'penalite'

export interface DbEngagement {
  id: string
  tender_id: string
  contract_id: string | null
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown> | null
  category: EngagementCategory
  kind: EngagementKind | null
  short_label: string
  measurable: boolean
  ai_confidence: number | null
  status: EngagementStatus
  proof_requirement: EngagementProofRequirement
  destination: EngagementDestination
  created_at: string
  updated_at: string
  created_by: string | null
}

// Compliance helpers (computed view-side, not persisted)
export type EngagementHealth = 'green' | 'amber' | 'red' | 'unknown'

export interface EngagementComplianceRatios {
  promised: boolean
  planned: number      // 0-1
  executed: number     // 0-1
  proven: number       // 0-1
  validated: number    // 0-1
}

// =================================
// Field MVP — Phase 2 (Sites enrichi + Missions + Interventions + ...)
// =================================

/** Phase de vie — vocabulaire commun. La phase vit sur le DOSSIER (mig 172) ;
 *  sur sites (mig 171) elle reste un garde transitoire, non identitaire. */
export type SitePhase = 'prospect' | 'en_ao' | 'actif' | 'perdu' | 'archive'
export type DossierPhase = SitePhase

/** Dossier = opération métier (mig 172), identité entre le Site (lieu) et le Sujet. */
export interface DbDossier {
  id: string
  organization_id: string | null
  site_id: string
  client_id: string | null
  /** Nature de l'opération — label extensible (ao | operation | maintenance …). */
  type: string
  phase: DossierPhase
  label: string | null
  opened_at: string
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DbSite {
  id: string
  client_id: string
  contract_id: string | null
  name: string
  address: string | null
  notes: string | null
  /** Phase de vie (mig 171) : prospect → en_ao → actif → perdu → archive. */
  phase: SitePhase
  // Champs structurés "fiche site" (migration 036). Tous facultatifs.
  access_code: string | null
  alarm_code: string | null
  contact_name: string | null
  contact_phone: string | null
  access_hours: string | null
  access_instructions: string | null
  created_at: string
  deleted_at: string | null
}

// Mémoire des lieux — Sprint 2 doctrine V5.
// Notes courtes vivantes par site (140 chars max). PAS un wiki.
// Format descriptif passif uniquement (verrou V4).
//
// Phase 3.1 (migration 045) : distinction note vs a_savoir.
//   - note : observation passée descriptive
//   - a_savoir : information utile à l'arrivée sur site, peut avoir une date
//     d'expiration (active_until). Reste descriptif du lieu, jamais directif.
export type SiteNoteKind = 'note' | 'a_savoir'

export interface DbSiteNote {
  id: string
  site_id: string
  body: string
  kind: SiteNoteKind
  active_until: string | null
  created_at: string
  created_by: string | null
  deleted_at: string | null
}

// Compte-rendu multimodal de chantier (migration 099).
// Le terrain produit (voix+texte+photos+pièces) → l'IA propose → l'humain valide.
// L'artefact brut n'est jamais supprimé, même si l'IA échoue.
export type SiteReportStatus =
  | 'draft'
  | 'transcribing'
  | 'ready'
  | 'analyzing'
  | 'proposed'
  | 'curated'
  | 'archived'
  | 'failed'

export type SiteReportTranscriptStatus = 'none' | 'pending' | 'done' | 'failed'

// Présent détecté à la réunion (coordination descriptive, jamais score).
export type ParticipantPresence = 'P' | 'AE' | 'AN' // Présent / Absent excusé / Absent non excusé
export interface SiteReportParticipant {
  name: string
  role: string | null
  kind: 'person' | 'company' | 'control' | 'other'
  /** Statut de présence (P/AE/AN). Invité et Diffusion sont INDÉPENDANTS (colonnes BECIB). */
  presence?: ParticipantPresence
  invite?: boolean // convié (colonne I)
  diffusion?: boolean // en diffusion (colonne D)
  /** Lien OPTIONNEL vers un contact réel (company_contacts, mig 137/138). Le nom libre
   *  reste possible pour un participant non répertorié — souplesse terrain voulue. */
  contactId?: string
  /** Ajouté APRÈS la capture initiale (feuille de présence tardive, oubli…) — tracé
   *  discrètement, jamais un reproche. Le reste (entreprise, fonction) se résout par
   *  jointure via contactId : on ne fige pas de libellés dans le JSON. */
  addedAfterMeeting?: boolean
  addedAt?: string
  addedBy?: string | null
}

// Risque / dépendance proposé par l'IA (conducteur de travaux assistant).
// Pour les dépendances : waiting_party attend awaited (« Menuiserie attend Électricité »).
export interface SiteReportRisk {
  kind: 'dependency' | 'preparation' | 'vigilance' | 'risk'
  label: string
  rationale: string | null
  waiting_party: string | null
  awaited: string | null
}

export type SiteReportType = 'contract' | 'site' | 'free'

// ── Visites terrain (mig 162) ────────────────────────────────────────────────
// Une visite = un site_report orienté objectif. `origin` non-null = visite.
// MVP : friction zéro au départ ; objectif/sujet/résultat/résolution facultatifs,
// posés à la clôture. Le motif est facultatif (routera le rail preuve au cran 2).
export type VisitMotive =
  | 'inspection'
  | 'controle'
  | 'reunion'
  | 'avancement'
  | 'reception'
  | 'levee_reserves'
  | 'constat'
  | 'expertise'
  | 'maintenance'
  | 'libre'
export type VisitOrigin = 'planned' | 'spontaneous' | 'qr' | 'gps'
/** Résultat global — qualifie l'OUVRAGE/ZONE/SUJET, jamais la personne. */
export type VisitOutcome = 'ras' | 'conforme' | 'conforme_reserves' | 'non_conforme' | 'a_revoir' | 'info'
/** Résolution du sujet — orthogonale à l'outcome. */
export type VisitResolution = 'resolue' | 'a_suivre' | 'recontrole'
/** Motifs routés vers le rail intervention (preuve signée) — utilisé au cran 2. */
export const VISIT_PROOF_MOTIVES: readonly VisitMotive[] = ['reception', 'levee_reserves', 'maintenance']

export interface DbSiteReport {
  id: string
  type: SiteReportType
  site_id: string | null
  contract_id: string | null
  dossier_id: string | null // dossier d'opération rattaché (mig 172) — null si lieu legacy
  title: string | null
  next_meeting_at: string | null // date de prochaine réunion (mig 131)
  tenant_id: string
  organization_id: string | null
  status: SiteReportStatus
  audio_path: string | null
  audio_mime: string | null
  audio_duration_seconds: number | null
  transcript_raw: string | null
  transcript_corrected: string | null
  transcript_status: SiteReportTranscriptStatus
  text_input: string | null
  analysis_error: string | null
  participants: SiteReportParticipant[]
  risks: SiteReportRisk[]
  // Visites terrain (mig 162) — null pour un compte-rendu/réunion classique.
  // `origin` non-null = visite terrain. Champs posés à la clôture (facultatifs).
  origin: VisitOrigin | null
  started_at: string | null
  ended_at: string | null
  visit_motive: VisitMotive | null
  objective: string | null
  target_subject_id: string | null
  outcome: VisitOutcome | null
  resolution: VisitResolution | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SiteReportAttachmentKind = 'audio' | 'photo' | 'file' | 'video'

export interface DbSiteReportAttachment {
  id: string
  report_id: string
  kind: SiteReportAttachmentKind
  storage_path: string
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  sha256: string | null
  client_uuid: string | null
  created_at: string
  // Mémoire enrichissable après réunion (mig 163) — PJ ajoutée post-réunion, tracée.
  uploaded_after_meeting?: boolean
  added_by?: string | null
  added_at?: string | null
}

// Une proposition = une DÉCISION détectée dans le compte-rendu, routée selon
// sa nature. 'action' = action ouverte (sortie principale). 'client_memory' =
// savoir sur le client. Ce qui est décidé (action/note/vigilance/client_memory)
// ≠ ce qui est exécuté (intervention/mission).
export type SiteReportProposalType =
  | 'action'
  | 'intervention'
  | 'mission'
  | 'anomaly'
  | 'vigilance'
  | 'note'
  | 'proof_request'
  | 'client_memory'

export type SiteReportProposalStatus = 'proposed' | 'accepted' | 'rejected'

export interface DbSiteReportProposal {
  id: string
  report_id: string
  type: SiteReportProposalType
  payload: Record<string, unknown>
  short_label: string
  rationale: string | null
  category: string | null
  corps_etat: string | null
  assigned_to: string | null
  // Réunion contrat : site vers lequel la décision est routée (IA + humain).
  site_id: string | null
  ai_confidence: number | null
  status: SiteReportProposalStatus
  created_entity_type: string | null
  created_entity_id: string | null
  // Rattachement à un sujet vivant (migration 124).
  subject_id: string | null
  // Origine (migration 142) : 'initial' (1re analyse) | 'reanalysis' (audio complémentaire).
  origin?: 'initial' | 'reanalysis'
  created_at: string
}

// Action ouverte (migration 099) — nouvel objet central. Une réunion produit
// d'abord des actions ouvertes ; seules certaines deviennent des interventions
// planifiées. open → planned (→ intervention) → done. Regroupée par corps d'état.
export type SiteActionStatus = 'open' | 'planned' | 'done' | 'cancelled'

export interface DbSiteAction {
  id: string
  site_id: string
  report_id: string | null
  title: string
  body: string | null
  corps_etat: string | null
  assigned_to: string | null
  status: SiteActionStatus
  due_date: string | null
  // Statut de l'échéance (migration 121) : explicit = date dite en réunion ;
  // estimated = date relative résolue par l'IA → « à confirmer » ; null = aucune.
  due_date_status: 'explicit' | 'estimated' | null
  converted_to_type: string | null
  converted_to_id: string | null
  created_by: string | null
  created_at: string
  done_at: string | null
  // Clôture avec trace (migration 107).
  completed_comment: string | null
  completed_photo_path: string | null
  // Provenance de création (migration 112) : mobile_site / desktop_site /
  // actions_list / report… NULL = legacy. Observabilité, jamais affiché.
  created_from: string | null
  // Rattachement à un nœud de mémoire / sous-périmètre (migration 117, Sprint 3).
  // NULL = contenu au niveau du site. Précision en plus, jamais obligatoire.
  scope_id: string | null
  // Action corrective rattachée à une réserve (migration 123). NULL = action
  // ordinaire. Plusieurs actions peuvent contribuer à la levée d'une réserve.
  reserve_id: string | null
  // Rattachement à un sujet vivant (migration 124). NULL = action non rattachée.
  subject_id: string | null
  // Dernière avancée « Fait aujourd'hui » (migration 169). NULL = pas avancée ; jamais une clôture.
  last_progress_at: string | null
  // Type d'action (migration 149) : one_shot (ponctuelle, défaut) | deadline (pour
  // une échéance) | recurring_until_done (récurrente jusqu'à clôture du chantier).
  kind: 'one_shot' | 'deadline' | 'recurring_until_done'
  // Surcouche de déclaration externe (migration 148) : dernière réponse d'une
  // entreprise via action_distributions (QR/lien). ÉCHO de terrain, ne pilote
  // jamais `status` (le MOE garde la main). NULL = aucune déclaration externe.
  ext_status: 'done' | 'blocked' | null
  ext_comment: string | null
  ext_photo_path: string | null
  ext_at: string | null
  ext_by: string | null
  // « Reporter » (migration 176) : motif posé par le chef expliquant pourquoi
  // l'action reste ouverte (attente client/matériel, météo, autre). Léger,
  // non bloquant — l'action reste 'open'. NULL = pas reportée.
  snooze_reason: string | null
  snoozed_at: string | null
}

// Sujets vivants (migration 124) — fil persistant qui agrège dans le temps
// actions/réserves/décisions/documents d'un problème. JAMAIS une personne.
export type SubjectStatus = 'open' | 'dormant' | 'closed'

export interface DbSubject {
  id: string
  organization_id: string | null
  site_id: string
  scope_id: string | null
  name: string
  status: SubjectStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

// Sprint 1 (migration 120) — document généré depuis une réunion (PV/CR chantier).
// Couche de génération au-dessus de l'analyse réunion : remplit un template,
// l'humain édite PAR SECTIONS → valide → PDF → document de mémoire.
export type ReportDocumentStatus = 'draft' | 'validated' | 'exported'

/** Une section rendue du document. `sections` (jsonb) = source de vérité. */
export interface ReportDocumentSection {
  key: string
  title: string
  /** generative = rédigée par l'IA ; fixed = texte imposé par le template (clauses). */
  kind: 'generative' | 'fixed'
  content: string
  /** Traçabilité : extraits transcript/notes étayant la section (jamais inventé). */
  sources?: string[]
}

export interface DbReportDocument {
  id: string
  organization_id: string | null
  report_id: string
  site_id: string | null
  template_key: string
  sections: ReportDocumentSection[]
  status: ReportDocumentStatus
  /** Renseigné au « Valider » : PV figé poussé dans /documents. */
  document_id: string | null
  pdf_path: string | null
  /** Version finale DIFFUSÉE téléversée par l'humain (vérité juridique ; mig 126). */
  final_document_id: string | null
  final_path: string | null
  finalized_at: string | null
  finalized_by: string | null
  provider: string | null
  model: string | null
  prompt_version: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type MissionCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'on_demand'

export interface ChecklistTemplateItem {
  label: string
  required?: boolean
  engagement_id?: string
  position?: number
  // Item « à quantité » (migration 111) : non null = on attend un compte (ex.
  // livrer 12 plaques). null/absent = item binaire classique (coche).
  expected_qty?: number | null
}

export interface DbMission {
  id: string
  site_id: string
  name: string
  description: string | null
  cadence: MissionCadence
  default_team: string[]
  engagement_ids: string[]
  default_checklist: ChecklistTemplateItem[]
  active: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by: string | null
  // Phase 9 — Vue Semaine & Équipes (doctrine V2)
  assigned_team_id: string | null
}

export type InterventionStatus = 'planned' | 'in_progress' | 'completed' | 'validated' | 'skipped'

// Phase 6 — Récurrence simple
export type InterventionFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'one_shot'
export type InterventionSlot = 'morning' | 'afternoon' | 'evening'

export interface DbInterventionTemplate {
  id: string
  mission_id: string
  title: string
  description: string | null
  frequency: InterventionFrequency
  slots: InterventionSlot[] | null
  day_of_week: number | null
  day_of_month: number | null
  // Migration 085 — heure précise par occurrence (HH:MM). NULL = ancrage créneau.
  planned_start_hhmm: string | null
  planned_end_hhmm: string | null
  starts_on: string  // date ISO (YYYY-MM-DD)
  ends_on: string | null
  active: boolean
  created_at: string
  created_by: string | null
  deleted_at: string | null
}

export interface DbIntervention {
  id: string
  mission_id: string
  scheduled_at: string
  executed_at: string | null
  team: string[]
  status: InterventionStatus
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  // Phase 6 — Récurrence simple
  template_id: string | null
  scheduled_for: string | null  // date ISO (YYYY-MM-DD)
  slot: InterventionSlot | null
  skipped_at: string | null
  skipped_reason: string | null
  skipped_by: string | null
  // Phase 9 — Vue Semaine & Équipes (doctrine V2)
  assigned_team_id: string | null
  // V6.1 (migration 071) — ancrage honnête de prestation.
  // JAMAIS pointage de personne. Ne jamais agréger par user_id.
  planned_start: string | null
  planned_end: string | null
}

// =================================
// Phase 9 — Vue Semaine & Équipes (doctrine V2)
// =================================

// Doctrine V2 : conteneur logistique de couverture. JAMAIS unité analytique.
// Pas de champ score / capacity / max_load / charge_max / performance.
export interface DbTeam {
  id: string
  name: string
  color: string | null
  /** Migration 077 (Vincent 2026-05-21) — Pictogramme lucide-react (kebab-case).
   *  Identité visuelle, jamais sémantique. */
  icon: string | null
  /** Migration 078 (Vincent 2026-05-21) — Spécialités déclarées (tags kebab-case).
   *  Whitelist applicative côté UI. JAMAIS calculées, JAMAIS comparatives. */
  specialties: string[]
  active: boolean
  created_at: string
  created_by: string | null
  deleted_at: string | null
  // Phase 10 — Référent d'équipe (point de contact opérationnel stable).
  referent_user_id: string | null
}

/** Sprint Équipes C (Vincent 2026-05-22, migration 079) — Passage de témoin. */
export type HandoverKind = 'member_change' | 'team_takes_site' | 'manual'
export type HandoverStatus = 'draft' | 'shared' | 'acknowledged' | 'archived'

export interface DbHandoverBrief {
  id: string
  kind: HandoverKind
  source_team_id: string | null
  target_team_id: string | null
  subject_user_id: string | null
  site_id: string | null
  payload: HandoverPayload
  title: string
  status: HandoverStatus
  /** Date à partir de laquelle le passage de témoin est effectif (remplacement). */
  effective_date: string | null
  shared_token: string | null
  shared_at: string | null
  expires_at: string | null
  last_accessed_at: string | null
  access_count: number
  acknowledged_by: string | null
  acknowledged_at: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
}

/** Contenu compilé au moment T (snapshot JSONB). Immuable post-création. */
export interface HandoverPayload {
  generatedAt: string
  /** Description courte du contexte ("Joseph bascule de Alpha vers Beta"). */
  context: string
  /** Sites concernés par le passage de témoin. */
  sites: Array<{
    site_id: string
    site_name: string
    contract_id: string | null
    contract_name: string | null
    client_name: string | null
    /** Consignes "À savoir" du site au moment de la génération. */
    aSavoir: Array<{ id: string; title: string; description: string | null }>
    /** Dernières anomalies (capped). */
    recentAnomalies: Array<{
      id: string
      category: string
      description: string
      occurredAt: string
    }>
    /** Documents rattachés (capped, IDs cliquables). */
    documents: Array<{ id: string; title: string; documentType: string | null }>
    /** Réserves OUVERTES (capped 5) — état du site, jamais évaluation de personne. */
    openReserves: Array<{ id: string; label: string; location: string | null; issuedOn: string | null }>
    /** Réserves ouvertes au-delà du cap (« +N autres »). */
    openReservesMore: number
    /** Actions à suivre — EN RETARD d'abord (capped 6). late = due_date < aujourd'hui. */
    openActions: Array<{ id: string; title: string; assignedTo: string | null; dueDate: string | null; late: boolean }>
    openActionsMore: number
    /** Décisions de réunion VALIDÉES récentes (capped 3). */
    recentDecisions: Array<{ id: string; label: string; corpsEtat: string | null; at: string }>
    /** Équipes voisines qui connaissent ce site (back-up). */
    neighborTeams: Array<{ team_id: string; team_name: string; team_color: string | null }>
    /** Nombre d'interventions documentées sur ce site (descriptif). */
    interventionsCount: number
    lastInterventionDate: string | null
  }>
  /** Notes ajoutées manuellement par le manager qui crée le brief. */
  manualNotes: string | null
}

// Composition d'équipe variable dans le temps.
// left_at IS NULL = membre actif. Sinon = membre passé (historique conservé).
export interface DbTeamMember {
  id: string
  team_id: string
  user_id: string
  joined_at: string
  left_at: string | null
}

export interface DbInterventionChecklistItem {
  id: string
  intervention_id: string
  engagement_id: string | null
  label: string
  position: number
  required: boolean
  done: boolean
  done_at: string | null
  done_by: string | null
  // Contribution externe (migration 106) : exécutant externe = entreprise via
  // token.recipient_label. NULL = interne / non délégué. Jamais un salarié nommé.
  executed_by_token_id: string | null
  executed_at: string | null
  // Item « à quantité » (migration 111). expected_qty non null = item à
  // quantité ; item_status est DÉRIVÉ des chiffres (complet/partiel/non_livre).
  expected_qty: number | null
  delivered_qty: number | null
  item_status: string | null
}

export type PhotoKind = 'before' | 'after' | 'anomaly' | 'proof' | 'passage' | 'access'

export interface DbInterventionPhoto {
  id: string
  intervention_id: string
  checklist_item_id: string | null
  anomaly_id: string | null
  storage_path: string
  kind: PhotoKind
  caption: string | null
  ai_caption: string | null
  taken_at: string
  taken_by: string | null
  // Intégrité cryptographique — migration 040 (Phase 1.1).
  // Lien indéfalsifiable entre la ligne DB et le fichier dans le bucket.
  sha256: string | null
  mime_type: string | null
  size_bytes: number | null
  client_timestamp: string | null
  hash_origin: 'verified' | 'retroactive' | 'unknown'
}

export type AnomalyCategory =
  | 'eau_coupee'
  | 'electricite_coupee'
  | 'materiel_casse'
  | 'acces_bloque'
  | 'produit_manquant'
  | 'zone_non_prete'
  | 'danger_securite'
  | 'livraison_probleme'
  | 'autre'
export type AnomalyStatus = 'open' | 'resolved' | 'ignored'

export interface DbInterventionAnomaly {
  id: string
  intervention_id: string
  engagement_id: string | null
  category: AnomalyCategory
  category_other: string | null
  description: string | null
  status: AnomalyStatus
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  reported_by: string | null
  // Rattachement à un nœud de mémoire / sous-périmètre (migration 118, Sprint 3).
  scope_id: string | null
}

export interface DbInterventionValidation {
  id: string
  intervention_id: string
  validated_by: string
  validated_at: string
  comment: string | null
}

// =================================
// Cross-tender matching evidence (Phase 4)
// =================================

/**
 * Snapshot of execution evidence for an engagement.
 * Aggregated facts only — never per-person metrics.
 */
export interface EngagementEvidence {
  engagement_id: string
  // Counts (aggregated, never per-person)
  interventionsExecuted: number  // interventions completed or validated
  photosCount: number             // photos taken across all interventions
  anomaliesResolved: number       // anomalies resolved
  anomaliesOpen: number           // anomalies still open
  validationsCount: number        // interventions validated
  // Temporal context
  firstExecutedAt: string | null  // ISO date of first executed intervention
  lastExecutedAt: string | null   // ISO date of last executed intervention
  durationDays: number | null     // span in days between first and last
  // Quality indicator — aggregated, not individual
  validationRate: number          // 0-1, validated / executed (overall, not per agent)
  // Provenance
  contractIds: string[]           // contracts this engagement is linked to
  contractNames: string[]         // for display
}

// ===========================================================================
// Architecture documentaire générique — migration 073 (spec 2026-05-19)
// ===========================================================================

export type DocumentType =
  | 'contrat' | 'avenant' | 'procedure' | 'protocole' | 'plan_acces'
  | 'securite' | 'ao' | 'memoire_technique' | 'reference' | 'litige'
  | 'facture' | 'preuve' | 'autre'

export type DocumentVisibility =
  | 'admin_only' | 'manager' | 'operations' | 'field' | 'client_portal'

export type DocumentStatus = 'active' | 'superseded' | 'expired' | 'archived'

export type DocumentAnalysisStatus =
  | 'pending' | 'ocr' | 'extracting' | 'chunking' | 'ready' | 'failed'

export type DocumentTargetType =
  | 'contract' | 'site' | 'tender' | 'client' | 'intervention' | 'team' | 'tenant'
  // S4 Réserves (migration 123) — un document peut justifier une réserve.
  | 'reserve'
  // Sujets vivants (migration 124) — un document rattaché à un fil/sujet.
  | 'subject'
  // Obligations (migration 151) — rattacher le CCTP/PAQ source à l'obligation.
  | 'obligation'
  // Réunion (migration 164) — vrai document métier reçu après coup (DOE, marché…).
  | 'site_report'

export interface DbDocumentCollection {
  id: string
  tenant_id: string | null
  name: string
  scope_type: string | null
  scope_id: string | null
  position: number
  created_at: string
  deleted_at: string | null
}

export interface DbDocument {
  id: string
  tenant_id: string | null
  collection_id: string | null
  document_type: DocumentType
  tags: string[]
  visibility_level: DocumentVisibility
  status: DocumentStatus
  supersedes_document_id: string | null
  effective_date: string | null
  expires_date: string | null
  analysis_status: DocumentAnalysisStatus
  /** Couche mémoire décidée à l'ingestion (migration 082). NULL = legacy. */
  memory_tier: 'vivante' | 'consultable' | 'froide' | null
  failed_reason: string | null
  extraction_source: 'native' | 'ocr' | null
  extracted_text: string | null
  storage_path: string
  filename: string
  size_bytes: number | null
  page_count: number | null
  content_hash: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DbDocumentLink {
  id: string
  document_id: string
  target_type: DocumentTargetType
  target_id: string
  created_at: string
  // Référence libre (migration 151) : « CCTP chapitre 4.2 / page 18 ». Saisie
  // humaine, jamais dérivée par IA. NULL = aucune.
  reference_label: string | null
}
