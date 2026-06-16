// Régénère les icônes PWA à partir du logo M sur FOND BLANC (public/logo.png).
// Remplace les anciennes icônes à fond navy. Fond blanc, M détouré + recentré.
import sharp from 'sharp'

const SRC = 'public/logo.png'
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

// Détoure les marges blanches une seule fois pour obtenir le M serré.
const mBuf = await sharp(SRC).trim({ threshold: 10 }).toBuffer()
const m = await sharp(mBuf).metadata()
console.log('M détouré :', m.width + 'x' + m.height)

async function makeIcon(out, size, ratio) {
  const content = Math.round(size * ratio)
  const fitted = await sharp(mBuf)
    .resize(content, content, { fit: 'contain', background: WHITE })
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png()
    .toFile(out)
  console.log('✓', out, `${size}x${size} (M ${Math.round(ratio * 100)}%)`)
}

// "any" : M large (72%). "maskable" : M dans la zone de sécurité (58%).
await makeIcon('public/icons/icon-192.png', 192, 0.72)
await makeIcon('public/icons/icon-512.png', 512, 0.72)
await makeIcon('public/icons/apple-touch-icon.png', 180, 0.72)
await makeIcon('public/icons/icon-512-maskable.png', 512, 0.58)
