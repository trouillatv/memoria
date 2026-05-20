// POST /api/feedback — l'utilisateur soumet un feedback in-app.
//
// Vincent 2026-05-21 : bouton flottant desktop. Auth obligatoire. Rate limit
// 10/min/user. Capture page (pathname) + user-agent automatiquement.
//
// Trace cross-monitoring : on logue aussi un `logAuditEvent` côté serveur
// pour que le feedback apparaisse dans /admin/monitoring sans dupliquer la
// donnée (la table `feedback` reste la source de vérité pour /admin/feedback).

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit/log'

const MAX_MESSAGE_LENGTH = 2000
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX = 10

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      message?: string
      page?: string
    } | null

    if (!body?.message?.trim()) {
      return NextResponse.json(
        { ok: false, reason: 'empty_message' },
        { status: 400 },
      )
    }
    const trimmed = body.message.trim()
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { ok: false, reason: 'message_too_long' },
        { status: 400 },
      )
    }

    // Auth via cookies SSR — l'utilisateur DOIT être connecté.
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { ok: false, reason: 'unauthenticated' },
        { status: 401 },
      )
    }

    // Rate limit : 10 feedbacks max par 60s pour ce user.
    const admin = createAdminClient()
    const sinceIso = new Date(
      Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000,
    ).toISOString()
    const { count: recentCount } = await admin
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', sinceIso)
    if ((recentCount ?? 0) >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { ok: false, reason: 'rate_limited' },
        { status: 429 },
      )
    }

    const userAgent = req.headers.get('user-agent') ?? null

    const { data: inserted, error: insertErr } = await admin
      .from('feedback')
      .insert({
        user_id: user.id,
        message: trimmed,
        page: body.page ?? null,
        user_agent: userAgent,
      })
      .select('id')
      .single()
    if (insertErr || !inserted) {
      return NextResponse.json(
        { ok: false, reason: 'insert_failed' },
        { status: 500 },
      )
    }

    // Trace cross-monitoring : visible dans /admin/monitoring sans
    // duplication de la donnée elle-même.
    await logAuditEvent({
      userId: user.id,
      entityType: 'feedback',
      entityId: inserted.id,
      action: 'created',
      metadata: {
        page: body.page ?? null,
        message_length: trimmed.length,
      },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'server_error' },
      { status: 500 },
    )
  }
}
