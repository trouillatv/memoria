'use client'

// Sélecteur d'organisation côté client.
// Reçoit les orgs en props depuis le parent (Server Component ou autre).
// Mono-org → hidden input (silencieux). Multi-org → <select> obligatoire.

export interface OrgOption {
  id: string
  label: string
}

interface OrgSelectorClientProps {
  name?: string
  orgs: OrgOption[]
  defaultValue?: string
  className?: string
  disabled?: boolean
}

export function OrgSelectorClient({
  name = 'organization_id',
  orgs,
  defaultValue,
  className,
  disabled,
}: OrgSelectorClientProps) {
  if (orgs.length === 0) return null
  if (orgs.length === 1) {
    return <input type="hidden" name={name} value={orgs[0].id} />
  }
  return (
    <div className={className}>
      <label htmlFor={name} className="block text-sm font-medium mb-1">
        Organisation
      </label>
      <select
        id={name}
        name={name}
        required
        defaultValue={defaultValue ?? ''}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="" disabled>Sélectionner une organisation</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
