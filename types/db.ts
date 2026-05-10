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
