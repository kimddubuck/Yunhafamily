/* ============================================================
   텔레그램 설정 도우미 — 이 파일 하나면 끝
   ------------------------------------------------------------
   하는 일:
     1) 토큰이 진짜인지 확인하고 봇 이름을 알려줌
     2) 말을 건 사람·그룹을 찾아 '방 번호'를 뽑아줌
     3) 각 방에 테스트 메시지를 실제로 보내봄
     4) 깃허브에 붙여넣을 값 두 개를 그대로 출력

   쓰는 법 (둘 중 편한 쪽):
     A) 토큰을 파일에 저장해두고 실행  ← 추천 (화면에 토큰이 안 남음)
          프로젝트 폴더에 telegram-token.txt 를 만들고 토큰만 한 줄 붙여넣기
          node scripts/setup-telegram.js
     B) 환경변수로
          TELEGRAM_BOT_TOKEN=... node scripts/setup-telegram.js

   토큰은 이 컴퓨터와 텔레그램 서버 사이에서만 오갑니다.
   화면에는 앞뒤 몇 글자만 가려서 보여줍니다.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const TOKEN_FILES = ['telegram-token.txt', '../telegram-token.txt', 'scripts/telegram-token.txt'];

function findToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return { token: process.env.TELEGRAM_BOT_TOKEN.trim(), from: '환경변수' };
  if (process.argv[2] && fs.existsSync(process.argv[2])) {
    return { token: fs.readFileSync(process.argv[2], 'utf8').trim(), from: process.argv[2] };
  }
  for (const f of TOKEN_FILES) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) return { token: fs.readFileSync(p, 'utf8').trim(), from: f };
  }
  return null;
}

const mask = t => t.length < 14 ? '***' : t.slice(0, 6) + '…' + t.slice(-4);

async function api(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && j.ok, data: j.result, err: j.description };
}

(async function main() {
  console.log('\n텔레그램 설정 도우미\n' + '─'.repeat(46));

  const found = findToken();
  if (!found || !found.token) {
    console.log(`
❌ 토큰을 못 찾았어요.

   프로젝트 폴더에 telegram-token.txt 파일을 만들고
   봇파더가 준 토큰을 한 줄로 붙여넣은 뒤 다시 실행해주세요.

   (이 파일은 .gitignore 에 들어있어서 깃허브에 올라가지 않아요)
`);
    process.exit(1);
  }
  console.log(`토큰 읽음: ${mask(found.token)}   (출처: ${found.from})`);

  // ── 1) 토큰 확인 ────────────────────────────────────────
  const me = await api(found.token, 'getMe');
  if (!me.ok) {
    console.log(`\n❌ 토큰이 맞지 않아요 (HTTP ${me.status}) ${me.err || ''}`);
    console.log('   봇파더 메시지에서 콜론(:) 앞뒤를 통째로 복사했는지 확인해주세요.');
    process.exit(1);
  }
  console.log(`✅ 봇 확인: ${me.data.first_name}  (@${me.data.username})`);

  // ── 2) 방 번호 찾기 ─────────────────────────────────────
  const up = await api(found.token, 'getUpdates');
  if (!up.ok) { console.log(`\n❌ 대화 목록을 못 읽었어요: ${up.err || ''}`); process.exit(1); }

  const chats = {};
  (up.data || []).forEach(u => {
    const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
    const c = m && m.chat;
    if (c && !chats[c.id]) chats[c.id] = c;
  });
  const list = Object.values(chats);

  if (!list.length) {
    console.log(`
❌ 아직 아무도 말을 걸지 않았어요.

   봇은 '먼저 말을 걸어준 사람'에게만 보낼 수 있어요.

   · 혼자 받을 때 → 텔레그램에서 @${me.data.username} 를 찾아 /start
   · 둘이 받을 때 → 그룹을 만들어 봇을 초대하고, 그룹에서 /start
                    (그룹에선 / 로 시작하는 말만 봇에게 보여요)

   하고 나서 이 명령을 다시 실행해주세요.
`);
    process.exit(1);
  }

  console.log(`\n찾은 대화 ${list.length}개`);
  list.forEach((c, i) => {
    const who = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '(이름없음)';
    const kind = c.type === 'private' ? '개인' : c.type === 'group' ? '그룹' : c.type === 'supergroup' ? '그룹' : c.type;
    console.log(`  ${i + 1}) ${kind}  ${who}   번호 ${c.id}`);
  });

  // ── 3) 테스트 메시지 실제 발송 ──────────────────────────
  console.log('\n테스트 메시지 보내보는 중…');
  const good = [];
  for (const c of list) {
    const r = await api(found.token, 'sendMessage', {
      chat_id: c.id,
      text: '✅ 연결 확인!\n이 방으로 매일 아침 그날 주요 일정이 올 거예요.',
    });
    const who = c.title || c.first_name || c.id;
    if (r.ok) { good.push(c.id); console.log(`  ✅ ${who} — 도착`); }
    else console.log(`  ❌ ${who} — 실패: ${r.err || ''}`);
  }

  if (!good.length) { console.log('\n한 곳도 못 보냈어요. 위 오류를 알려주시면 봐드릴게요.'); process.exit(1); }

  // ── 4) 깃허브에 넣을 값 ─────────────────────────────────
  console.log('\n' + '─'.repeat(46));
  console.log('이제 깃허브에 값 두 개만 넣으면 끝이에요.\n');
  console.log('  https://github.com/kimddubuck/Yunhafamily/settings/secrets/actions');
  console.log('  → New repository secret 을 두 번 누르고\n');
  console.log('  ① Name:   TELEGRAM_BOT_TOKEN');
  console.log('     Secret: (telegram-token.txt 에 있는 그 토큰)\n');
  console.log('  ② Name:   TELEGRAM_CHAT_ID');
  console.log('     Secret: ' + good.join(','));
  console.log('\n' + '─'.repeat(46));
  console.log('넣고 나서 Actions 탭 → 「오늘의 주요 일정 알림」 → Run workflow 로 바로 확인해보세요.\n');
})().catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
