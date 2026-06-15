/**
 * HARNAIS JETABLE (Vincent 2026-05-26) — capture de parcours métier.
 *
 * Pilote Chromium (Playwright) en se connectant comme Manager / Chef / Admin
 * sur le dev server LOCAL (port 3000, env .env.test). Pour chaque étape :
 * screenshot pleine page + texte visible + affordances (boutons/liens) → tmp/.
 *
 * NE FAIT AUCUNE correction. NE déclenche PAS d'appels LLM (on n'envoie pas de
 * message Atelier IA). Garde-fou dur : avorte si une requête part vers
 * *.supabase.co (jamais la prod).
 *
 * Usage : source tmp/localenv.sh && npx tsx scripts/dev/walkthrough-capture.ts
 */
import { chromium, type Page } from 'playwright'
import * as fs from 'fs'

const BASE = process.env.WT_BASE ?? 'http://localhost:3000'
const PWD = 'Password123!'
const OUT = 'tmp/walkthrough'

let stepCounter = 0

async function capture(page: Page, role: string, label: string) {
  const dir = `${OUT}/${role}`
  fs.mkdirSync(dir, { recursive: true })
  const n = String(++stepCounter).padStart(2, '0')
  try {
    await page.screenshot({ path: `${dir}/${n}_${label}.png`, fullPage: true })
  } catch (e) {
    await page.screenshot({ path: `${dir}/${n}_${label}.png` }).catch(() => {})
  }
  const data = await page.evaluate(() => {
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
    const clickables = Array.from(
      document.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
    )
      .map((el) => clean((el as HTMLElement).innerText || el.getAttribute('aria-label') || (el as HTMLInputElement).value || ''))
      .filter(Boolean)
    return {
      url: location.href,
      title: document.title,
      h1: Array.from(document.querySelectorAll('h1,h2')).map((e) => clean((e as HTMLElement).innerText)).filter(Boolean).slice(0, 12),
      clickables: Array.from(new Set(clickables)).slice(0, 60),
      text: clean(document.body.innerText).slice(0, 3500),
    }
  })
  fs.appendFileSync(
    `${dir}/_log.md`,
    `\n\n## ${n} — ${label}\n- URL: ${data.url}\n- Titres: ${data.h1.join(' | ')}\n- Affordances: ${data.clickables.join(' · ')}\n\nTexte visible:\n> ${data.text.replace(/\n/g, '\n> ')}\n`,
  )
  console.log(`  [${role}] ${n}_${label} -> ${data.url}`)
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#email', email)
  await page.fill('#password', PWD)
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1500)
}

async function goto(page: Page, path: string, label: string, role: string) {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    /* page peut timeout sur dev — on capture quand même l'état */
  }
  await page.waitForTimeout(1400) // laisse les Server Components / Suspense se résoudre
  await capture(page, role, label)
}

/**
 * Ouvre la première fiche DÉTAIL sous /<base>/<uuid> (saute les liens de nav
 * comme /tenders/memoire, /tenders/new). Va sur l'URL trouvée + capture.
 * Retourne le href atteint (pour en extraire l'id).
 */
async function openFirstDetail(page: Page, base: string, label: string, role: string): Promise<string | null> {
  const href = await page.evaluate((base) => {
    const re = new RegExp(`^/${base}/[0-9a-fA-F-]{36}(\\b|/|$)`)
    const a = Array.from(document.querySelectorAll('a[href]')).find((el) => {
      try {
        return re.test(new URL((el as HTMLAnchorElement).href).pathname)
      } catch {
        return false
      }
    })
    return a ? new URL((a as HTMLAnchorElement).href).pathname : null
  }, base)
  if (!href) {
    await capture(page, role, `${label}-AUCUNE-FICHE`)
    return null
  }
  try {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    /* capture l'état même si timeout */
  }
  await page.waitForTimeout(1400)
  await capture(page, role, label)
  return href
}

