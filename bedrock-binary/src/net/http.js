// リトライとタイムアウト付きの fetch。
// GitHub Actions の実行中に minecraft.net が 503 を返すのは珍しくないので、
// 一度失敗しただけでワークフロー全体を落とさないようにする。
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 4xx は再試行しても無駄なので即座に諦める。5xx とネットワークエラーだけ粘る。 */
export async function fetchWithRetry(url, { retries = 4, timeoutMs = 120_000, headers = {}, label = url } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: ctrl.signal,
      });
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) {
        throw new HttpError(`${label}: HTTP ${res.status}`, res.status, false);
      }
      lastError = new HttpError(`${label}: HTTP ${res.status}`, res.status, true);
    } catch (e) {
      if (e instanceof HttpError && !e.retryable) throw e;
      lastError = e.name === 'AbortError' ? new Error(`${label}: ${timeoutMs}ms でタイムアウト`) : e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      const wait = Math.min(2 ** attempt * 1000, 30_000);
      console.warn(`  ${lastError.message} — ${wait / 1000}s 後に再試行 (${attempt}/${retries - 1})`);
      await sleep(wait);
    }
  }
  throw lastError;
}

export class HttpError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

export async function fetchBuffer(url, opts) {
  const res = await fetchWithRetry(url, opts);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchJson(url, opts) {
  const res = await fetchWithRetry(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${opts?.label ?? url}: JSON として読めません（先頭: ${text.slice(0, 120)}）`);
  }
}
