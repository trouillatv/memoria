import type { SituationCapability, SituationSource } from './situation'

function resolvableHref(href: string | null | undefined): string | null {
  const value = href?.trim() ?? ''
  return value.length > 0 ? value : null
}

export function openSourceCapability(source: SituationSource | null): SituationCapability[] {
  const href = resolvableHref(source?.href)
  if (!href) return []
  return [{ kind: 'open_source', label: 'Voir la source', href }]
}
