-- Tous les enums du domaine MemorIA

create type user_role         as enum ('admin', 'manager', 'chef_equipe');
create type mission_status    as enum ('pending', 'in_progress', 'completed', 'issue');
create type tender_status     as enum ('draft', 'extracting', 'analyzing', 'ready', 'failed', 'submitted', 'archived');
create type incident_severity as enum ('low', 'medium', 'high', 'critical');
create type ai_provider       as enum ('mock', 'gemini', 'anthropic', 'openai');
create type knowledge_category as enum (
  'references_clients',
  'moyens_humains',
  'materiel',
  'procedures',
  'qualite',
  'anciens_memoires'
);
