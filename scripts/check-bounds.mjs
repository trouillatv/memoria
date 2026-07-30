import { readFileSync } from 'fs'
const mu = await import('mupdf')
const buf = readFileSync('docs/Becib/PV/PV 003 - OCEF Compostage - 2026 03 19.pdf')
const doc = mu.Document.openDocument(new Uint8Array(buf), 'application/pdf')
const page = doc.loadPage(3)
const bounds = page.getBounds()
console.log('Page bounds:', bounds)
const area = (b) => (b[2] - b[0]) * (b[3] - b[1])
const pageArea = area(bounds)
console.log('Page area:', pageArea)
const logoBbox = [22, 11, 202, 78]
const photoBbox = [61, 112, 482, 349]
console.log('Logo bbox area:', area(logoBbox), '->', (area(logoBbox)/pageArea*100).toFixed(1)+'%')
console.log('Photo bbox area:', area(photoBbox), '->', (area(photoBbox)/pageArea*100).toFixed(1)+'%')
doc.destroy()
