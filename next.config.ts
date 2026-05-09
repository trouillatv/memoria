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
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
