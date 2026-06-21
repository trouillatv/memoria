// S3 — Dossier de preuve (VUE consolidée). Montre la valeur du QR : pour chaque
// action déclarée par une entreprise, la chaîne complète, assemblée depuis la
// donnée déjà captée (mig 148). Lecture seule, pas de PDF (volontaire).

export const dynamic = 'force-dynamic'

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  MapPin, ArrowLeft, ClipboardList, Building2, Check, Ban, MessageSquare,
  Camera, PenLine, ShieldCheck, Clock, ShieldQuestion,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listSiteProofDossiers, type ProofDossier } from '@/lib/db/proof-dossier'
import { getSignedPhotoUrlsFull } from '@/lib/storage/intervention-photos'

interface PageProps {
  params: Promise<{ id: string }>
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function SiteProofPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, dossiers] = await Promise.all([
    getSiteIdentity(id),
    listSiteProofDossiers(id),
  ])
  if (!identity) notFound()

  const photoPaths = dossiers.map((d) => d.declaredPhotoPath).filter((p): p is string => !!p)
  const photoUrls = photoPaths.length > 0 ? await getSignedPhotoUrlsFull(photoPaths) : new Map<string, string>()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dossier de preuve</h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> {identity.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Ce qui a été demandé, déclaré et prouvé par les entreprises via QR/lien. La déclaration de
          l&apos;entreprise et votre validation restent <strong>deux vérités distinctes</strong>.
        </p>
      </header>

      {dossiers.length === 0 ? (
        <div className="rounded-xl border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Aucune preuve reçue pour l&apos;instant. Les déclarations des entreprises (Fait/Bloqué + photo
            + signature) apparaîtront ici dès qu&apos;un lot d&apos;actions sera renseigné.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {dossiers.map((d, i) => (
            <ProofCard key={`${d.actionId}-${i}`} d={d} photoUrl={d.declaredPhotoPath ? photoUrls.get(d.declaredPhotoPath) ?? null : null} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 py-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  )
}

function ProofCard({ d, photoUrl }: { d: ProofDossier; photoUrl: string | null }) {
  const done = d.declaredStatus === 'done'
  return (
    <li className="rounded-xl border bg-card p-4 divide-y">
      {/* ① La demande */}
      <Row icon={<ClipboardList className="h-4 w-4" />} label="Demande">
        <span className="font-medium">{d.actionTitle}</span>
        {d.corpsEtat && <span className="text-muted-foreground"> · {d.corpsEtat}</span>}
        {d.requestedPhoto && <span className="ml-1 text-[11px] text-muted-foreground">(photo demandée)</span>}
      </Row>

      {/* ② L'entreprise */}
      <Row icon={<Building2 className="h-4 w-4" />} label="Entreprise">
        {d.recipientLabel}
      </Row>

      {/* ③ La déclaration */}
      <Row icon={done ? <Check className="h-4 w-4 text-emerald-600" /> : <Ban className="h-4 w-4 text-rose-600" />} label="Déclaration">
        <span className={done ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'}>
          {done ? 'Déclaré fait' : 'Déclaré bloqué'}
        </span>
        {d.declaredAt && <span className="text-muted-foreground"> · {fmt(d.declaredAt)}</span>}
      </Row>

      {/* ④ Commentaire */}
      {d.declaredComment && (
        <Row icon={<MessageSquare className="h-4 w-4" />} label="Commentaire">
          <span className="text-foreground/80 italic">{d.declaredComment}</span>
        </Row>
      )}

      {/* ⑤ Photo */}
      <Row icon={<Camera className="h-4 w-4" />} label="Photo">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Preuve" className="mt-1 max-h-56 rounded-lg border object-cover" />
        ) : (
          <span className="text-muted-foreground">{d.requestedPhoto ? 'Aucune photo fournie' : '—'}</span>
        )}
      </Row>

      {/* ⑥ Signature */}
      <Row icon={<PenLine className="h-4 w-4" />} label="Signature">
        {d.signatureDataUrl ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.signatureDataUrl} alt="Signature" className="h-12 rounded border bg-white" />
            {d.submittedByName && <span className="text-xs text-muted-foreground">{d.submittedByName}</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Row>

      {/* ⑦ Validation MOE — vérité distincte de la déclaration */}
      <Row
        icon={d.moeValidated ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldQuestion className="h-4 w-4 text-amber-600" />}
        label="Validation MOE"
      >
        {d.moeValidated ? (
          <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
            Validé{d.moeValidatedAt ? ` le ${fmt(d.moeValidatedAt)}` : ''}
          </span>
        ) : (
          <span className="text-amber-700 inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> À vérifier sur le terrain
          </span>
        )}
        {d.moeComment && <span className="block text-xs text-muted-foreground mt-0.5">{d.moeComment}</span>}
      </Row>
    </li>
  )
}
