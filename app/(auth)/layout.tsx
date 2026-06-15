export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="force-light-theme relative min-h-screen flex items-center justify-center overflow-hidden bg-[#eef1f3] p-4 text-[#26313b]">
      {/* Fond sobre et professionnel : dégradé radial très léger + texture de
          grille discrète, cohérent avec la landing (pas de gros aplats plats). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.9),_transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.4] [background-image:linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:32px_32px]"
      />
      <div className="relative w-full max-w-md">
        {children}
      </div>
    </div>
  )
}
