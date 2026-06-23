// POST /api/feedback — l'utilisateur soumet un feedback in-app.
//
// Mise à jour 2026-06-14 :
//   - Accepte désormais multipart/form-data (FormData) pour les pièces jointes.
//   - Upload des images vers Supabase Storage (bucket feedback-attachments).
//   - Notifie par email via Resend (fire-and-forget, ne bloque pas si absent).
//     Vars requises : RESEND_API_KEY, FEEDBACK_NOTIFY_EMAIL.
//
// Original Vincent 2026-05-21 : auth obligatoire, rate limit 10/min/user,
// capture page + user-agent automatiquement.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'

const MAX_MESSAGE_LENGTH = 2000
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX = 10
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  // 5 Mo
const MAX_ATTACHMENTS = 3

// ───────────────────────────────── Email notification ─────────────────────────

async function sendFeedbackEmail(params: {
  userName: string
  page: string | null
  message: string
  attachmentCount: number
}) {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.FEEDBACK_NOTIFY_EMAIL
  // Expéditeur configurable : une fois un domaine vérifié dans Resend, définir
  // FEEDBACK_FROM_EMAIL (ex « MemorIA <feedback@mondomaine.fr> ») pour une bonne
  // délivrabilité. Défaut = bac à sable Resend (souvent bloqué par Hotmail/Outlook).
  const from = process.env.FEEDBACK_FROM_EMAIL ?? 'MemorIA Feedback <onboarding@resend.dev>'

  if (!apiKey || !to) {
    // NON silencieux (avant : `return` muet → l'absence d'email était invisible).
    const missing = [!apiKey && 'RESEND_API_KEY', !to && 'FEEDBACK_NOTIFY_EMAIL']
      .filter(Boolean)
      .join(', ')
    console.warn(
      `[feedback-email] Relais email sauté — variable(s) manquante(s) en prod : ${missing}. ` +
        `À définir dans Vercel → Settings → Environment Variables, puis redéployer.`,
    )
    return
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const adminLink = appUrl ? `${appUrl}/admin/feedback` : '/admin/feedback'

  const safeMessage = params.message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;color:#111">
      <h2 style="margin:0 0 4px">Nouveau retour MemorIA</h2>
      <p style="margin:0 0 12px;color:#555;font-size:14px">
        De&nbsp;: <strong>${params.userName}</strong>
        ${params.page ? `&nbsp;·&nbsp;Page&nbsp;: <code style="background:#f4f4f4;padding:1px 4px;border-radius:3px">${params.page}</code>` : ''}
      </p>
      ${params.attachmentCount > 0
        ? `<p style="margin:0 0 12px;color:#555;font-size:14px">📎 ${params.attachmentCount} pièce(s) jointe(s) — voir dans l'interface</p>`
        : ''}
      <blockquote style="margin:0 0 16px;border-left:3px solid #e0e0e0;padding:8px 12px;background:#fafafa;font-size:14px;line-height:1.6;white-space:pre-wrap">${safeMessage}</blockquote>
      <p style="margin:0">
        <a href="${adminLink}" style="color:#0070f3;font-size:14px">Voir dans MemorIA → /admin/feedback</a>
      </p>
    </div>
  `

  // Fire-and-forget : l'échec email ne bloque jamais le feedback — mais on LOGGE
  // désormais le refus Resend (ex : sandbox onboarding@resend.dev limité à
  // l'adresse du compte) pour rendre le diagnostic possible.
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `[MemorIA] Retour de ${params.userName}`,
        html,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn(
        `[feedback-email] Resend a refusé l'envoi (HTTP ${res.status}). ` +
          `Souvent : expéditeur sandbox (vérifier un domaine + FEEDBACK_FROM_EMAIL) ` +
          `ou destinataire non autorisé. Détail : ${detail.slice(0, 300)}`,
      )
    }
  } catch (e) {
    console.warn('[feedback-email] Échec réseau vers Resend :', e)
  }
}

// ───────────────────────────────── Route handler ──────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Accepte FormData (avec pièces jointes) ET JSON (rétrocompat anciens clients)
    const contentType = req.headers.get('content-type') ?? ''
    let message = ''
    let page: string | null = null
    let rawFiles: File[] = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData().catch(() => null)
      if (!formData) {
        return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 })
      }
      message = ((formData.get('message') as string | null) ?? '').trim()
      page = (formData.get('page') as string | null) ?? null
      rawFiles = formData.getAll('files').filter((f): f is File => f instanceof File)
    } else {
      const body = (await req.json().catch(() => null)) as {
        message?: string
        page?: string
      } | null
      message = (body?.message ?? '').trim()
      page = body?.page ?? null
    }

    if (!message) {
      return NextResponse.json({ ok: false, reason: 'empty_message' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ ok: false, reason: 'message_too_long' }, { status: 400 })
    }

    // Auth
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 })
    }

    // Rate limit
    const admin = createAdminClient()
    const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
    const { count: recentCount } = await admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sinceIso)
    if ((recentCount ?? 0) >= RATE_LIMIT_MAX) {
      return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
    }

    // Upload des pièces jointes vers Supabase Storage (admin client, bypass RLS)
    const validFiles = rawFiles
      .filter((f) => f.type.startsWith('image/') && f.size > 0 && f.size <= MAX_ATTACHMENT_BYTES)
      .slice(0, MAX_ATTACHMENTS)

    const attachmentPaths: string[] = []
    for (const file of validFiles) {
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'png').toLowerCase()
      const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'png'
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const { error } = await admin.storage
        .from('feedback-attachments')
        .upload(path, buffer, { contentType: file.type, upsert: false })
      if (!error) attachmentPaths.push(path)
    }

    // Nom d'affichage pour l'email
    const { data: profile } = await admin
      .from('users')
      .select('full_name, email')
      .eq('id', user.id)
      .maybeSingle()
    const userName = (profile as { full_name?: string | null; email?: string | null } | null)
      ?.full_name
      ?? (profile as { full_name?: string | null; email?: string | null } | null)?.email
      ?? user.email
      ?? 'Utilisateur'

    // Insert
    const userAgent = req.headers.get('user-agent') ?? null
    const { data: inserted, error: insertErr } = await admin
      .from('feedback')
      .insert({
        user_id: user.id,
        message,
        page: page ?? null,
        user_agent: userAgent,
        attachment_paths: attachmentPaths,
      })
      .select('id')
      .single()
    if (insertErr || !inserted) {
      return NextResponse.json({ ok: false, reason: 'insert_failed' }, { status: 500 })
    }

    // Audit
    await logAuditEvent({
      userId: user.id,
      entityType: 'feedback',
      entityId: inserted.id,
      action: 'created',
      metadata: {
        page: page ?? null,
        message_length: message.length,
        attachment_count: attachmentPaths.length,
      },
    })

    // Email (fire-and-forget)
    sendFeedbackEmail({
      userName: String(userName),
      page,
      message,
      attachmentCount: attachmentPaths.length,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
}
