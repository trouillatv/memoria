import type { KnowledgeCategory } from '@/types/db'

export const CATEGORY_TARGETS: Record<KnowledgeCategory, number> = {
  references_clients: 15,
  moyens_humains:     5,
  materiel:           10,
  procedures:         10,
  qualite:            8,
  anciens_memoires:   12,
}

export const CATEGORY_LABELS_FULL: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains:     'Moyens humains',
  materiel:           'Matériel',
  procedures:         'Procédures',
  qualite:            'Qualité',
  anciens_memoires:   'Anciens mémoires',
}

export const CATEGORY_COLORS: Record<KnowledgeCategory, { bg: string; text: string; border: string }> = {
  references_clients: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  moyens_humains:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  materiel:           { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  procedures:         { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  qualite:            { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  anciens_memoires:   { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
}
