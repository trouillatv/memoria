// V5.1 Slice 4 — Page publique capsule WhatsApp /c/[token].
//
// Sylvie reçoit un lien WhatsApp préparé par Guillaume. Elle tape, regarde 12s,
// ferme. Pas d'interaction. Pas de bouton "Voir plus". Pas de "Télécharger"
// en gros. Juste : une photo, une phrase descriptive, une mention discrète.
//
// Grammaire sensorielle V5.1 :
//   - Fond noir (couché dans le layout)
//   - Photo plein-largeur, ratio préservé
//   - Texte 20px blanc, 2-3 lignes max
//   - Mention 11px gris foncé "Émis par X · Infrastructure : MemorIA"
//   - Aucun bouton, aucun emoji, aucune navigation
//
// Cf. plan V5.1.2 § Slice 4.

import { notFound } from 'next/navigation'
import Image from 'next/image'
import { getCapsulePublicView } from '@/lib/db/capsule-share'

interface PageProps {
  params: Promise<{ token: string }>
}

export const dynamic = 'force-dynamic'

export default async function CapsulePublicPage({ params }: PageProps) {
  const { token } = await params
  const view = await getCapsulePublicView(token)
  if (!view) notFound()

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px 32px',
        minHeight: '100vh',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      {/* Photos — empilées verticalement avec gap si plusieurs (incident
          avant/après). Ratio préservé via aspectRatio CSS. */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {view.photoUrls.map((url, idx) => (
          <div
            key={idx}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4/5',
              overflow: 'hidden',
              background: '#1a1a1a',
            }}
          >
            {/* next/image avec unoptimized pour les signed URLs Supabase qui
                expirent. Le placeholder vide reste cohérent visuellement. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
        ))}
      </div>

      {/* Phrase descriptive figée — 20px blanc, 2-3 lignes max */}
      <p
        style={{
          marginTop: 24,
          fontSize: 20,
          lineHeight: 1.45,
          color: '#ffffff',
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        {view.text}
      </p>

      {/* Mention discrète "Émis par X · Infrastructure : MemorIA" */}
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 32,
          fontSize: 11,
          color: '#888888',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Émis par {view.tenantName}
        <br />
        Infrastructure : MemorIA.
      </div>
    </main>
  )
}
