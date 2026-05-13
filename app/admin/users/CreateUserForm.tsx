'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createUserAction } from './actions'
import { toast } from 'sonner'
import { Copy, Check } from 'lucide-react'

function Submit() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer'}</Button>
}

export function CreateUserForm() {
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copie impossible')
    }
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Créer un utilisateur</CardTitle></CardHeader>
        <CardContent>
          <form
            action={async (fd) => {
              const r = await createUserAction(fd)
              if (r?.error) {
                toast.error(r.error)
                return
              }
              if ('password' in r && r.password) {
                setTempPassword(r.password)
              } else {
                toast.success('Utilisateur invité par email')
              }
            }}
            className="grid gap-3 md:grid-cols-5"
          >
            <div className="md:col-span-2">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="full_name" className="text-xs">Nom complet</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div>
              <Label className="text-xs">Rôle</Label>
              <Select name="role" defaultValue="chef_equipe">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="chef_equipe">Chef d&apos;équipe</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select name="mode" defaultValue="invite">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invite">Inviter par email</SelectItem>
                  <SelectItem value="temp_password">Mdp temporaire</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-5 flex justify-end">
              <Submit />
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={tempPassword !== null} onOpenChange={(o) => !o && setTempPassword(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mot de passe temporaire</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Communiquez ce mot de passe à l&apos;utilisateur via un canal sécurisé.
            Il devra le changer à sa première connexion. <strong>Il ne sera plus affiché.</strong>
          </p>
          <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between gap-2">
            <code className="font-mono text-base break-all">{tempPassword}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => tempPassword && copyToClipboard(tempPassword)}
              className="shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copié' : 'Copier'}
            </Button>
          </div>
          <Button type="button" onClick={() => setTempPassword(null)}>
            J&apos;ai noté le mot de passe
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
