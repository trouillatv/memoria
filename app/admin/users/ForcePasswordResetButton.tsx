'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { forcePasswordResetAction } from './actions'
import { toast } from 'sonner'
import { Copy, Check } from 'lucide-react'

export function ForcePasswordResetButton({ userId, isAdminUser }: { userId: string; isAdminUser: boolean }) {
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copie impossible')
    }
  }

  if (isAdminUser) {
    return <Button size="sm" variant="ghost" disabled title="Reset admin via Supabase Studio">🔒</Button>
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          if (!confirm('Réinitialiser le mot de passe de cet utilisateur ?')) return
          const fd = new FormData()
          fd.set('userId', userId)
          const r = await forcePasswordResetAction(fd)
          if (r?.error) {
            toast.error(r.error)
            return
          }
          if ('password' in r && r.password) {
            setTempPassword(r.password)
          }
        }}
      >
        Reset
      </Button>

      <Dialog open={tempPassword !== null} onOpenChange={(o) => !o && setTempPassword(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau mot de passe temporaire</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Communiquez ce mot de passe à l&apos;utilisateur via un canal sécurisé.
            Il devra le changer à sa prochaine connexion. <strong>Il ne sera plus affiché.</strong>
          </p>
          <div className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between gap-2">
            <code className="font-mono text-base break-all">{tempPassword}</code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => tempPassword && copy(tempPassword)}
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
