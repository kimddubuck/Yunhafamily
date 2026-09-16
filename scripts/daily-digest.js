/* ============================================================
   손으로 돌려보는 미리보기 / 즉시 발송
   ------------------------------------------------------------
     MODE=day|week|month|all   무엇을 볼지 (기본 day)
     DAY_OFFSET=1              며칠 뒤 기준으로 볼지 (기본 0)
   토큰·방번호가 환경변수에 있으면 실제로 보내고, 없으면 화면에만 보여준다.

   예) 내일 주간 미리보기
       MODE=week DAY_OFFSET=1 node scripts/daily-digest.js
   ============================================================ */
const C = require('./digest-core');

(async function main() {
  const ds = C.seoulDate(Number(process.env.DAY_OFFSET || 0));
  const mode = (process.env.MODE || 'day').toLowerCase();
  const data = await C.fetchData();

  const kinds = mode === 'all' ? ['day', 'week', 'month'] : [mode];
  const msgs = kinds.map(k =>
    k === 'week' ? { k, ...C.buildWeek(data.all, ds) }
      : k === 'month' ? { k, ...C.buildMonth(data.all, ds) }
        : { k, ...C.buildDay(data.all, data.memos, ds) });

  msgs.forEach(m => {
    console.log(`─── ${m.k} (${ds} 기준) ───`);
    console.log(m.text.replace(/<[^>]+>/g, ''));
    console.log('──────────────────────\n');
  });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = String(process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!token || !chats.length) { console.log('⚠️ 토큰/방번호가 없어 보내지 않았어요 (미리보기만).'); return; }
  for (const m of msgs) for (const c of chats) { await C.send(token, c, m.text); console.log(`✅ ${m.k} 보냄 → ${c}`); }
})().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
