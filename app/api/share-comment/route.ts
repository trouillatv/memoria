// POST /api/share-comment — commentaire public sur un dossier de preuves partagé.
//
// Aucune auth requise — la page /p/[token] est publique.
// Rate limit : 3 commentaires / token / heure (par IP hashée).
// Le token doit être actif (non révoqué, non expiré).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

const MAX_COMMENT_LENGTH = 2000
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1h
const RATE_LIMIT_MAX = 3

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      token?: string
      visitor_label?: string
      comment?: string
    } | null

    if (!body?.token) return NextResponse.json({ ok: false, reason: 'missing_token' }, { status: 400 })
    if (!body?.comment?.trim()) return NextResponse.json({ ok: false, reason: 'empty_comment' }, { status: 400 })
    if (body.comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json({ ok: false, reason: 'comment_too_long' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Vérifie que le token est actif
    const { data: shareToken } = await admin
      .from('proof_share_tokens')
      .select('id, revoked_at, expires_at')
      .eq('token', body.token)
      .maybeSingle()

    if (!shareToken) return NextResponse.json({ ok: false, reason: 'invalid_token' }, { status: 404 })
    if (shareToken.revoked_at) return NextResponse.json({ ok: false, reason: 'token_revoked' }, { status: 403 })
    if (new Date(shareToken.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, reason: 'token_expired' }, { status: 403 })
    }

    // Rate limit par IP hashée
    const xff = req.headers.get('x-forwarded-for')
    const rawIp = xff ? xff.split(',')[0]?.trim() : (req.headers.get('x-real-ip') ?? 'unknown')
    const ipHash = createHash('sha256').update(rawIp ?? 'unknown').digest('hex').slice(0, 16)

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
    const { count } = await admin
      .from('share_token_comments')
      .select('id', { count: 'exact', head: true })
      .eq('token_id', shareToken.id)
      .eq('ip_hash', ipHash)
      .gte('created_at', since)
    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
    }

    const visitorLabel = body.visitor_label?.trim().slice(0, 100) || null

    const { error } = await admin.from('share_token_comments').insert({
      token_id: shareToken.id,
      visitor_label: visitorLabel,
      comment: body.comment.trim(),
      ip_hash: ipHash,
    })
    if (error) return NextResponse.json({ ok: false, reason: 'insert_failed' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
}
