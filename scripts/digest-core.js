/* ============================================================
   오늘의 우리 — 알림 만들기 공통 부품
   ------------------------------------------------------------
   앱의 날짜 규칙을 그대로 옮겨와, '루틴 아닌 일정'만 골라
   오늘 / 이번 주 / 이번 달 메시지를 만든다.
   ============================================================ */

const DB = 'https://yunha-faily-default-rtdb.asia-southeast1.firebasedatabase.app';
const FAMILY_CODE = 'yunha-family-0630';
const TZ = 'Asia/Seoul';
const NAME = { dad: '아빠', mom: '엄마', child: '윤하', all: '전체' };
const ICON = { dad: '👨', mom: '👩', child: '👶', all: '👪' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dayMs = 86400000;

// ── 한국 시간 도우미 ──────────────────────────────────────
const seoulDate = (offsetDays) =>
  new Date(Date.now() + (offsetDays || 0) * dayMs).toLocaleDateString('en-CA', { timeZone: TZ });
const seoulTime = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });   // 'HH:MM'
const dowOf = ds => new Date(ds + 'T12:00:00Z').getUTCDay();
const shift = (ds, n) => new Date(Date.parse(ds + 'T12:00:00Z') + n * dayMs).toISOString().slice(0, 10);
const dnum = ds => +ds.slice(8, 10);
const mnum = ds => +ds.slice(5, 7);

// ── 그 일정이 그날 화면에 뜨는지 (앱의 appliesOn 과 같은 규칙) ──
function appliesOn(e, ds) {
  if (!e) return false;
  if ((e.excl || []).indexOf(ds) >= 0) return false;
  const dow = dowOf(ds);
  switch (e.scope) {
    case 'day': return e.date === ds;
    case 'dates': return (e.dates || []).indexOf(ds) >= 0;
    case 'weekFrom': return ds >= e.date && ds <= e.weekEnd;
    case 'month': return ds.slice(0, 7) === e.ym;
    case 'year': return ds.slice(0, 4) === String(e.y);
    case 'weekdays':
      if (e.from && ds < e.from) return false;
      if (e.until && ds > e.until) return false;
      return (e.days || []).indexOf(dow) >= 0;
    case 'nthwd':
      if (dow !== e.day) return false;
      return Math.floor((dnum(ds) - 1) / 7) + 1 === e.nth;
    case 'everyn': {
      if (!e.from) return false;
      const a = Date.parse(e.from + 'T00:00:00Z'), b = Date.parse(ds + 'T00:00:00Z');
      if (b < a) return false;
      if (e.until && ds > e.until) return false;
      return Math.round((b - a) / dayMs) % (e.n || 2) === 0;
    }
    default: return false;
  }
}

const isRoutine = e => e && e.bulk === true && e.routine === true;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toMin = t => { const p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); };

const itemsOn = (all, ds) => all.filter(e => e.title && !isRoutine(e) && (e.scope ? appliesOn(e, ds) : true));

// 같은 제목·같은 시간이면 사람을 한 줄로 합침 (하온이네 식사 ×3 → 온가족)
function merge(rows) {
  const g = {};
  rows.forEach(r => {
    const k = r.title + '|' + (r.start || '') + '|' + (r.end || '') + '|' + (r.todo ? 'T' : '');
    (g[k] = g[k] || Object.assign({}, r, { who: [] })).who.push(NAME[r.who] || r.who);
  });
  return Object.values(g).sort((a, b) => (a.todo ? -1 : toMin(a.start)) - (b.todo ? -1 : toMin(b.start)));
}
const whoTag = w => (w.length >= 3 ? '온가족' : w.join('·'));

