import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/providers/ThemeProvider"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: 'MemorIA',
  description: 'Mémoire opérationnelle de vos chantiers',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'MemorIA',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: "#0f172a",
}

// Script synchrone exécuté dans <head> avant tout rendu : corrige le viewport
// que Chrome Android force à 980 px en mode "Demander le site pour ordinateur".
// Même logique que FieldViewportFix, mais sans flash car aucun rendu n'a encore eu lieu.
const VIEWPORT_FIX = `(function(){try{if(screen.width<640&&window.innerWidth>640){var m=document.querySelector('meta[name="viewport"]');if(m)m.content='width='+screen.width+',initial-scale=1,viewport-fit=cover';}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Correction viewport synchrone — avant tout rendu React. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_FIX }} />
      </head>
      {/* suppressHydrationWarning sur <body> : neutralise les attributs injectés
          par les extensions navigateur (ColorZilla `cz-shortcut-listen`,
          Grammarly `data-gr-*`, LastPass `data-lastpass-*`, etc.) qui modifient
          le DOM côté client avant l'hydration React. Sans effet sur le rendu. */}
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        {/* V5.1 — mode clair par défaut. Plus de detection auto OS qui
            poussait l'app mobile en dark mode sur les iPhones configurés en
            mode sombre. Le toggle ThemeToggle reste fonctionnel : l'user
            peut explicitement passer en dark via le toggle, sa préférence
            sera persistée en localStorage. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} themes={['light', 'dark', 'ocre', 'petrole', 'archive', 'monolithe']}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
