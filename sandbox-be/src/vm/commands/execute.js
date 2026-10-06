// /execute

function runExecute(a, src0, toks) {
  let ctxs = [{ ...src0, pos: { ...src0.pos } }];
  let i = 0;
  while (i < a.length) {
    const sub = a[i++];
    switch (sub) {
      case 'as': {
        const tok = a[i++];
        ctxs = ctxs.flatMap((c) => select(tok, c).map((e) => ({ ...c, entity: e })));
        break;
      }
      case 'at': {
        const tok = a[i++];
        ctxs = ctxs.flatMap((c) => select(tok, c).map((e) => ({ ...c, dim: e.dim, pos: { ...e.loc } })));
        break;
      }
      case 'positioned': {
        if (a[i] === 'as') {
          i++;
          const tok = a[i++];
          ctxs = ctxs.flatMap((c) => select(tok, c).map((e) => ({ ...c, pos: { ...e.loc } })));
        } else {
          const args = a.slice(i, i + 3);
          i += 3;
          ctxs = ctxs.map((c) => ({ ...c, pos: pos3(args, 0, c.pos, false) }));
        }
        break;
      }
      case 'in': {
        const d = dimId(a[i++]);
        if (!d) throw new Syntax('次元が不明です');
        ctxs = ctxs.map((c) => ({ ...c, dim: d }));
        break;
      }
      case 'align': case 'anchored': case 'facing': case 'rotated':
        throw new NotImpl(`execute ${sub}`);
      case 'if': case 'unless': {
        const neg = sub === 'unless';
        const kind = a[i++];
        if (kind === 'entity') {
          const tok = a[i++];
          ctxs = ctxs.filter((c) => (select(tok, c).length > 0) !== neg);
        } else if (kind === 'block') {
          const args = a.slice(i, i + 3);
          i += 3;
          const spec = blockSpec(a[i], a[i + 1]);
          const exact = String(a[i]).includes('[');
          i += spec.used;
          ctxs = ctxs.filter((c) => {
            const p = pos3(args, 0, c.pos, true);
            assertBox(c.dim, p, p);
            const cur = readBlock(c.dim, p.x, p.y, p.z);
            const ok = cur.id === spec.perm.id && (!exact || samePerm(cur, spec.perm));
            return ok !== neg;
          });
        } else if (kind === 'score') {
          const who = a[i++];
          const obj = objectives.get(a[i++]);
          const opr = a[i++];
          ctxs = ctxs.filter((c) => {
            if (!obj) return neg;
            const idOf = (tok) => {
              if (/^@/.test(tok)) { const e = select(tok, c)[0]; return e ? [...identities.values()].find((x) => x.entityId === e.id) : null; }
              return [...identities.values()].find((x) => x.name === tok);
            };
            const ia = idOf(who);
            const va = ia ? obj.scores.get(ia.id) : undefined;
            let ok;
            if (opr === 'matches') {
              const m = /^(-?\d*)(\.\.)?(-?\d*)$/.exec(a[i]);
              const lo = m[1] === '' ? -Infinity : Number(m[1]);
              const hi = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : lo;
              ok = va !== undefined && va >= lo && va <= hi;
            } else {
              const ib = idOf(a[i]);
              const obj2 = objectives.get(a[i + 1]);
              const vb = ib && obj2 ? obj2.scores.get(ib.id) : undefined;
              ok = va !== undefined && vb !== undefined && { '<': va < vb, '<=': va <= vb, '=': va === vb, '>=': va >= vb, '>': va > vb }[opr];
            }
            return Boolean(ok) !== neg;
          });
          i += opr === 'matches' ? 1 : 2;
        } else if (kind === 'blocks') {
          throw new NotImpl('execute if blocks');
        } else {
          throw new Syntax(`execute ${sub} ${kind} は不明です`);
        }
        break;
      }
      case 'run': {
        const rest = toks.slice(i);
        let n = 0;
        let lastErr = null;
        for (const c of ctxs) {
          const r = runTokens(rest, c);
          if (r.notImplemented) throw new NotImpl(r.notImplemented);
          if (r.syntax) throw new Syntax(r.detail ?? r.message, rest[0]?.v);
          n += r.successCount ?? 0;
          if (r.failed) lastErr = r.failed;
        }
        if (!n) throw new Failed(lastErr ?? 'Execute subcommand failed');
        return { successCount: n };
      }
      default:
        throw new Syntax(`execute ${sub} は不明です`);
    }
  }
  // run が無い場合は条件の成否だけ
  if (!ctxs.length) throw new Failed('Test failed');
  return { successCount: ctxs.length };
}
