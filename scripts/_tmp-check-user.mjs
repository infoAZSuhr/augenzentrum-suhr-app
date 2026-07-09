import admin from 'firebase-admin'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
const adcPath = path.join(os.homedir(), '.config', 'azs-backup-adc.json')
if (existsSync(adcPath)) process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'azsdb-999d6' })
const db = admin.firestore()
const snap = await db.collection('users').get()
for (const d of snap.docs) {
  const u = d.data()
  console.log(d.id, '|', u.username, '|', u.usernameLower, '|', u.email, '|', u.authEmail, '|', u.status, '|', u.locked ? `LOCKED(${u.lockedReason})` : '')
}
console.log('--- total:', snap.size)
process.exit(0)
