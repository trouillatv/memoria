import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  // pdf-parse + pdfjs-dist utilisent un worker dynamiquement importé qui ne
  // résout pas correctement à travers Turbopack. On les externalise du bundle
  // serveur pour que Node les charge nativement (avec leurs paths internes intacts).
  // @react-pdf/renderer dépend de yoga-layout (WASM) et fontkit qui ne supportent
  // pas le bundling Turbopack côté serveur — on les externalise pareil.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ]
  },
  // @resvg/resvg-js est un binding natif (.node) — Turbopack ne peut pas le
  // bundler, on l'externalise pour que Node le charge nativement.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@react-pdf/renderer', '@google/genai', '@resvg/resvg-js'],
  // Le tracer de build (@vercel/nft) ne voit que les appels fs.*/require des
  // sources JS/TS — il n'a aucune visibilité sur ce qu'un binding natif
  // (@resvg/resvg-js) fait en interne d'un chemin passé en argument
  // (`fontFiles`, cf. lib/pdf/cr-map-snapshot.ts). Sans cette inclusion
  // explicite, la police bundlée est absente du déploiement serverless Vercel
  // alors qu'elle existe en local (correctif carte PDF, 2026-08-27).
  outputFileTracingIncludes: {
    '/**': ['./lib/pdf/assets/fonts/**'],
  },
};

export default nextConfig;
