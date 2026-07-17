import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { QrCode, Download, Eye, Clock, ShieldOff, Smartphone, Monitor, Plus } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteQrInfo, getSiteQrHistory, type QrHistoryEvent } from '@/lib/db/site-qr'
import { DynamicCrumb, BreadcrumbPrefix } from '@/components/layout/BreadcrumbProvider'
import { ActivateQrButton } from './ActivateQrButton'
import { RevokeQrButton } from './RevokeQrButton'
import { QrShareActions } from './QrShareActions'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SiteQrPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [info, history] = await Promise.all([
    getSiteQrInfo(id),
    getSiteQrHistory(id),
  ])
  if (!info) notFound()

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const proto = headersList.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
  const baseUrl = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_BASE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001'))

  const tok = info.token
  const publicUrl = tok ? `${baseUrl}/qr/${tok.token}` : null
  let qrDataUrl: string | null = null

  if (publicUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(publicUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
    } catch {
      // non bloquant
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          timeZone: 'Pacific/Noumea',
        })
      : null

  const fmtFull = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Pacific/Noumea',
    })

  function deviceLabel(ua: string | null | undefined): string {
    if (!ua) return ''
    const u = ua.toLowerCase()
    if (u.includes('mobile') || u.includes('android') || u.includes('iphone')) return 'Mobile'
    if (u.includes('tablet') || u.includes('ipad')) return 'Tablette'
    return 'Navigateur web'
  }

  return (
    <div className="space-y-6 w-full max-w-lg">
      <DynamicCrumb segmentId="qr" label="QR Code" />
      <BreadcrumbPrefix
        crumbs={[
          { href: '/sites', label: 'Chantiers' },
          { href: `/sites/${id}`, label: info.name },
        ]}
      />

      <Link
        href={`/sites/${id}`}
        className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
      >
        ← {info.name}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <QrCode className="h-5 w-5 text-muted-foreground" />
          QR Code chantier
        </h1>
        <p className="text-sm text-muted-foreground">
          Scannez ce code pour accéder au journal du chantier sans connexion.
        </p>
      </header>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">
            Historique
          </h2>
          <ol className="relative border-l border-border pl-5 space-y-3">
            {history.map((ev: QrHistoryEvent, i: number) => {
              const isGenerated = ev.type === 'generated'
              const isRevoked = ev.type === 'revoked'
              const isScanned = ev.type === 'scanned'
              const device = isScanned ? deviceLabel(ev.userAgent) : null
              return (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[1.4rem] top-[2px] flex h-5 w-5 items-center justify-center rounded-full border bg-background ${
                      isGenerated
                        ? 'border-emerald-400 text-emerald-600'
                        : isRevoked
                          ? 'border-rose-300 text-rose-500'
                          : 'border-slate-200 text-muted-foreground'
                    }`}
                  >
                    {isGenerated && <Plus className="h-3 w-3" />}
                    {isRevoked && <ShieldOff className="h-3 w-3" />}
                    {isScanned && (device === 'Mobile' || device === 'Tablette'
                      ? <Smartphone className="h-3 w-3" />
                      : <Monitor className="h-3 w-3" />)}
                  </span>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {isGenerated && 'Généré'}
                      {isRevoked && 'Révoqué'}
                      {isScanned && 'Scanné'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isScanned ? fmtFull(ev.at) : fmt(ev.at)}
                    </span>
                    {device && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {device}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/50 font-mono">
                      …{ev.tokenSuffix}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {!tok ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
          <QrCode className="h-12 w-12 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Pas encore de QR Code</p>
            <p className="text-xs text-muted-foreground">
              Générez un lien unique pour ce chantier. Il sera valable indéfiniment, sauf révocation.
            </p>
          </div>
          <ActivateQrButton siteId={id} />
        </div>
      ) : (
        <div className="space-y-4">
          {qrDataUrl && publicUrl && (
            <div className="rounded-lg border bg-white p-6 flex flex-col items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR Code - ${info.name}`}
                width={240}
                height={240}
                className="rounded"
              />
              <a
                href={qrDataUrl}
                download={`qr-${info.name.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}.png`}
                className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </a>
              <QrShareActions siteName={info.name} publicUrl={publicUrl} />
            </div>
          )}

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {tok.access_count} accès
            </span>
            {tok.last_accessed_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Dernier : {fmt(tok.last_accessed_at)}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Ce QR Code donne accès en lecture seule au journal du chantier, sans connexion.
            Idéal pour une impression à coller sur la porte ou dans le bureau de chantier.
          </p>

          <div className="border-t pt-4 flex items-center gap-3">
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">
                Révoquer génère un lien invalide immédiatement. Un nouveau QR Code peut être créé après.
              </p>
            </div>
            <RevokeQrButton siteId={id} />
          </div>
        </div>
      )}
    </div>
  )
}
