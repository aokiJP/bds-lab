// signin: the game's Microsoft sign-in, driven on the device — what it takes to join a friend's world (and a server by
// its address: "You need to authenticate to Microsoft services" otherwise). 1.26 opens the Xbox library's own WebView
// (com.microsoft.xal.browser.WebKitWebViewController): an ordinary Android view, where taps and typing work (the game's
// own screens take only a controller). The pages are told apart by their words (OCR); this file is pure.
//
// The account's values come from secrets (MS_EMAIL, MS_PASSWORD) and are typed through stdin, never a command line, and
// masked in every log and reply. Without MS_PASSWORD (or with two-step verification) the page that asks is said on the
// live issue: the number to approve in the Authenticator app, or a code that arrived by e-mail to send back as
// `lab@<run> code 123456`.

const text = (words) => words.map((w) => w.text).join(' ').replace(/\s+/g, ' ');

/** the sign-in page on the screen now (pure) → { kind, … }:
 *  title (the game's menu with its Sign In) | start ("Let's get you signed in": SIGN IN) | email | password | approve
 *  ({ number }) | code | stay ("Stay signed in?") | profile (a new account's Xbox profile) | error ({ message }) |
 *  other. web: the Xbox library's WebView is in front */
export function signinPage(words, { web = false } = {}) {
  const all = text(words);
  const m = (re) => re.test(all);
  if (m(/account or password is incorrect|doesn'?t exist|couldn'?t find (a|an) Microsoft account|too many (times|attempts)|has been locked|something went wrong/i)) {
    return { kind: 'error', message: /(Your account or password is incorrect|That Microsoft account doesn'?t exist|couldn'?t find (a|an) Microsoft account[^.]*|too many[^.]*|has been locked[^.]*|Something went wrong[^.]*)/i.exec(all)?.[0] ?? 'error' };
  }
  if (m(/Stay signed in\??/i)) return { kind: 'stay' };
  if (m(/Approve (the |your )?sign[- ]in|Check your Authenticator|Open your Authenticator|enter the number shown/i)) {
    // the number to match in the app (two digits on their own)
    const n = words.find((w) => /^\d{2,3}$/.test(w.text))?.text ?? null;
    return { kind: 'approve', number: n };
  }
  if (m(/Enter (the )?code|We (sent|emailed) (a |your )?code|Verify your (email|identity)|enter the code/i)) return { kind: 'code' };
  if (m(/Enter (your )?password|Forgot (your )?password/i)) return { kind: 'password' };
  if (m(/Email,? (or )?phone|phone number|Sign in to continue|Forgot your username/i)) return { kind: 'email' };
  if (m(/Let'?s get you signed in/i) || (web && m(/\bSIGN IN\b/))) return { kind: 'start' };
  if (m(/Xbox profile|gamertag|Let'?s play|Create your profile/i)) return { kind: 'profile' };
  if (!web && m(/\bSign In\b/) && m(/\bPlay\b/) && m(/\bSettings\b/)) return { kind: 'title' };
  return { kind: 'other' };
}

/** the buttons the driver presses, by their words (pure): the first of the given patterns found → findText-like hit */
export const SIGNIN_BUTTONS = {
  start: /^SIGN IN$/i,
  email: /^Next$/i,
  password: /^Sign in$/i,
  stay: /^Yes$/i,
  profile: /^(Let'?s play|Next|Continue|Get started)$/i,
  otherWays: /^(Other ways to sign in|Sign in another way|Use your password instead)$/i,
};

/** what the device's screen says about being signed in, on the game's menu (pure): signed out while its Sign In button is
 *  there */
export const signedOut = (words) => /\bSign In\b/.test(text(words));

/** the secret values a reply or a log must never show (pure): the e-mail, its local part, the password */
export function secretsOf(env = process.env) {
  const out = [];
  if (env.MS_EMAIL) { out.push(env.MS_EMAIL); const local = env.MS_EMAIL.split('@')[0]; if (local && local.length >= 4) out.push(local); }
  if (env.MS_PASSWORD) out.push(env.MS_PASSWORD);
  return out;
}
