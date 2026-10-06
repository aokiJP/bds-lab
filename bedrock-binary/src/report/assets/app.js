const q = document.getElementById('q');
const results = document.getElementById('results');
const page = document.querySelector('.page');
const base = document.body.dataset.base || '';
let records = null;
let sel = -1;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function load() {
  if (!records) records = await (await fetch(base + 'index.json')).json();
  return records;
}

function rank(name, needle) {
  const n = name.toLowerCase();
  if (n === needle) return 0;
  if (n.startsWith(needle)) return 1;
  return n.includes(needle) ? 2 : 3;
}

async function run() {
  const term = q.value.trim();
  if (!term) {
    results.innerHTML = '';
    if (page) page.hidden = false;
    return;
  }
  if (page) page.hidden = true;
  const all = await load();
  const needle = term.toLowerCase();
  const hits = all
    .filter((r) => r.n.toLowerCase().includes(needle) || (r.e || '').toLowerCase().includes(needle))
    .sort((a, b) => rank(a.n, needle) - rank(b.n, needle) || a.n.length - b.n.length)
    .slice(0, 150);

  results.innerHTML =
    `<p class="meta">${hits.length} 件${hits.length === 150 ? '以上' : ''}${hits.length ? ' — ↑↓ と Enter で移動' : ''}</p>` +
    hits
      .map(
        (r) =>
          `<a class="hit" href="${base}${r.r}">` +
          `<span class="tag${r.v ? ' ok' : ''}">${esc(r.k)}</span>` +
          `<span class="n">${esc(r.n)}</span>` +
          `<span class="d">${esc(r.e || '')}${r.i !== undefined ? `  #${r.i}` : ''}</span></a>`,
      )
      .join('');
  sel = -1;
}

function move(d) {
  const items = [...results.querySelectorAll('.hit')];
  if (!items.length) return;
  if (sel >= 0) items[sel].classList.remove('sel');
  sel = (sel + d + items.length) % items.length;
  items[sel].classList.add('sel');
  items[sel].scrollIntoView({ block: 'nearest' });
}

let t;
q.addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(run, 80);
});

document.addEventListener('keydown', (e) => {
  if (results.children.length) {
    if (e.key === 'ArrowDown') return e.preventDefault(), move(1);
    if (e.key === 'ArrowUp') return e.preventDefault(), move(-1);
    if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      results.querySelectorAll('.hit')[sel].click();
      return;
    }
  }
  if (e.key === '/' && document.activeElement !== q) {
    e.preventDefault();
    q.focus();
    q.select();
  }
  if (e.key === 'Escape' && document.activeElement === q) {
    q.value = '';
    run();
    q.blur();
  }
});

const initial = new URLSearchParams(location.search).get('q');
if (initial) {
  q.value = initial;
  run();
}
