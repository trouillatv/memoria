// V5.1 Slice 4 — Atelier capsule WhatsApp (côté Guillaume).
//
// Doctrine Vincent 2026-05-14 :
//   - Pas de génération IA libre. Phrase produite par template déterministe
//     (lib/whatsapp/templates.ts).
//   - Guillaume reste expéditeur via wa.me — l'app ne fait pas d'envoi auto.
//   - Une seule action principale : "Préparer la capsule de [mois courant]".
//     Auto-sélection minimale (photo saillante + dernière anomalie). Guillaume
//     valide via la preview avant de copier-coller dans WhatsApp.
//
// Cf. plan V5.1.2 § Slice 4.

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getContract } from '@/lib/db/contracts'
import { getCapsulePublicView } from '@/lib/db/capsule-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { prepareMonthlyCapsuleAction } from './actions'
import { WhatsAppPreview } from './WhatsAppPreview'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ token?: string; month?: string }>
}

function currentMonthYYYYMM(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousMonthYYYYMM(): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function ContractCapsulePage({
  params,
  searchParams,
}: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const { id: contractId } = await params
  const { token: previewToken, month: monthParam } = await searchParams

  const contract = await getContract(contractId)
  if (!contract) notFound()

  // Mois courant par défaut, sinon mois précédent (cas "1er du mois je
  // prépare la capsule du mois écoulé"). Guillaume peut override via ?month=.
  const today = new Date()
  const isEarlyInMonth = today.getUTCDate() <= 5
  const defaultMonth = isEarlyInMonth ? previousMonthYYYYMM() : currentMonthYYYYMM()
  const targetMonth = monthParam ?? defaultMonth

  // Récupération des capsules existantes pour ce contrat
  const supabase = createAdminClient()
  const { data: existingCapsules } = await supabase
    .from('proof_share_tokens')
    .select('token, report_month, dg_note, created_at, expires_at, revoked_at')
    .eq('contract_id', contractId)
    .eq('presentation_kind', 'monthly_capsule')
    .order('created_at', { ascending: false })
    .limit(10)

  // Preview courante si ?token=X
  let preview: Awaited<ReturnType<typeof getCapsulePublicView>> | null = null
  let publicUrl = ''
  if (previewToken) {
    preview = await getCapsulePublicView(previewToken)
    if (preview) {
      const hdrs = await headers()
      const host = hdrs.get('host') ?? 'localhost:3000'
      const proto = hdrs.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
      publicUrl = `${proto}://${host}/c/${previewToken}`
    }
  }

  return (
    <div className="space-y-6 w-full">
      <header className="space-y-1">
        <Link
          href={`/contracts/${contractId}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {contract.name}
        </Link>
        <h1 className="text-2xl font-semibold">Capsules WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Fragments mensuels à partager avec votre client par WhatsApp. Vous restez
          l&apos;expéditeur.
        </p>
      </header>

      {/* Form de préparation */}
      <section className="rounded-lg border bg-card p-4 space-y-3 max-w-md">
        <h2 className="text-sm font-semibold">Préparer une capsule</h2>
        <form action={async (formData) => {
          'use server'
          const result = await prepareMonthlyCapsuleAction(formData)
          if ('ok' in result && result.ok) {
            redirect(`/contracts/${contractId}/capsule?token=${result.token}`)
          }
          // En cas d'erreur, la page se recharge avec un message (TODO V5.2 : afficher l'erreur côté UI)
        }}>
          <input type="hidden" name="contractId" value={contractId} />
          <label className="block text-xs text-muted-foreground">
            Mois
            <input
              type="text"
              name="reportMonth"
              defaultValue={targetMonth}
              pattern="\d{4}-(0[1-9]|1[0-2])"
              required
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
            />
          </label>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            Préparer la capsule
          </button>
        </form>
      </section>

      {/* Preview courante si on vient de générer une capsule */}
      {preview && publicUrl && preview.photoUrls[0] && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Aperçu</h2>
          <WhatsAppPreview
            photoUrl={preview.photoUrls[0]}
            text={preview.text}
            publicUrl={publicUrl}
            tenantName={preview.tenantName}
          />
        </section>
      )}

      {/* Historique des capsules du contrat */}
      {(existingCapsules ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Historique</h2>
          <ul className="space-y-1.5">
            {(existingCapsules ?? []).map((c) => {
              const expired = new Date(c.expires_at).getTime() < Date.now()
              const revoked = !!c.revoked_at
              return (
                <li key={c.token}>
                  <Link
                    href={`/contracts/${contractId}/capsule?token=${c.token}&month=${c.report_month}`}
                    className="block rounded-md border bg-card p-3 hover:bg-muted/30"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">
                        {c.report_month}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {revoked ? 'révoquée' : expired ? 'expirée' : 'active'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {c.dg_note}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
