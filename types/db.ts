// Types métier — alignés sur les enums et tables Supabase.
// On peut générer automatiquement avec un script type-gen futur,
// pour l'instant on tient les types à la main pour ne pas dépendre du DB password.

import type { Source } from './sources'
export type { Source, SourceType } from './sources'

export type UserRole = 'admin' | 'manager' | 'chef_equipe'
export type MissionStatus = 'pending' | 'in_progress' | 'completed' | 'issue'
export type TenderStatus =
  | 'draft' | 'extracting' | 'analyzing' | 'ready' | 'failed' | 'submitted' | 'archived'
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AIProviderName = 'mock' | 'gemini' | 'anthropic' | 'openai'
export type KnowledgeCategory =
  | 'references_clients' | 'moyens_humains' | 'materiel'
  | 'procedures' | 'qualite' | 'anciens_memoires'

export interface DbUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  must_change_password: boolean
  created_at: string
  deleted_at: string | null
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
  created_by: string
  created_at: string
  deleted_at: string | null
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
  created_at: string
}

export type ChatAgentName =
  | 'general' | 'lecteur_ao' | 'memoire_technique'
  | 'contradicteur' | 'financier' | 'terrain' | 'conformite'

export interface DbTenderChatMessage {
  id: string
  tender_id: string
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
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by: string | null
}

export type EngagementSourceType = 'ao_clause' | 'memoire_engagement' | 'manual'

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

export interface DbEngagement {
  id: string
  tender_id: string
  contract_id: string | null
  source_type: EngagementSourceType
  source_excerpt: string
  source_ref: Record<string, unknown> | null
  category: EngagementCategory
  short_label: string
  measurable: boolean
  ai_confidence: number | null
  status: EngagementStatus
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

export interface DbSite {
  id: string
  client_id: string
  contract_id: string | null
  name: string
  address: string | null
  notes: string | null
  created_at: string
  deleted_at: string | null
}

export type MissionCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'on_demand'

export interface ChecklistTemplateItem {
  label: string
  required?: boolean
  engagement_id?: string
  position?: number
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
}

export type InterventionStatus = 'planned' | 'in_progress' | 'completed' | 'validated' | 'skipped'

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
}

export type PhotoKind = 'before' | 'after' | 'anomaly' | 'proof'

export interface DbInterventionPhoto {
  id: string
  intervention_id: string
  checklist_item_id: string | null
  storage_path: string
  kind: PhotoKind
  caption: string | null
  taken_at: string
  taken_by: string | null
}

export type AnomalyCategory = 'eau_coupee' | 'materiel_casse' | 'acces_bloque' | 'produit_manquant' | 'autre'
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
}

export interface DbInterventionValidation {
  id: string
  intervention_id: string
  validated_by: string
  validated_at: string
  comment: string | null
}
