# Extrait le texte de docs/ChatGPT/CHATGPT.pdf dans un .txt local pour analyse.
# Vincent 2026-05-22.

import pypdf
from pathlib import Path

SRC = Path('docs/ChatGPT/CHATGPT.pdf')
DST = Path('docs/ChatGPT/CHATGPT.extracted.txt')

print(f'Lecture de {SRC}…')
reader = pypdf.PdfReader(str(SRC))
print(f'Pages : {len(reader.pages)}')

out = []
empty_pages = 0
for i, page in enumerate(reader.pages):
    try:
        text = page.extract_text() or ''
    except Exception as e:
        text = f'[ERREUR EXTRACTION p{i+1}: {e}]'
    text = text.strip()
    if not text:
        empty_pages += 1
        continue
    out.append(f'\n\n=== Page {i+1} ===\n')
    out.append(text)

content = ''.join(out)
DST.write_text(content, encoding='utf-8')
print(f'Écrit : {DST} ({len(content)} chars, {empty_pages} pages vides)')
