// secretwatch (the 「秘密」 tab and 「概要」's age watch): how long each secret of the lab has stood since it was last set
// (GitHub gives the date it was set, updated_at — never the value, and no expiry date; so only the age is judged, and a
// token's own expiry is not known here) and, for the old ones, the way to put a new one in (pure: no DOM, no network).
import { SERVICES } from './connect.mjs';

/** days from which a secret is old / stale (a key set 90 days ago is worth a look; 180, worth renewing) */
export const OLD_DAYS = 90;
export const STALE_DAYS = 180;
const DAY = 86_400_000;
// (a GitHub token's page: a fine-grained token is made again there; the only outside address kept here is github.com)
const GH_TOKENS = 'https://github.com/settings/personal-access-tokens';
const GH_NAME = /^(GH_|GITHUB_|PAT$|PAT_|.*_PAT$)/;

/** the way to renew one secret by its name → { say, url? }: GitHub's own token page for a GitHub token; a service in 連携
 *  (lib/connect.mjs SERVICES) is renewed in the 「連携」 tab (that tab shows the official page); a name not known gets no
 *  steps — it is said so rather than guessed */
export function howTo(name) {
  const n = String(name ?? '');
  if (GH_NAME.test(n)) return { say: 'GitHub のトークンの画面で作り直し、秘密に入れ直します。', url: GH_TOKENS };
  const svc = SERVICES.find((s) => s.secrets.includes(n));
  if (svc) return { say: `🔗 連携 の「${svc.name}」で入れ替えます。`, url: null };
  return { say: '入れ替え方は分かりません: 作った場所で新しい値を作り、「秘密」に入れ直してください。', url: null };
}

/** the lab's secrets ([{ name, updated_at }]) → [{ name, days, level: 'ok' | 'old' | 'stale', why, how }], the oldest first.
 *  days is null (level ok, "date unknown") when GitHub gave no readable date. Values are never read (there are none). Pure */
export function ageOf(secrets, { now = Date.now() } = {}) {
  const out = [];
  for (const s of Array.isArray(secrets) ? secrets : []) {
    const name = typeof s === 'string' ? s : s?.name;
    if (typeof name !== 'string' || !name) continue;
    const t = Date.parse(typeof s === 'object' ? s.updated_at : undefined);
    const days = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
    const level = days === null ? 'ok' : days >= STALE_DAYS ? 'stale' : days >= OLD_DAYS ? 'old' : 'ok';
    const why = days === null ? '入れた日が分かりません' : level === 'stale' ? `${days} 日、入れ替えていません（${STALE_DAYS} 日を超えました）` : level === 'old' ? `${days} 日、入れ替えていません（${OLD_DAYS} 日を超えました）` : `${days} 日前に入れました`;
    out.push({ name, days, level, why, how: howTo(name) });
  }
  return out.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || (a.name < b.name ? -1 : 1));
}
