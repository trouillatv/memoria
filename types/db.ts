// Types métier — alignés sur les enums et tables Supabase.
// On peut générer automatiquement avec un script type-gen futur,
// pour l'instant on tient les types à la main pour ne pas dépendre du DB password.

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
  deleted_at: string | null
}