async function run() {
  const browser = await chromium.launch()

  /** Crée un context ISOLÉ (cookies neufs) avec shim + garde-fou prod + trace. */
  async function freshContext(viewport: { width: number; height: number }) {
    const context = await browser.newContext({ viewport })
    // tsx/esbuild (keepNames) injecte `__name` dans le code sérialisé vers
    // page.evaluate, absent du navigateur. Shim global pour l'éviter.
    await context.addInitScript(() => {
      ;(globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f
    })
    // GARDE-FOU DUR : aucune requête ne doit partir vers la prod hébergée.
    context.on('request', (req) => {
      if (req.url().includes('supabase.co')) {
        console.error('!!! REQUÊTE PROD DÉTECTÉE — ABANDON :', req.url())
        process.exit(1)
      }
    })
    await context.tracing.start({ screenshots: true, snapshots: true })
    return context
  }

  // ===================== MANAGER =====================
  {
    const role = 'manager'
    stepCounter = 0
    const context = await freshContext({ width: 1280, height: 900 })
    const page = await context.newPage()
    await login(page, 'manager@memoria.local')
    await capture(page, role, 'apres-login')
    await goto(page, '/dashboard', 'dashboard', role)
    await goto(page, '/contracts', 'contrats-liste', role)
    await openFirstDetail(page, 'contracts', 'contrat-detail', role)
    await goto(page, '/sites', 'sites-liste', role)
    await openFirstDetail(page, 'sites', 'site-detail', role)
    await goto(page, '/continuite', 'continuite-passation', role)
    await goto(page, '/handovers', 'handovers-liste', role)
    await openFirstDetail(page, 'handovers', 'handover-detail', role)
    await goto(page, '/intervenants', 'intervenants-liste', role)
    await goto(page, '/documents', 'documents-liste', role)
    await goto(page, '/documents/import', 'documents-import', role)
    // Timeline mémoire AO (états déjà seedés, ZÉRO appel LLM) :
    await goto(page, '/tenders', 'ao-liste', role)
    const tenderHref = await openFirstDetail(page, 'tenders', 'ao-detail-atelier-SANS-llm', role)
    const tenderId = tenderHref?.match(/\/tenders\/([0-9a-fA-F-]{36})/)?.[1]
    if (tenderId) {
      await goto(page, `/tenders/${tenderId}/engagements`, 'ao-engagements-extraits', role)
      await goto(page, `/tenders/${tenderId}/convert`, 'ao-curation-conversion', role)
    }
    await goto(page, '/preuves', 'preuves-liste', role)
    await context.tracing.stop({ path: `${OUT}/trace-${role}.zip` })
    await context.close()
  }

  // ===================== CHEF D'ÉQUIPE (mobile) =====================
  {
    const role = 'chef'
    stepCounter = 0
    const context = await freshContext({ width: 390, height: 844 }) // iPhone-ish
    const page = await context.newPage()
    await login(page, 'chef.noumea@memoria.local')
    await capture(page, role, 'apres-login-redir')
    await goto(page, '/m', 'm-jour', role)
    await openFirstDetail(page, 'm/intervention', 'intervention-avant-commencer', role)
    // Tenter d'ouvrir le modal anomalie AVANT "Commencer" (test C3).
    const anomalyBtn = page.getByRole('button', { name: /anomalie/i }).first()
    if ((await anomalyBtn.count()) > 0) {
      await anomalyBtn.click().catch(() => {})
      await page.waitForTimeout(700)
      await capture(page, role, 'anomalie-avant-commencer')
      await page.keyboard.press('Escape').catch(() => {})
    } else {
      await capture(page, role, 'anomalie-bouton-absent-avant-commencer')
    }
    // Cliquer "Commencer" si présent.
    const startBtn = page.getByRole('button', { name: /commencer|démarrer/i }).first()
    if ((await startBtn.count()) > 0) {
      await startBtn.click().catch(() => {})
      await page.waitForTimeout(1200)
      await capture(page, role, 'intervention-apres-commencer-consignes')
    }
    await context.tracing.stop({ path: `${OUT}/trace-${role}.zip` })
    await context.close()
  }

  // ===================== ADMIN / PILOTE =====================
  {
    const role = 'admin'
    stepCounter = 0
    const context = await freshContext({ width: 1280, height: 900 })
    const page = await context.newPage()
    await login(page, 'admin@memoria.local')
    await capture(page, role, 'apres-login')
    await goto(page, '/admin', 'admin-accueil', role)
    await goto(page, '/admin/personnes', 'admin-personnes', role)
    await goto(page, '/admin/activite', 'admin-activite', role)
    await goto(page, '/admin/depenses-ia', 'admin-depenses-ia', role)
    await goto(page, '/admin/feedback', 'admin-feedback', role)
    await goto(page, '/intervenants', 'admin-intervenants', role)
    await openFirstDetail(page, 'intervenants', 'intervenant-detail-page-sensible', role)
    await goto(page, '/litige', 'litige', role)
    await context.tracing.stop({ path: `${OUT}/trace-${role}.zip` })
    await context.close()
  }

  await browser.close()
  console.log('\n[done] Captures dans', OUT, '— traces : trace-{manager,chef,admin}.zip')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
