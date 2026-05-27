// Stub TEST-ONLY de `server-only`.
//
// `server-only` est un garde-fou de BUILD Next.js (il jette si un module serveur
// est importé côté client). En tests unitaires (vitest/jsdom, hors runtime RSC),
// il jetterait à l'import → on le neutralise via un alias dans vitest.config.ts.
//
// ⚠️ Ce stub n'est référencé QUE par vitest.config.ts. Le build applicatif réel
// n'utilise jamais cet alias : la protection `server-only` reste pleinement
// active en prod.
export {}
