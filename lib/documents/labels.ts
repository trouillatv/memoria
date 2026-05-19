// Libellés documentaires — purs, sans dépendance (UI phase 4a). Aucun IA.

import type { DocumentAnalysisStatus, DocumentType } from '@/types/db'

export function analysisStatusLabel(s: DocumentAnalysisStatus | string): string {
  const map: Record<string, string> = {
    pending: 'En attente',
    extracting: 'Extraction',
    ocr: 'OCR',
    chunking: 'Indexation',
    ready: 'Prêt',
    failed: 'Échec',
  }
  return map[s] ?? s
}

export const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'contrat', label: 'Contrat' },
  { value: 'avenant', label: 'Avenant' },
  { value: 'procedure', label: 'Procédure' },
  { value: 'protocole', label: 'Protocole' },
  { value: 'plan_acces', label: "Plan d'accès" },
  { value: 'securite', label: 'Sécurité' },
  { value: 'ao', label: 'Appel d’offres' },
  { value: 'memoire_technique', label: 'Mémoire technique' },
  { value: 'reference', label: 'Référence' },
  { value: 'litige', label: 'Litige' },
  { value: 'facture', label: 'Facture' },
  { value: 'preuve', label: 'Preuve' },
  { value: 'autre', label: 'Autre' },
]

export const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'admin_only', label: 'Admin uniquement' },
  { value: 'manager', label: 'Manager' },
  { value: 'operations', label: 'Opérations' },
  { value: 'field', label: 'Terrain' },
  { value: 'client_portal', label: 'Portail client' },
]

export const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'contract', label: 'Contrat' },
  { value: 'site', label: 'Site' },
  { value: 'tender', label: 'Appel d’offres' },
  { value: 'client', label: 'Client' },
  { value: 'intervention', label: 'Intervention' },
  { value: 'team', label: 'Équipe' },
  { value: 'tenant', label: 'Organisation' },
]
