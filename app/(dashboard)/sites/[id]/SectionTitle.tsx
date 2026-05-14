/**
 * V5.1.3 — Titre H2 commun aux sections 2-7 page Site.
 *
 * Pattern : `text-[11px] uppercase tracking-[0.18em] text-[#888] font-normal`
 * + filet `border-t border-[#e8e8e8] pt-6`. Pas de chiffrage, pas d'icône.
 * Le titre est un repère discret, pas un panneau.
 */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[11px] uppercase tracking-[0.18em] font-normal pt-6 border-t"
      style={{ color: '#888', borderColor: '#e8e8e8' }}
    >
      {children}
    </h2>
  )
}
