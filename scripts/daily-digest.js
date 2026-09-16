/* ============================================================
   오늘의 우리 — 매일 아침 텔레그램 알림
   ------------------------------------------------------------
   루틴(매일 반복되는 일과)은 빼고, 그날 '진짜 할 일'만 골라 보냄.
   Firebase 에서 바로 읽으므로 앱에서 고치면 다음날 바로 반영됨.

   필요한 값 (GitHub Secrets 에 넣어둠):
     TELEGRAM_BOT_TOKEN  봇아저씨(@BotFather)가 준 토큰
     TELEGRAM_CHAT_ID    받을 사람/방 번호 (쉼표로 여러 명 가능)

   토큰이 없으면 '보내지 않고 화면에 미리보기'만 함 (연습용).
   ============================================================ */

const DB = 'https://yunha-faily-default-rtdb.asia-southeast1.firebasedatabase.app';
const FAMILY_CODE = 'yunha-family-0630';
const TZ = 'Asia/Seoul';
const NAME = { dad: '아빠', mom: '엄마', child: '윤하', all: '전체' };
const ICON = { dad: '👨', mom: '👩', child: '👶', all: '👪' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];

// 일정이 없는 날에도 "오늘은 없어요" 를 보낼지 (false 면 그런 날은 조용히 넘어감)
const SEND_WHEN_EMPTY = true;

// ── 날짜 도우미 (한국 시간 기준) ─────────────────────────
function seoulToday(offsetDays) {
  const now = new Date(Date.now() + (offsetDays || 0) * 86400000);
  const s = now.toLocaleDateString('en-CA', { timeZone: TZ });   // YYYY-MM-DD
  const dow = new Date(s + 'T12:00:00Z').getUTCDay();
  return { ymd: s, dow };
}

// ── 그 일정이 오늘 화면에 뜨는지 (앱의 appliesOn 과 같은 규칙) ──
function appliesOn(e, ds, dow) {
  if (!e) return false;
  if ((e.excl || []).indexOf(ds) >= 0) return false;
  switch (e.scope) {
    case 'day': return e.date === ds;
    case 'dates': return (e.dates || []).indexOf(ds) >= 0;
    case 'weekFrom': return ds >= e.date && ds <= e.weekEnd;
    case 'month': return String(ds).slice(0, 7) === e.ym;
    case 'year': return String(ds).slice(0, 4) === String(e.y);
    case 'weekdays':
      if (e.from && ds < e.from) return false;
      if (e.until && ds > e.until) return false;
      return (e.days || []).indexOf(dow) >= 0;
    case 'nthwd': {
      const d = new Date(ds + 'T12:00:00Z');
      if (d.getUTCDay() !== e.day) return false;
      return Math.floor((d.getUTCDate() - 1) / 7) + 1 === e.nth;
    }
    case 'everyn': {
      if (!e.from) return false;
      const a = Date.parse(e.from + 'T00:00:00Z'), b = Date.parse(ds + 'T00:00:00Z');
      if (b < a) return false;
      if (e.until && ds > e.until) return false;
      return Math.round((b - a) / 86400000) % (e.n || 2) === 0;
    }
    default: return false;
  }
}

const isRoutine = e => e && e.bulk === true && e.routine === true;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toMin = t => { const p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); };

// ── 메시지 만들기 ─────────────────────────────────────────
function buildMessage(data, day) {
  const ex = (data.exceptions || []).filter(Boolean);
  const base = (data.base || []).filter(Boolean);

  // 루틴이 아닌 것 = 직접 넣은 할 일
  const todays = base.concat(ex)
    .filter(e => !isRoutine(e))
    .filter(e => (e.scope ? appliesOn(e, day.ymd, day.dow) : true))
    .filter(e => e.title);

  const timed = todays.filter(e => !e.todo && e.start && e.end);
  const notes = todays.filter(e => e.todo);

  const d = new Date(day.ymd + 'T12:00:00Z');
  const head = `<b>📌 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[day.dow]}) 주요 일정</b>`;

  const lines = [];
  ['dad', 'mom', 'child', 'all'].forEach(w => {
    const rows = timed.filter(e => e.who === w).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (!rows.length) return;
    lines.push('');
    lines.push(`${ICON[w] || '•'} <b>${NAME[w] || w}</b>`);
    rows.forEach(r => lines.push(`   ${r.start}–${r.end}  ${esc(r.title)}`));
  });

  if (notes.length) {
    lines.push('');
    lines.push('📝 <b>오늘 메모</b>');
    notes.forEach(n => lines.push(`   · ${esc(n.title)}`));
  }

  // 날짜 없는 할 일(메모함)에 남은 것
  const open = (data.memos || []).filter(m => m && !m.done);
  if (open.length) {
    lines.push('');
    lines.push(`🗒 <b>메모함</b> (${open.length}개 남음)`);
    open.slice(0, 5).forEach(m => lines.push(`   · ${esc(m.title)}`));
    if (open.length > 5) lines.push(`   … 외 ${open.length - 5}개`);
  }

  const empty = !timed.length && !notes.length;
  if (empty) lines.push('', '오늘은 따로 잡힌 일정이 없어요. 루틴대로 하루 보내세요 🙂');

  return { text: head + '\n' + lines.join('\n'), empty, count: timed.length + notes.length };
}

// ── 텔레그램 보내기 ───────────────────────────────────────
async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`텔레그램 실패 (HTTP ${res.status}) ${body.description || ''}`);
  return body;
}

// ── 실행 ──────────────────────────────────────────────────
(async function main() {
  const offset = Number(process.env.DAY_OFFSET || 0);   // 테스트용: 1 이면 내일
  const day = seoulToday(offset);

  const res = await fetch(`${DB}/schedules/${FAMILY_CODE}.json`);
  if (!res.ok) throw new Error(`Firebase 읽기 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (!data) throw new Error('Firebase 에 데이터가 없어요');

  const msg = buildMessage(data, day);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = String(process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);

  console.log('─── 보낼 내용 미리보기 ───');
  console.log(msg.text.replace(/<[^>]+>/g, ''));
  console.log('──────────────────────');

  if (!token || !chats.length) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 없어 보내지 않았어요 (미리보기만).');
    return;
  }
  if (msg.empty && !SEND_WHEN_EMPTY) {
    console.log('일정이 없어 건너뜀 (SEND_WHEN_EMPTY = false)');
    return;
  }
  for (const c of chats) {
    await sendTelegram(token, c, msg.text);
    console.log(`✅ 보냄 → ${c}`);
  }
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
