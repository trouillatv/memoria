// V5.1 Slice 4 — Layout public capsule WhatsApp.
//
// Doctrine Vincent 2026-05-14 :
//   - Fond noir #0a0a0a (grammaire visuelle V5.1 — exception au paper crème).
//   - Zéro chrome : pas de header, pas de footer (le footer "Émis par X" est
//     dans la page elle-même pour rester intégré au screenshot iPhone).
//   - Page autonome, conçue pour tenir dans un screenshot vertical sans scroll.
//   - Aucun cookie, aucun GA, aucun tracker (cohérent avec la doctrine
//     "rareté + densité d'attention" — la capsule ne se mesure pas).

export default function CapsulePublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ffffff' }}>
      {children}
    </div>
  )
}
