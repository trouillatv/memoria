// POST /api/share-comment — commentaire public sur un dossier de preuves partagé.
//
// Accepte multipart/form-data (avec photos) ou application/json (rétro-compat).
// Aucune auth requise — la page /p/[token] est publique.
// Rate limit : 3 commentaires / token / heure (par IP hashée).
// Photos : max 3 fichiers, max 5 Mo chacun, stockés dans intervention-photos/share-comments/.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'

const MAX_COMMENT_LENGTH = 2000
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX = 3
const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // 5 MB

export async function POST(req: NextRequest) {
  try {
    let token: string | undefined
    let visitorLabel: string | null = null
    let comment: string | undefined
    let photoFiles: File[] = []

    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      token = (fd.get('token') as string) || undefined
      visitorLabel = (fd.get('visitor_label') as string) || null
      comment = (fd.get('comment') as string) || undefined
      const raw = fd.getAll('photos')
      photoFiles = raw.filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS)
    } else {
      const body = (await req.json().catch(() => null)) as {
        token?: string; visitor_label?: string; comment?: string
      } | null
      token = body?.token
      visitorLabel = body?.visitor_label ?? null
      comment = body?.comment
    }

    if (!token) return NextResponse.json({ ok: false, reason: 'missing_token' }, { status: 400 })
    if (!comment?.trim()) return NextResponse.json({ ok: false, reason: 'empty_comment' }, { status: 400 })
    if (comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json({ ok: false, reason: 'comment_too_long' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Vérifie que le token est actif
    const { data: shareToken } = await admin
      .from('proof_share_tokens')
      .select('id, revoked_at, expires_at')
      .eq('token', token)
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

    // Upload des photos dans intervention-photos/share-comments/{token_id}/
    const photoPaths: string[] = []
    for (const file of photoFiles) {
      if (file.size > MAX_PHOTO_BYTES) continue
      if (!file.type.startsWith('image/')) continue
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
      const path = `share-comments/${shareToken.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const { error } = await admin.storage
        .from('intervention-photos')
        .upload(path, buffer, { contentType: file.type, upsert: false })
      if (!error) photoPaths.push(path)
    }

    const { error } = await admin.from('share_token_comments').insert({
      token_id: shareToken.id,
      visitor_label: visitorLabel?.trim().slice(0, 100) || null,
      comment: comment.trim(),
      ip_hash: ipHash,
      photo_paths: photoPaths.length > 0 ? photoPaths : null,
    })
    if (error) return NextResponse.json({ ok: false, reason: 'insert_failed' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }
}
