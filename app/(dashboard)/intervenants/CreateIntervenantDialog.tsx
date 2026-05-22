'use client'

// Dialog création d'intervenant — Vincent 2026-05-21.
//
// Champs : email * / nom prénom * / téléphone / commune / rôle * / contrat
// Le mdp temporaire est partagé connu de l'équipe (« memoria2026 »),
// l'agent le change au premier login (must_change_password).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createIntervenantAction } from './actions'

type Role = 'admin' | 'manager' | 'chef_equipe'
type Employment = 'cdi' | 'cdd' | 'cdi_chantier'

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  chef_equipe: "Chef d'équipe",
}
const EMPLOYMENT_LABELS: Record<Employment, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  cdi_chantier: 'CDI Chantier',
}

export function CreateIntervenantDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [commune, setCommune] = useState('')
  const [role, setRole] = useState<Role>('chef_equipe')
  const [employment, setEmployment] = useState<Employment | ''>('')
  const [contractEndDate, setContractEndDate] = useState('')

  // Un CDD / CDI Chantier a une fin attendue → on exige la date (Continuité).
  const needsEndDate = employment === 'cdd' || employment === 'cdi_chantier'

  function reset() {
    setEmail('')
    setFullName('')
    setPhone('')
    setCommune('')
    setRole('chef_equipe')
    setEmployment('')
    setContractEndDate('')
  }

  const canSubmit =
    email.trim() !== '' &&
    fullName.trim() !== '' &&
    (!needsEndDate || contractEndDate !== '') &&
    !pending

  function submit() {
    if (!canSubmit) return
    startTransition(async () => {
      const r = await createIntervenantAction({
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        phone: phone.trim() === '' ? null : phone.trim(),
        commune: commune.trim() === '' ? null : commune.trim(),
        employment_type: employment === '' ? null : employment,
        contract_end_date: needsEndDate && contractEndDate !== '' ? contractEndDate : null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        `Intervenant créé. Mot de passe initial : memoria2026 (à changer au 1er login).`,
        { duration: 8000 },
      )
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <UserPlus className="h-4 w-4" />
            Nouvel intervenant
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvel intervenant</DialogTitle>
          <DialogDescription>
            Crée un compte. Mot de passe initial partagé : <code className="font-mono">memoria2026</code> —
            l&apos;intervenant le change à sa première connexion.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Email *" htmlFor="cri-email">
            <input
              id="cri-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              required
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Nom et prénom *" htmlFor="cri-full-name">
            <input
              id="cri-full-name"
              type="text"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              required
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Téléphone" htmlFor="cri-phone">
            <input
              id="cri-phone"
              type="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={pending}
              placeholder="+687…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Commune de résidence" htmlFor="cri-commune">
            <input
              id="cri-commune"
              type="text"
              autoComplete="off"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              disabled={pending}
              placeholder="Nouméa, Païta…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rôle *" htmlFor="cri-role">
              <select
                id="cri-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {(Object.entries(ROLE_LABELS) as Array<[Role, string]>).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type de contrat" htmlFor="cri-employment">
              <select
                id="cri-employment"
                value={employment}
                onChange={(e) => setEmployment(e.target.value as Employment | '')}
                disabled={pending}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">—</option>
                {(Object.entries(EMPLOYMENT_LABELS) as Array<[Employment, string]>).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {needsEndDate && (
            <Field label="Date de fin de contrat *" htmlFor="cri-end-date">
              <input
                id="cri-end-date"
                type="date"
                value={contractEndDate}
                onChange={(e) => setContractEndDate(e.target.value)}
                disabled={pending}
                required
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                CDD / CDI Chantier : on anticipe la passation de mémoire avant la fin.
              </p>
            </Field>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Annuler
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? 'Création…' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
