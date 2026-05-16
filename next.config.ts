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
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@react-pdf/renderer', '@google/genai'],
};

export default nextConfig;
