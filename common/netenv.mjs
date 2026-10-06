// Any sandbox, any AI: make Node's own downloads (fetch) follow the environment like curl/pip/npm already do.
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1, and trusts extra CAs only via NODE_EXTRA_CA_CERTS; both are read
// at startup, so when they are missing but the environment has a proxy / a CA bundle, run this same command again with them set.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const env = process.env;
// children (npm, the lab's own node runs) inherit the proxy setting: keep them quiet about it too
if (!/UNDICI-EHPA/.test(env.NODE_OPTIONS ?? '')) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --disable-warning=UNDICI-EHPA`.trim();
if (!env.LAB_NETENV_DONE) {
  const add = {};
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (proxy && !env.NODE_USE_ENV_PROXY) add.NODE_USE_ENV_PROXY = '1';
  // a CA named in the environment, else the system store (Node trusts only its own list; a TLS-inspecting proxy's CA lives in
  // the system store, which curl/pip already use): without this, downloads fail with SELF_SIGNED_CERT_IN_CHAIN
  const ca = [env.SSL_CERT_FILE, env.REQUESTS_CA_BUNDLE, env.CURL_CA_BUNDLE, env.PIP_CERT, ...(process.platform !== 'win32'
    ? ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem', '/etc/ssl/cert.pem'] : [])].find((f) => f && fs.existsSync(f));
  if (ca && !env.NODE_EXTRA_CA_CERTS) add.NODE_EXTRA_CA_CERTS = ca;
  if (ca && !env.PIP_CERT) add.PIP_CERT = ca;   // pip (Endstone) uses its own certifi list otherwise
  // Windows keeps its CAs in the certificate store, not a file: Node 22.15+ can read it (--use-system-ca)
  const sysca = process.platform === 'win32' && process.allowedNodeEnvironmentFlags.has('--use-system-ca') && !process.execArgv.includes('--use-system-ca') ? ['--use-system-ca'] : [];
  if (sysca.length) add.LAB_SYSCA = '1';
  if (Object.keys(add).length && env.LAB_NETENV !== 'off') {
    const r = spawnSync(process.execPath, [...sysca, '--disable-warning=UNDICI-EHPA', '--disable-warning=ExperimentalWarning', ...process.execArgv, ...process.argv.slice(1)],
      { stdio: 'inherit', env: { ...env, ...add, LAB_NETENV_DONE: '1' } });
    process.exit(r.status ?? 1);
  }
}
