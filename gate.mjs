// Local gate check for the token-radar entry: mirrors the seven rows of the
// sealed scorer (RULES.txt, "The gate") against a built out/ directory.
// Usage: node gate.mjs [out-dir] [snapshot.json]
// Exit 0 when all seven rows pass, 1 otherwise.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapFile = process.argv[3] ?? '../token-radar-01-kit/input/snapshot.json';
const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
const slugs = new Set(snap.protocols.map((p) => p.slug));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. dashboard_files
{
  const dir = join(out, 'dashboard');
  let ok = true;
  let detail = '';
  try {
    const names = readdirSync(dir);
    const hasHtml = names.includes('index.html');
    const hasCss = names.some((n) => n.endsWith('.css'));
    const hasJs = names.some((n) => n.endsWith('.js'));
    let total = 0;
    for (const n of names) total += statSync(join(dir, n)).size;
    const urlRe = /(?:href|src|action)\s*=\s*["'][^"']*https?:\/\//i;
    let bad = '';
    for (const n of names) {
      const text = readFileSync(join(dir, n), 'utf8');
      if (/(?:https?:\/\/)/.test(text) && (n.endsWith('.css') || n.endsWith('.js'))) bad = n;
      if (n.endsWith('.html') && urlRe.test(text)) bad = n;
      if (n.endsWith('.js') && /(?:from\s+['"]|import\s*\(\s*['"]|require\s*\(\s*['"])https?:\/\//.test(text)) bad = n;
    }
    ok = hasHtml && hasCss && hasJs && names.length <= 400 && total <= 4 * 1024 * 1024 && bad === '';
    detail = `${names.length} files, ${total} bytes, html=${hasHtml} css=${hasCss} js=${hasJs}${bad ? `, url in ${bad}` : ''}`;
  } catch (e) {
    ok = false;
    detail = String(e);
  }
  check('dashboard_files', ok, detail);
}

// 2. board_file
let board;
{
  let ok = true;
  let detail = '';
  try {
    const raw = readFileSync(join(out, 'board.json'), 'utf8');
    const parsed = JSON.parse(raw);
    board = Array.isArray(parsed) ? parsed : parsed.rows;
    const bad = board.filter(
      (r) =>
        !slugs.has(r.slug) ||
        typeof r.name !== 'string' ||
        r.name.length === 0 ||
        !Number.isSafeInteger(r.rank) ||
        r.rank <= 0 ||
        !Number.isSafeInteger(r.implied_value_usd) ||
        r.implied_value_usd <= 0 ||
        r.implied_value_usd > 100_000_000_000_000 ||
        !Array.isArray(r.farm_steps),
    );
    const allSame = board.length >= 2 && board.every((r) => r.implied_value_usd === board[0].implied_value_usd);
    ok = board.length >= 100 && board.length <= 4000 && raw.length <= 8 * 1024 * 1024 && bad.length === 0 && !allSame;
    detail = `${board.length} rows, ${raw.length} bytes, bad rows: ${bad.length}${allSame ? ', all implied values equal' : ''}`;
  } catch (e) {
    ok = false;
    detail = String(e);
  }
  check('board_file', ok, detail);
}

// 3. sorted_by_value
{
  let ok = false;
  let detail = '';
  if (board) {
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    const ranksOk = ranks.every((r, i) => r === i + 1);
    const byRank = [...board].sort((a, b) => a.rank - b.rank);
    const orderOk = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
    ok = ranksOk && orderOk;
    detail = `ranks 1..${board.length}: ${ranksOk}, non-increasing implied: ${orderOk}`;
  }
  check('sorted_by_value', ok, detail);
}

// 4. coverage
{
  const have = new Set((board ?? []).map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !have.has(s));
  check('coverage', missing.length === 0, `${snap.watchlist.length - missing.length}/${snap.watchlist.length} watchlist slugs covered${missing.length ? `, missing: ${missing.slice(0, 5).join(', ')}` : ''}`);
}

// 5. farm_steps
{
  let bad = 0;
  let why = '';
  for (const r of board ?? []) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      bad++;
      why = `${r.slug}: ${r.farm_steps.length} steps`;
      break;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) {
        bad++;
        why = `${r.slug}: step of ${t.length} chars`;
        break;
      }
    }
    if (bad) break;
  }
  check('farm_steps', bad === 0, `${(board ?? []).reduce((n, r) => n + r.farm_steps.length, 0)} steps checked${why ? `, ${why}` : ''}`);
}

// 6. screenshots
{
  let ok = true;
  let detail = '';
  try {
    const dir = join(out, 'screenshots');
    const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
    const infos = names.map((n) => {
      const buf = readFileSync(join(dir, n));
      const png = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50;
      const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
      let w = 0;
      let h = 0;
      if (png) {
        w = buf.readUInt32BE(16);
        h = buf.readUInt32BE(20);
      } else if (jpg) {
        let i = 2;
        while (i < buf.length - 1) {
          if (buf[i] !== 0xff) { i++; continue; }
          const m = buf[i + 1];
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            h = buf.readUInt16BE(i + 5);
            w = buf.readUInt16BE(i + 7);
            break;
          }
          i += 2 + buf.readUInt16BE(i + 2);
        }
      }
      return { n, bytes: buf.length, w, h, kind: png ? 'png' : jpg ? 'jpg' : '?' };
    });
    const badDim = infos.filter((x) => x.kind === '?' || x.bytes > 524288 || Math.max(x.w, x.h) > 1440 || Math.min(x.w, x.h) < 800);
    ok = names.length >= 3 && names.length <= 4 && badDim.length === 0;
    detail = infos.map((x) => `${x.n} ${x.w}x${x.h} ${(x.bytes / 1024).toFixed(0)}KB`).join(', ');
  } catch (e) {
    ok = false;
    detail = String(e);
  }
  check('screenshots', ok, detail);
}

// 7. dossier_matches
{
  let ok = false;
  let detail = '';
  try {
    const built = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
    const onDisk = readFileSync(join(out, 'dossier.json'));
    ok = Buffer.compare(Buffer.from(built), onDisk) === 0 && onDisk.length <= 1.5 * 1024 * 1024;
    detail = `dossier ${onDisk.length} bytes, byte-identical to rebuild: ${ok}`;
  } catch (e) {
    detail = String(e);
  }
  check('dossier_matches', ok, detail);
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? 'GATE: 7/7 pass' : `GATE: ${7 - failed}/7 pass, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
