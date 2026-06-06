/**
 * make-icons.mjs — generiert App-Icons aus public/logo.png
 *
 * Input:  public/logo.png  (>=512x512 PNG, quadratisch, transparenter Hintergrund)
 * Output:
 *   - public/logo.png            (Web-App Favicon, bleibt wie gelegt)
 *   - public/icon-192.png        (PWA Android-Icon)
 *   - public/icon-512.png        (PWA Splash-Icon)
 *   - electron/assets/icon.png   (Electron Window-Icon, 512x512)
 *   - electron/assets/icon.ico   (Electron .exe Multi-Resolution ICO)
 *
 * Usage:
 *   npm install --no-save sharp png-to-ico
 *   node scripts/make-icons.mjs
 */
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const SRC       = join(ROOT, 'public', 'logo.png')
const PUBLIC    = join(ROOT, 'public')
const ASSETS    = join(ROOT, 'electron', 'assets')

mkdirSync(PUBLIC, { recursive: true })
mkdirSync(ASSETS, { recursive: true })

console.log('Quelle:', SRC)

// 1. PWA-Größen
await sharp(SRC).resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toFile(join(PUBLIC, 'icon-192.png'))
console.log('✓ public/icon-192.png')

await sharp(SRC).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toFile(join(PUBLIC, 'icon-512.png'))
console.log('✓ public/icon-512.png')

// 2. Electron Window-Icon
await sharp(SRC).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toFile(join(ASSETS, 'icon.png'))
console.log('✓ electron/assets/icon.png')

// 3. Multi-Resolution ICO für Windows .exe
//    Windows nutzt je nach Kontext unterschiedliche Größen (Taskbar=32, Startmenü=48, ...).
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoBuffers = []
for (const size of icoSizes) {
  const buf = await sharp(SRC).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  icoBuffers.push(buf)
}
const icoData = await pngToIco(icoBuffers)
writeFileSync(join(ASSETS, 'icon.ico'), icoData)
console.log(`✓ electron/assets/icon.ico (${icoSizes.length} Größen)`)

console.log('\nFertig. Naechste Schritte:')
console.log('1. git add public/icon-*.png electron/assets/icon.png electron/assets/icon.ico')
console.log('2. git commit -m "feat: neues App-Icon"')
console.log('3. git push origin main')
console.log('   (Web-App ist sofort aktualisiert. Fuer Electron .exe-Update:')
console.log('    Version in package.json hochziehen + neuen v-Tag pushen.)')
