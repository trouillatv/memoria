'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { updateProfileAction } from './actions'

interface Props {
  initialFullName: string
  initialPhone: string | null
  email: string
  roleLabel: string
}

const E164_REGEX = /^\+[0-9]{7,15}$/

function normalizePhone(raw: string): string {
  return raw.replace(/[\s.\-_]/g, '')
}

export function AccountProfileForm({
  initialFullName,
  initialPhone,
  email,
  roleLabel,
}: Props) {
  const [fullName, setFullName] = useState(initialFullName)
  const [savedFullName, setSavedFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [savedPhone, setSavedPhone] = useState(initialPhone ?? '')
  const [isPending, startTransition] = useTransition()

  const trimmedName = fullName.trim()
  const normalizedPhone = normalizePhone(phone.trim())
  const phoneValid =
    normalizedPhone === '' || E164_REGEX.test(normalizedPhone)
  const nameValid = trimmedName.length >= 2

  const dirty =
    trimmedName !== savedFullName.trim() ||
    normalizedPhone !== normalizePhone(savedPhone.trim())

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await updateProfileAction({
        full_name: fullName,
        phone: normalizedPhone, // '' = clear
      })
      if (result.ok) {
        toast.success('Profil mis à jour.')
        setSavedFullName(trimmedName)
        setSavedPhone(normalizedPhone)
      } else {
        toast.error(result.error ?? 'Échec de la mise à jour.')
      }
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Nom complet</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={100}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled />
        <p className="text-xs text-muted-foreground">
          L&apos;email ne peut pas être modifié depuis cette interface.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">Rôle</Label>
        <Input id="role" value={roleLabel} disabled />
      </div>

      {/* Sprint 4 PC — Téléphone WhatsApp (Maxim 9 : 1-à-1).
          Wording sobre, neutre, descriptif. Pas un signal comportemental. */}
      <div className="space-y-1.5">
        <Label htmlFor="phone">Téléphone (WhatsApp)</Label>
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+687 12 34 56"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={20}
          aria-invalid={!phoneValid}
        />
        <p className="text-xs text-muted-foreground">
          Ce numéro permet à votre superviseur d&apos;envoyer des préparations
          via WhatsApp. Format international (ex : <code>+687123456</code>).
          Laissez vide si vous ne souhaitez pas le renseigner.
        </p>
        {!phoneValid && (
          <p className="text-xs text-destructive" role="alert">
            Format invalide. Attendu : <code>+</code> suivi de 7 à 15 chiffres.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!dirty || !nameValid || !phoneValid || isPending}
        >
          {isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  )
}
