// Page publique /a/[token] — carnet d'actions d'une entreprise, sans login.
//
// Une « distribution » (mig 148) = un lot d'actions confié à UNE entreprise.
// Elle voit SES actions, déclare Fait / Bloqué (+ commentaire + photo), signe.
// Scope strict : aucune autre donnée du chantier. Patron : identique à /i/[token].

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { MapPin, Clock, CheckCircle2, ShieldOff } from 'lucide-react'
import {
  getDistributionByToken,
  recordDistributionAccess,
} from '@/lib/db/action-distribution'
import { DeclareActionsForm } from './DeclareActionsForm'

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function ActionDistributionPage({ params }: PageProps) {
  const { token } = await params
  const result = await getDistributionByToken(token)

  if (!result) notFound()

  if (result.state === 'active') {
    recordDistributionAccess(token).catch(() => {})
  }

  if (result.state === 'revoked') {
    return (
      <TokenInfoPage
        icon={<ShieldOff className="h-8 w-8 text-muted-foreground/40" />}
        title="Lien révoqué"
        message="Ce lien a été révoqué. Contactez la personne qui vous l'a envoyé."
      />
    )
  }
  if (result.state === 'expired') {
    return (
      <TokenInfoPage
        icon={<Clock className="h-8 w-8 text-muted-foreground/40" />}
        title="Lien expiré"
        message="Ce lien n'est plus valide. Demandez un nouveau lien."
      />
    )
  }

  const { distribution: dist, data } = result
  const alreadySubmitted = !!dist.submitted_at
  const openItems = data.items // toutes les actions du lot (vue complète)

  return (
    <div className="min-h-screen bg-background">
      {/* En-tête : entreprise + chantier */}
      <div className="border-b bg-card px-4 py-5 space-y-1.5">
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">MemorIA</span>
        <h1 className="text-xl font-semibold leading-tight">{dist.recipient_label}</h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {data.siteName}
        </p>
        {data.siteAddress && <p className="text-xs text-muted-foreground pl-5">{data.siteAddress}</p>}
        <p className="text-xs text-muted-foreground pt-0.5">
          {openItems.length} action{openItems.length > 1 ? 's' : ''} à renseigner
        </p>
      </div>

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {dist.note && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
            <p className="text-sm text-foreground/80 leading-relaxed">{dist.note}</p>
          </div>
        )}

        {alreadySubmitted ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Déjà envoyé</p>
              {dist.submitted_by_name && (
                <p className="text-xs text-emerald-700 mt-0.5">par {dist.submitted_by_name}</p>
              )}
              <p className="text-xs text-emerald-700 mt-1.5">
                Vos réponses ont été transmises. Contactez le maître d&apos;œuvre pour toute mise à jour.
              </p>
            </div>
          </div>
        ) : openItems.length === 0 ? (
          <div className="rounded-xl border bg-muted/30 p-4 text-center">
            <p className="text-sm text-muted-foreground">Aucune action dans cette liste.</p>
          </div>
        ) : (
          <DeclareActionsForm
            token={token}
            recipientLabel={dist.recipient_label}
            items={openItems.map((i) => ({
              action_id: i.action_id,
              title: i.title,
              corps_etat: i.corps_etat,
              due_date: i.due_date,
              requires_proof_photo: i.requires_proof_photo,
            }))}
          />
        )}
      </div>

      <div className="border-t px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Liste d&apos;actions pour {dist.recipient_label} · <span className="font-semibold">MemorIA</span>
        </p>
      </div>
    </div>
  )
}

function TokenInfoPage({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center space-y-3 max-w-xs">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-[10px] text-muted-foreground/50 pt-2">MemorIA</p>
      </div>
    </div>
  )
}
