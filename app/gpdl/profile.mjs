// node app/gpdl/profile.mjs <rs-google-play's gpapi/device.properties> <out>: writes the bdslab_x86_64 device profile
// (app/lib/apk.mjs x86DeviceProfile) for `gpdl --device-file`. build.sh runs it; the file stays in app/.lab/tools.
import fs from 'node:fs';
import { x86DeviceProfile } from '../lib/apk.mjs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('node app/gpdl/profile.mjs <device.properties> <out>'); process.exit(2); }
const p = x86DeviceProfile(fs.readFileSync(src, 'utf8'));
if (!p) { console.error(`${src} に x86_64 の [google_kiwi_x86_64] がありません（x86_64 版は取れません。arm64 版だけになります）`); process.exit(1); }
fs.writeFileSync(dst, p);
console.log(dst);
