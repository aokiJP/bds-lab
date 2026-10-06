// a Python traceback (Endstone) arrives as one E line per line, and the cut at 10 lines often left out what was raised: one E
// line instead: what Endstone was doing (the line before, ending in ':'), what was raised, and where in the unit's own code
// (the innermost frame outside Python and Endstone: its file:line and that line)
export function compactPyTracebacks(o, relf = (f) => f) {
  const lib = /site-packages|dist-packages|<frozen |[\\/]lib[\\/]python3\.\d+[\\/]|^<string>$/;
  for (let i = 0; i < o.length; i++) {
    if (!/^E (?:\S+: )?Traceback \(most recent call last\):\s*$/.test(o[i])) continue;
    const frames = []; let j = i + 1, exc = null;
    for (; j < o.length && /^E /.test(o[j]); j++) {
      const t = o[j].slice(2).trim(), fm = /^File "([^"]+)", line (\d+), in (.+)$/.exec(t);
      if (fm) { frames.push({ file: fm[1], line: Number(fm[2]), code: null }); continue; }
      if (/^[~^\s]+$/.test(t)) continue;
      if (/^(During handling of the above exception|The above exception was the direct cause)/.test(t) || /^Traceback \(most recent call last\):/.test(t)) continue;
      if (frames.length && frames.at(-1).code === null) { frames.at(-1).code = t; continue; }
      exc = t; j++;
      if (!(j < o.length && /^E (Traceback|During handling|The above exception)/.test(o[j]))) break;
      j--;
    }
    if (!exc) continue;
    const own = [...frames].reverse().find((f) => !lib.test(f.file));
    const from = i > 0 && /^E .*:\s*$/.test(o[i - 1]) && !/^E (?:\S+: )?Traceback/.test(o[i - 1]) ? i - 1 : i;
    const ctx = from < i ? o[from].slice(2).trim().replace(/:\s*$/, '') + ': ' : '';
    o.splice(from, j - from, `E ${ctx}${exc}${own ? ` (${relf(own.file)}:${own.line}${own.code ? ': ' + own.code.slice(0, 120) : ''})` : ''}`);
    i = from;
  }
}
