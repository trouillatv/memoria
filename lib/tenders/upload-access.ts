export interface TenderUploadAccessRow {
  organization_id: string | null
  created_by: string
  deleted_at: string | null
}

/** Vérification applicative utilisée avec le client service-role des uploads. */
export function canAccessTenderForUpload(
  tender: TenderUploadAccessRow,
  userId: string,
  organizationIds: string[],
): boolean {
  if (tender.deleted_at) return false
  return tender.created_by === userId || (
    tender.organization_id !== null && organizationIds.includes(tender.organization_id)
  )
}
