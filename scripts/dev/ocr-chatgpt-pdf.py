"""
OCR du PDF de conversation ChatGPT via Gemini 2.5 Flash.
Vincent 2026-05-22 — le PDF (382 pages d'images d'écran) est illisible
pour pypdf. On le découpe en chunks de N pages et on envoie chaque chunk
à Gemini Vision pour extraction du texte.

Coût estimé : ~0.10$ pour les 382 pages (~10 XPF).

Sortie : docs/ChatGPT/CHATGPT.extracted.txt avec marqueurs de pages.
"""

import os
import sys
import time
import json
import base64
import io
from pathlib import Path
from typing import Optional

import pypdf
import urllib.request
import urllib.error

# Charger .env.local manuellement
env_path = Path('.env.local')
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        if line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        if k and not os.environ.get(k):
            os.environ[k] = v

API_KEY = os.environ.get('GOOGLE_GENAI_API_KEY') or os.environ.get('GEMINI_API_KEY')
if not API_KEY:
    print('ERREUR : GOOGLE_GENAI_API_KEY absente de .env.local', file=sys.stderr)
    sys.exit(1)

SRC = Path('docs/ChatGPT/CHATGPT.pdf')
DST = Path('docs/ChatGPT/CHATGPT.extracted.txt')
MODEL = 'gemini-2.5-flash'
CHUNK_PAGES = 20  # Pages par appel — équilibre coût/risque de troncature

PROMPT = """Tu reçois un PDF de captures d'écran d'une conversation ChatGPT.
Extrais TOUT le texte visible, fidèlement et intégralement, dans l'ordre des pages.

Règles :
- Conserve les listes, les retours à la ligne, la mise en forme markdown si tu la reconnais.
- Préserve les **gras**, les *italiques*, les blocs de code, les > citations.
- Sépare clairement les messages USER et les messages ASSISTANT (préfixe-les si pertinent).
- Ignore les éléments d'interface (timestamps, boutons, navigateur).
- N'invente rien, n'ajoute pas de commentaire — uniquement le texte visible.

Si une page est purement décorative (logo, fond blanc), saute-la silencieusement.
"""


def call_gemini_with_pdf_chunk(pdf_bytes: bytes, chunk_index: int, total_chunks: int) -> Optional[str]:
    """Appel Gemini avec un chunk PDF en inline_data."""
    b64 = base64.b64encode(pdf_bytes).decode('ascii')

    body = {
        'contents': [{
            'parts': [
                {'text': PROMPT},
                {'inline_data': {'mime_type': 'application/pdf', 'data': b64}},
            ],
        }],
        'generationConfig': {
            'temperature': 0.0,
            'maxOutputTokens': 32_000,
            'thinkingConfig': {'thinkingBudget': 0},
        },
    }

    url = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}'
    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        print(f'[chunk {chunk_index}/{total_chunks}] HTTP {e.code} : {err_body[:500]}', file=sys.stderr)
        return None
    except Exception as e:
        print(f'[chunk {chunk_index}/{total_chunks}] erreur réseau : {e}', file=sys.stderr)
        return None

    candidates = payload.get('candidates') or []
    if not candidates:
        print(f'[chunk {chunk_index}/{total_chunks}] aucune candidate retournée', file=sys.stderr)
        return None
    parts = (candidates[0].get('content') or {}).get('parts') or []
    text = (parts[0].get('text') if parts else '') or ''
    text = text.strip()
    if not text:
        print(f'[chunk {chunk_index}/{total_chunks}] texte vide', file=sys.stderr)
    return text


def main():
    print(f'Lecture de {SRC}...')
    reader = pypdf.PdfReader(str(SRC))
    total_pages = len(reader.pages)
    print(f'Total pages : {total_pages}')

    chunks_count = (total_pages + CHUNK_PAGES - 1) // CHUNK_PAGES
    print(f'Découpage en {chunks_count} chunks de {CHUNK_PAGES} pages.')

    all_extracts = []

    for chunk_idx in range(chunks_count):
        start = chunk_idx * CHUNK_PAGES
        end = min(start + CHUNK_PAGES, total_pages)
        print(f'\n--- Chunk {chunk_idx + 1}/{chunks_count} : pages {start + 1}-{end} ---')

        # Construire un sous-PDF avec les pages du chunk
        writer = pypdf.PdfWriter()
        for p in range(start, end):
            writer.add_page(reader.pages[p])
        buf = io.BytesIO()
        writer.write(buf)
        sub_pdf = buf.getvalue()
        print(f'Sub-PDF taille : {len(sub_pdf)} bytes')

        # Si trop gros pour inline (>15 MB après base64), on saute (vu que
        # nos chunks de 20 pages devraient faire ~1 MB)
        if len(sub_pdf) > 15_000_000:
            print(f'Trop gros, saute. Réduire CHUNK_PAGES.', file=sys.stderr)
            continue

        text = call_gemini_with_pdf_chunk(sub_pdf, chunk_idx + 1, chunks_count)
        if text:
            all_extracts.append(f'\n\n=== Pages {start + 1}-{end} ===\n\n{text}')
            print(f'OK : {len(text)} chars extraits')
        else:
            print(f'ÉCHEC chunk {chunk_idx + 1}', file=sys.stderr)

        # Throttle léger pour ne pas hammer l'API
        if chunk_idx + 1 < chunks_count:
            time.sleep(1.5)

    # Écriture finale
    DST.parent.mkdir(parents=True, exist_ok=True)
    content = ''.join(all_extracts)
    DST.write_text(content, encoding='utf-8')
    print(f'\n✓ Écrit : {DST}')
    print(f'  Total : {len(content)} chars, {len(all_extracts)}/{chunks_count} chunks réussis')


if __name__ == '__main__':
    main()
