'use client'

// Sprint 4 PC — édition inline du téléphone d'un user depuis /admin/users.
// Doctrine V5 : coordonnée de contact (E.164), pas signal comportemental.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { updateUserPhoneAction } from './actions'

const E164_REGEX = /^\+[0-9]{7,15}$/

function normalize(raw: string): string {
  return raw.replace(/[\s.\-_]/g, '')
}

export function UserPhoneEdit({
  userId,
  currentPhone,
}: {
  userId: string
  currentPhone: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentPhone ?? '')
  const [savedValue, setSavedValue] = useState(currentPhone ?? '')
  const [pending, startTransition] = useTransition()

  const normalized = normalize(value.trim())
  const valid = normalized === '' || E164_REGEX.test(normalized)
  const dirty = normalized !== normalize(savedValue.trim())

  const save = () => {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('userId', userId)
      fd.set('phone', value)
      const r = await updateUserPhoneAction(fd)
      if (r?.error) {
        toast.error(r.error)
      } else {
        toast.success('Numéro mis à jour.')
        setSavedValue(normalized)
        setEditing(false)
      }
    })
  }

  const cancel = () => {
    setValue(savedValue)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        {savedValue ? (
          <span className="font-mono">{savedValue}</span>
        ) : (
          <Badge className="bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wider">
            Numéro manquant
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setEditing(true)}
        >
          {savedValue ? 'Modifier' : 'Saisir'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="+687123456"
        maxLength={20}
        autoFocus
        className="h-7 w-36 text-xs font-mono"
        aria-invalid={!valid}
      />
      <Button
        type="button"
        size="sm"
        className="h-7 px-2 text-[11px]"
        disabled={!valid || !dirty || pending}
        onClick={save}
      >
        {pending ? '…' : 'OK'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px]"
        onClick={cancel}
      >
        Annuler
      </Button>
    </div>
  )
}
