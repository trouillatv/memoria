'use client'

import { useState } from 'react'
import { Share2, Mail, MessageCircle, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export interface UserWithPhone {
  id: string
  full_name: string | null
  email: string
  role: string
  phone: string
}

interface Props {
  text: string
  url: string
  date: string
  isManager: boolean
  usersWithPhone: UserWithPhone[]
}

type Channel = 'mail' | 'whatsapp'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  chef_equipe: 'Chef équipe',
}

function buildMailHref(date: string, text: string, url: string, to: string): string {
  const subject = encodeURIComponent(`Briefing — ${date}`)
  const body = encodeURIComponent(`${text}\n\nDétails : ${url}`)
  const prefix = to ? `mailto:${encodeURIComponent(to)}` : 'mailto:'
  return `${prefix}?subject=${subject}&body=${body}`
}

function buildWhatsAppHref(phone: string, text: string, url: string): string {
  const payload = encodeURIComponent(`${text}\n\nDétails : ${url}`)
  const digits = phone.replace(/^\+/, '')
  return `https://wa.me/${digits}?text=${payload}`
}

export function BriefingShareModal({ text, url, date, isManager, usersWithPhone }: Props) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<Channel>('mail')
  const [mailTo, setMailTo] = useState('')
  const [recipientId, setRecipientId] = useState<string>(usersWithPhone[0]?.id ?? '')

  const selectedUser = usersWithPhone.find(u => u.id === recipientId)

  const mailHref = buildMailHref(date, text, url, mailTo)
  const waHref = selectedUser ? buildWhatsAppHref(selectedUser.phone, text, url) : ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card hover:bg-muted text-sm font-medium px-3 h-8 transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" />
        Partager le briefing
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Partager le briefing</DialogTitle>
        </DialogHeader>

        {/* Channel selector */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setChannel('mail')}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors ${
              channel === 'mail'
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'hover:bg-muted/50 text-muted-foreground'
            }`}
          >
            <Mail className="h-4 w-4" /> Email
          </button>
          {isManager && (
            <button
              type="button"
              onClick={() => setChannel('whatsapp')}
              className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors ${
                channel === 'whatsapp'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'hover:bg-muted/50 text-muted-foreground'
              }`}
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </button>
          )}
        </div>

        {/* Aperçu message */}
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Aperçu du message</p>
          <pre className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">
            {text}
            {'\n'}
            {'Détails : '}{url}
          </pre>
        </div>

        {/* Formulaire selon canal */}
        {channel === 'mail' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Destinataire (email)</label>
              <input
                type="email"
                value={mailTo}
                onChange={e => setMailTo(e.target.value)}
                placeholder="prenom.nom@exemple.fr"
                className="w-full rounded-lg border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
              />
            </div>
            <a
              href={mailHref}
              onClick={() => setOpen(false)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ouvrir le client email
            </a>
          </div>
        )}

        {channel === 'whatsapp' && isManager && (
          <div className="space-y-3">
            {usersWithPhone.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                Aucun utilisateur avec un numéro WhatsApp enregistré.
                <br />
                <span className="text-xs">Ajoutez des numéros dans Admin → Utilisateurs.</span>
              </p>
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Destinataire</label>
                  <select
                    value={recipientId}
                    onChange={e => setRecipientId(e.target.value)}
                    className="w-full rounded-lg border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {usersWithPhone.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ?? u.email} — {ROLE_LABEL[u.role] ?? u.role} · {u.phone}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedUser && (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Ouvrir WhatsApp avec {selectedUser.full_name ?? selectedUser.email}
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