// ── 오늘 ──────────────────────────────────────────────────
function buildDay(all, memos, ds) {
  const rows = itemsOn(all, ds);
  const timed = rows.filter(e => !e.todo && e.start && e.end);
  const notes = rows.filter(e => e.todo);
  const L = [];
  ['dad', 'mom', 'child', 'all'].forEach(w => {
    const mine = timed.filter(e => e.who === w).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!mine.length) return;
    L.push('', `${ICON[w] || '•'} <b>${NAME[w] || w}</b>`);
    mine.forEach(r => L.push(`   ${r.start}–${r.end}  ${esc(r.title)}`));
  });
  if (notes.length) {
    L.push('', '📝 <b>오늘 메모</b>');
    merge(notes).forEach(n => L.push(`   · ${esc(n.title)}  <i>${whoTag(n.who)}</i>`));
  }
  const open = (memos || []).filter(m => m && !m.done);
  if (open.length) {
    L.push('', `🗒 <b>메모함</b> (${open.length}개 남음)`);
    open.slice(0, 5).forEach(m => L.push(`   · ${esc(m.title)}`));
    if (open.length > 5) L.push(`   … 외 ${open.length - 5}개`);
  }
  const empty = !timed.length && !notes.length;
  if (empty) L.push('', '오늘은 따로 잡힌 일정이 없어요. 루틴대로 하루 보내세요 🙂');
  return {
    text: `<b>📌 ${mnum(ds)}월 ${dnum(ds)}일 (${WD[dowOf(ds)]}) 주요 일정</b>\n` + L.join('\n'),
    empty,
  };
}

// ── 기간 (주간·월간 공용) ─────────────────────────────────
function buildRange(all, from, to, head, emptyMsg, today) {
  const L = [];
  let total = 0;
  for (let ds = from; ds <= to; ds = shift(ds, 1)) {
    const rows = merge(itemsOn(all, ds));
    if (!rows.length) continue;
    total += rows.length;
    L.push('', `<b>${mnum(ds)}/${dnum(ds)} (${WD[dowOf(ds)]})</b>` + (ds === today ? ' ← 오늘' : ''));
    rows.forEach(r => L.push(`   ${r.todo ? '📝' : r.start + '–' + r.end}  ${esc(r.title)}  <i>${whoTag(r.who)}</i>`));
  }
  if (!total) L.push('', emptyMsg);
  return { text: head + '\n' + L.join('\n'), empty: !total, total };
}

function buildWeek(all, ds) {
  const mon = shift(ds, -((dowOf(ds) + 6) % 7));
  const sun = shift(mon, 6);
  return buildRange(all, mon, sun,
    `<b>🗓 이번 주 일정</b>  <i>${mnum(mon)}/${dnum(mon)}(월) ~ ${mnum(sun)}/${dnum(sun)}(일)</i>`,
    '이번 주는 따로 잡힌 일정이 없어요.', seoulDate(0));
}
function buildMonth(all, ds) {
  const first = ds.slice(0, 8) + '01';
  const last = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7), 0)).toISOString().slice(0, 10);
  return buildRange(all, first, last,
    `<b>📅 ${mnum(ds)}월 한 달 일정</b>`,
    '이번 달은 따로 잡힌 일정이 없어요.', seoulDate(0));
}

// ── Firebase · 텔레그램 ───────────────────────────────────
async function fetchData() {
  const res = await fetch(`${DB}/schedules/${FAMILY_CODE}.json`);
  if (!res.ok) throw new Error(`Firebase 읽기 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (!data) throw new Error('Firebase 에 데이터가 없어요');
  return {
    all: (data.base || []).filter(Boolean).concat((data.exceptions || []).filter(Boolean)),
    memos: data.memos || [],
  };
}
async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok && j.ok, status: res.status, result: j.result, err: j.description };
}
async function send(token, chatId, text) {
  const r = await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
  if (!r.ok) throw new Error(`텔레그램 실패 (HTTP ${r.status}) ${r.err || ''}`);
}

module.exports = {
  NAME, WD, seoulDate, seoulTime, dowOf, shift, dnum, mnum,
  appliesOn, itemsOn, merge, buildDay, buildWeek, buildMonth,
  fetchData, tg, send,
};
