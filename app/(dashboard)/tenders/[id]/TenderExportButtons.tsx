'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Code, FileDown, Check } from 'lucide-react'

interface TenderExportButtonsProps {
  markdown: string
  tenderTitle: string
}

export function TenderExportButtons({ markdown, tenderTitle }: TenderExportButtonsProps) {
  const [copiedMd, setCopiedMd] = useState(false)
  const [copiedHtml, setCopiedHtml] = useState(false)
  const [exportingWord, setExportingWord] = useState(false)

  async function handleCopyMarkdown() {
    await navigator.clipboard.writeText(markdown)
    setCopiedMd(true)
    setTimeout(() => setCopiedMd(false), 2000)
  }

  async function handleCopyHtml() {
    const { marked } = await import('marked')
    const html = await marked.parse(markdown)
    const enriched = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>${tenderTitle} — Mémoire technique</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  h1, h2, h3 { margin-top: 2rem; }
  code { background: #f1f5f9; padding: .2em .4em; border-radius: 4px; }
  pre { background: #f1f5f9; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  blockquote { border-left: 4px solid #e2e8f0; margin: 0; padding-left: 1rem; color: #64748b; }
</style>
</head>
<body>
${html}
</body>
</html>`
    await navigator.clipboard.writeText(enriched)
    setCopiedHtml(true)
    setTimeout(() => setCopiedHtml(false), 2000)
  }

  async function handleExportWord() {
    setExportingWord(true)
    try {
      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')

      // Parse markdown into lines and build paragraphs
      const lines = markdown.split('\n')
      const paragraphs = lines.map((line) => {
        if (line.startsWith('# ')) {
          return new Paragraph({
            text: line.replace(/^# /, ''),
            heading: HeadingLevel.HEADING_1,
          })
        }
        if (line.startsWith('## ')) {
          return new Paragraph({
            text: line.replace(/^## /, ''),
            heading: HeadingLevel.HEADING_2,
          })
        }
        if (line.startsWith('### ')) {
          return new Paragraph({
            text: line.replace(/^### /, ''),
            heading: HeadingLevel.HEADING_3,
          })
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return new Paragraph({
            text: line.replace(/^[-*] /, ''),
            bullet: { level: 0 },
          })
        }
        return new Paragraph({
          children: [
            new TextRun({
              text: line,
            }),
          ],
        })
      })

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${tenderTitle.replace(/[^a-z0-9]/gi, '_')}_memoire_technique.docx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingWord(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={handleCopyMarkdown}>
        {copiedMd ? (
          <Check className="h-3.5 w-3.5 mr-1.5" />
        ) : (
          <Copy className="h-3.5 w-3.5 mr-1.5" />
        )}
        {copiedMd ? 'Copié !' : 'Copier Markdown'}
      </Button>

      <Button variant="outline" size="sm" onClick={handleCopyHtml}>
        {copiedHtml ? (
          <Check className="h-3.5 w-3.5 mr-1.5" />
        ) : (
          <Code className="h-3.5 w-3.5 mr-1.5" />
        )}
        {copiedHtml ? 'Copié !' : 'Copier HTML enrichi'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleExportWord}
        disabled={exportingWord}
      >
        <FileDown className="h-3.5 w-3.5 mr-1.5" />
        {exportingWord ? 'Export…' : 'Exporter Word (.docx)'}
      </Button>
    </div>
  )
}
