/* ============================================================
   오늘의 우리 — 텔레그램 봇 (명령 처리 + 정해진 시각에 브리핑)
   ------------------------------------------------------------
   15분마다 깨어나서 두 가지를 한다.
     1) 그동안 온 명령어를 처리하고 답장
     2) 보낼 시각이 지났는데 오늘 아직 안 보냈으면 → 오늘 브리핑 발송
        (월요일이면 주간, 매달 1일이면 월간도 함께)

   설정은 config/telegram.json 에 저장되고, 바뀌면 저장소에 커밋된다.
   받는 방 목록도 여기 들어있어서, 텔레그램에서 /등록 만 하면 추가된다.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const C = require('./digest-core');

const CFG = path.resolve(__dirname, '..', 'config', 'telegram.json');
const DEFAULTS = { sendAt: '07:00', recipients: [], lastSent: {}, offset: 0 };

const load = () => {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(CFG, 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }
};
const save = cfg => {
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
};

const HELP = [
  '<b>🤖 오늘의 우리 알림봇</b>',
  '',
  '<b>지금 바로 보기</b>',
  '  /오늘 — 오늘 주요 일정',
  '  /주간 — 이번 주 한눈에',
  '  /월간 — 이번 달 한눈에',
  '',
  '<b>설정</b>',
  '  /시간 8:00 — 매일 받을 시각 바꾸기',
  '  /설정 — 지금 설정 보기',
  '  /등록 — 이 방에서도 받기',
  '  /해제 — 이 방은 그만 받기',
  '',
  '<i>매일 정한 시각에 그날 일정이 옵니다.',
  '월요일엔 주간, 매달 1일엔 월간도 함께 옵니다.</i>',
].join('\n');

// '8:00' '0800' '8시' '08:00' → '08:00'
function parseTime(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/시/g, ':').replace(/분/g, '');
  let m = t.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/) || t.match(/^(\d{1,2})\s*[:：]?\s*$/) || t.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = m[2] === undefined || m[2] === '' ? 0 : +m[2];
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

(async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.log('TELEGRAM_BOT_TOKEN 이 없어요. 아무것도 하지 않습니다.'); return; }

  const cfg = load();
  const before = JSON.stringify(cfg);

  // 처음 한 번은 Secrets 의 방 번호로 씨앗을 심는다
  if (!cfg.recipients.length) {
    cfg.recipients = String(process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  // 주인 = 개인 대화로 등록된 사람 (그 사람은 그룹에서도 명령할 수 있음)
  const owners = cfg.recipients.filter(id => !String(id).startsWith('-'));
  const allowed = msg => {
    if (!cfg.recipients.length) return true;                               // 아직 아무도 없으면 개방
    if (cfg.recipients.indexOf(String(msg.chat.id)) >= 0) return true;      // 이미 받는 방
    if (msg.from && owners.indexOf(String(msg.from.id)) >= 0) return true;  // 주인이 보낸 것
    return false;
  };

  const data = await C.fetchData();
  const today = C.seoulDate(0);

  // ── 1) 그동안 온 명령 처리 ──────────────────────────────
  const up = await C.tg(token, `getUpdates?offset=${cfg.offset || 0}&timeout=0&limit=50`);
  const updates = (up.ok && up.result) || [];
  for (const u of updates) {
    cfg.offset = u.update_id + 1;
    const msg = u.message || u.edited_message;
    if (!msg || !msg.text) continue;
    const chatId = String(msg.chat.id);
    const raw = msg.text.trim();
    if (raw[0] !== '/') continue;
    const [cmdRaw, ...rest] = raw.split(/\s+/);
    const cmd = cmdRaw.split('@')[0].toLowerCase();   // /오늘@봇이름 도 받아줌
    const arg = rest.join(' ');

    if (!allowed(msg)) { await C.send(token, chatId, '이 봇은 가족 전용이에요 🙂'); continue; }

    try {
      if (cmd === '/start' || cmd === '/help' || cmd === '/도움말') {
        await C.send(token, chatId, HELP);
      } else if (cmd === '/오늘' || cmd === '/today') {
        await C.send(token, chatId, C.buildDay(data.all, data.memos, today).text);
      } else if (cmd === '/주간' || cmd === '/week') {
        await C.send(token, chatId, C.buildWeek(data.all, today).text);
      } else if (cmd === '/월간' || cmd === '/month') {
        await C.send(token, chatId, C.buildMonth(data.all, today).text);
      } else if (cmd === '/시간' || cmd === '/time') {
        const t = parseTime(arg);
        if (!t) await C.send(token, chatId, '시각을 못 알아들었어요.\n예: <code>/시간 8:00</code>  <code>/시간 06:30</code>');
        else {
          cfg.sendAt = t;
          delete cfg.lastSent.day;   // 바꾼 시각 기준으로 오늘 다시 판단
          await C.send(token, chatId, `⏰ 이제 매일 <b>${t}</b> 에 보내드릴게요.\n<i>(15분 안에 적용돼요)</i>`);
        }
      } else if (cmd === '/설정' || cmd === '/status') {
        await C.send(token, chatId, [
          '<b>⚙️ 지금 설정</b>',
          `  보내는 시각: <b>${cfg.sendAt}</b>`,
          `  받는 방: ${cfg.recipients.length}곳`,
          `  이 방 번호: <code>${chatId}</code>`,
          `  이 방은 ${cfg.recipients.indexOf(chatId) >= 0 ? '받는 중 ✅' : '아직 안 받음 — /등록 해보세요'}`,
        ].join('\n'));
      } else if (cmd === '/등록' || cmd === '/register') {
        if (cfg.recipients.indexOf(chatId) >= 0) await C.send(token, chatId, '이미 받고 있어요 🙂');
        else { cfg.recipients.push(chatId); await C.send(token, chatId, '✅ 이 방에도 보내드릴게요.'); }
      } else if (cmd === '/해제' || cmd === '/unregister') {
        const i = cfg.recipients.indexOf(chatId);
        if (i < 0) await C.send(token, chatId, '원래 안 보내던 방이에요.');
        else { cfg.recipients.splice(i, 1); await C.send(token, chatId, '🔕 이 방은 그만 보낼게요.'); }
      } else {
        await C.send(token, chatId, '모르는 명령이에요. /도움말 을 눌러보세요.');
      }
    } catch (e) { console.log('명령 처리 중 오류: ' + e.message); }
  }

  // ── 2) 보낼 시각이 됐는지 ───────────────────────────────
  const now = C.seoulTime();
  const due = now >= cfg.sendAt;
  const sends = [];
  if (due && cfg.lastSent.day !== today) sends.push(['day', C.buildDay(data.all, data.memos, today)]);
  if (due && C.dowOf(today) === 1 && cfg.lastSent.week !== today) sends.push(['week', C.buildWeek(data.all, today)]);
  if (due && C.dnum(today) === 1 && cfg.lastSent.month !== today) sends.push(['month', C.buildMonth(data.all, today)]);

  console.log(`한국시각 ${now} / 설정 ${cfg.sendAt} / 보낼 것 ${sends.length}개 / 받는 방 ${cfg.recipients.length}곳`);

  for (const [kind, msg] of sends) {
    for (const c of cfg.recipients) {
      try { await C.send(token, c, msg.text); console.log(`✅ ${kind} → ${c}`); }
      catch (e) { console.log(`❌ ${kind} → ${c}: ${e.message}`); }
    }
    cfg.lastSent[kind] = today;
  }

  // ── 3) 설정이 바뀌었으면 파일에 남김 (워크플로가 커밋) ──
  if (JSON.stringify(cfg) !== before) { save(cfg); console.log('CONFIG_CHANGED'); }
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
