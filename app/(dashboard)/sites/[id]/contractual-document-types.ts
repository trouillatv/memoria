// Types de document contractuel (P0-1, Vincent 2026-09-23) — liste unique
// partagée entre l'UI du dialogue (labels) et la garde serveur (valeurs
// autorisées), pour ne pas dupliquer une troisième fois cette liste (cf.
// dette notée sur documents.document_type : CHECK SQL, types TS, Zod
// d'upload, classifieur).
export const CONTRACTUAL_DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'cctp', label: 'CCTP' },
  { value: 'ccap', label: 'CCAP' },
  { value: 'ordre_service', label: 'Ordre de service' },
  { value: 'contrat', label: 'Contrat' },
  { value: 'avenant', label: 'Avenant' },
  { value: 'autre', label: 'Autre' },
]

export const CONTRACTUAL_DOCUMENT_TYPE_VALUES: readonly string[] =
  CONTRACTUAL_DOCUMENT_TYPES.map((t) => t.value)
