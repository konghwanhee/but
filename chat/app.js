/* =============================================================================
   공용 채팅 · konghwanhee/but/chat
   · 대화 기록: 비공개 저장소 konghwanhee/Agent 의 chat/messages.json (GitHub REST API)
   · 읽기/쓰기 모두 사용자가 직접 넣은 PAT(Contents: Read and write)로만 동작한다.
   · 전송은 최신 sha를 먼저 읽어 배열 끝에 덧붙이고 PUT 한다(409면 한 번 더 시도).
   · 외부 라이브러리 없음.
   ============================================================================= */
(function () {
'use strict';

/* ---------------------------------------------------------------- 0. 상수 */
var OWNER = 'konghwanhee';
var REPO = 'Agent';
var BRANCH = 'main';
var FILE = 'chat/messages.json';
var API = 'https://api.github.com';
var LS_PAT = 'agentchat:pat';
var LS_SENDER = 'agentchat:sender';
var AUTO_MS = 30000;

var SENDERS = { hwanhee: '환희 님', keyring: '키링', pickle: '삐꾸' };
var TYPES = {
  chat: '대화', draft_ready: '요청서 준비', review_done: '검수 완료',
  revision_applied: '수정 반영', hub_ready: '허브 반영', published: '게시 완료'
};
var STAGES = {
  '1_keyring_draft': '① 요청서', '2_pickle_rendered': '② 렌더 완료',
  '3_keyring_reviewed': '③ 2차 검수', '4_sent_to_but': '④ 허브 반영', '5_published': '⑤ 게시 완료'
};

/* ---------------------------------------------------------------- 1. 상태 */
var state = {
  token: '',
  sha: null,
  msgs: [],
  filterDeck: 'all',
  sender: 'hwanhee',
  auto: true,
  busy: false,
  lastSync: 0,
  timer: null
};

/* ---------------------------------------------------------------- 2. DOM */
function $(id) { return document.getElementById(id); }
var elLogin = $('loginView'), elChat = $('chatView');
var elToken = $('tokenInput'), elConnect = $('btnConnect'), elLoginMsg = $('loginMsg');
var elLogout = $('btnLogout'), elCancelLogin = $('btnCancelLogin');
var elList = $('list'), elFilters = $('filters'), elSync = $('syncInfo');
var elAuto = $('autoRefresh'), elRefresh = $('btnRefresh'), elTokenBtn = $('btnToken');
var elSeg = $('senderSeg'), elType = $('typeSel'), elStage = $('stageSel');
var elDeck = $('deckInput'), elDeckList = $('deckList');
var elInput = $('msgInput'), elSend = $('btnSend'), elForm = $('composer');
var elToast = $('toast');

/* ---------------------------------------------------------------- 3. 작은 도구 */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function linkify(s) {
  return esc(s).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>';
  });
}
function nowStamp() {
  var d = new Date();
  var off = -d.getTimezoneOffset();
  var sign = off >= 0 ? '+' : '-';
  var oh = pad(Math.floor(Math.abs(off) / 60)), om = pad(Math.abs(off) % 60);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sign + oh + ':' + om;
}
function newId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
function toast(msg) {
  elToast.textContent = msg;
  elToast.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { elToast.classList.remove('on'); }, 2600);
}
function parseTs(ts) {
  var d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
function hhmm(ts) {
  var d = parseTs(ts);
  if (!d) return '';
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function dayKey(ts) {
  var d = parseTs(ts);
  if (!d) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function dayLabel(ts) {
  var d = parseTs(ts);
  if (!d) return '';
  var w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  var t = new Date();
  var today = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  var y = new Date(t.getTime() - 86400000);
  var ykey = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
  var k = dayKey(ts);
  if (k === today) return '오늘';
  if (k === ykey) return '어제';
  return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. (' + w + ')';
}

/* ---------------------------------------------------------------- 4. GitHub */
function apiHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}
function fileUrl() {
  return API + '/repos/' + OWNER + '/' + REPO + '/contents/' + FILE;
}
function b64utf8(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '', CH = 0x8000;
  for (var i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
function unb64utf8(b64) {
  var bin = atob(String(b64 || '').replace(/\s/g, ''));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
function errText(status, msg) {
  if (status === 401) return '토큰이 올바르지 않습니다(401). 토큰을 다시 연결해 주세요.';
  if (status === 403) return '권한이 없거나 호출 한도를 넘었습니다(403). Contents: Read and write 권한과 남은 호출 수를 확인해 주세요.';
  if (status === 404) return '저장소나 파일을 찾지 못했습니다(404). 토큰의 저장소 접근 범위를 확인해 주세요.';
  if (status === 409) return '다른 곳에서 먼저 저장했습니다(409). 다시 시도해 주세요.';
  if (status === 422) return '저장 요청이 거부되었습니다(422). 잠시 뒤 다시 시도해 주세요.';
  return msg || ('HTTP ' + status);
}

/* 저장소 접근 확인 → {ok, private, canPush} */
function checkRepo(token) {
  return fetch(API + '/repos/' + OWNER + '/' + REPO, { headers: apiHeaders(token), cache: 'no-store' })
    .then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(errText(r.status, j && j.message));
        return { ok: true, priv: !!j.private, canPush: !!(j.permissions && j.permissions.push) };
      });
    });
}

/* messages.json 읽기 → {items, sha} (없으면 빈 배열) */
function readFile(token) {
  return fetch(fileUrl() + '?ref=' + encodeURIComponent(BRANCH), { headers: apiHeaders(token), cache: 'no-store' })
    .then(function (r) {
      if (r.status === 404) return { items: [], sha: null };
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(errText(r.status, j && j.message));
        var text = unb64utf8(j.content);
        var arr;
        try { arr = JSON.parse(text); } catch (e) { throw new Error('messages.json 형식이 올바르지 않습니다.'); }
        if (!Array.isArray(arr)) throw new Error('messages.json 이 배열이 아닙니다.');
        return { items: arr, sha: j.sha };
      });
    });
}

/* messages.json 쓰기 — 409면 {conflict:true} */
function writeFile(token, text, sha, message) {
  var body = { message: message, content: b64utf8(text), branch: BRANCH };
  if (sha) body.sha = sha;
  return fetch(fileUrl(), {
    method: 'PUT',
    headers: apiHeaders(token),
    body: JSON.stringify(body)
  }).then(function (r) {
    if (r.status === 409) return { conflict: true };
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(errText(r.status, j && j.message));
      return { ok: true, sha: (j.content && j.content.sha) || null, commit: (j.commit && j.commit.sha) || null };
    });
  });
}

/* ---------------------------------------------------------------- 5. 화면 전환 */
function showLogin() {
  elLogin.hidden = false;
  elChat.hidden = true;
  stopAuto();
  var has = !!state.token;
  elLogout.hidden = !has;
  elCancelLogin.hidden = !has;
  elToken.value = '';
  elToken.placeholder = has ? '저장된 토큰이 있습니다 · 새 토큰을 넣으면 교체됩니다' : 'github_pat_…';
  elLoginMsg.textContent = '';
  elLoginMsg.className = 'loginMsg';
  if (has) elConnect.textContent = '토큰 교체하고 들어가기';
  setTimeout(function () { if (!has) elToken.focus(); }, 60);
}
function showChat() {
  elLogin.hidden = true;
  elChat.hidden = false;
}

/* ---------------------------------------------------------------- 6. 렌더 */
function senderLabel(m) { return SENDERS[m && m.sender] || (m && m.sender) || '알 수 없음'; }

function renderFilters() {
  var counts = {};
  var order = [];
  state.msgs.forEach(function (m) {
    var d = m && m.deck_id ? String(m.deck_id) : '';
    if (!d) return;
    if (!counts[d]) { counts[d] = 0; order.push(d); }
    counts[d]++;
  });
  var html = '<button type="button" class="chipBtn' + (state.filterDeck === 'all' ? ' on' : '') +
    '" data-deck="all">전체<span class="cnt">' + state.msgs.length + '</span></button>';
  order.forEach(function (d) {
    html += '<button type="button" class="chipBtn' + (state.filterDeck === d ? ' on' : '') +
      '" data-deck="' + esc(d) + '">' + esc(d) + '<span class="cnt">' + counts[d] + '</span></button>';
  });
  elFilters.innerHTML = html;

  var dl = '';
  order.forEach(function (d) { dl += '<option value="' + esc(d) + '"></option>'; });
  elDeckList.innerHTML = dl;
}

function renderList() {
  var msgs = state.msgs.filter(function (m) {
    return state.filterDeck === 'all' || (m && String(m.deck_id || '') === state.filterDeck);
  });
  if (!msgs.length) {
    elList.innerHTML = '<p class="empty">' +
      (state.filterDeck === 'all'
        ? '아직 메시지가 없습니다.<br><b>환희 님</b>으로 첫 메시지를 남겨 보세요.'
        : '이 덱(<b>' + esc(state.filterDeck) + '</b>)에 쌓인 메시지가 없습니다.') +
      '</p>';
    return;
  }
  var prevDay = '';
  var html = '';
  msgs.forEach(function (m) {
    var dk = dayKey(m.timestamp);
    if (dk && dk !== prevDay) {
      html += '<div class="dayDivider">' + esc(dayLabel(m.timestamp)) + '</div>';
      prevDay = dk;
    }
    var me = m.sender === 'hwanhee';
    var cls = 'msg ' + (me ? 'me' : 'them') + (m.sender === 'pickle' ? ' pickle' : '');
    var badge = me ? '' : '<span class="badge ' + (m.sender === 'keyring' ? 'keyring' : 'pickle') + '">' +
      (m.sender === 'keyring' ? 'KEYRING' : 'PICKLE') + '</span>';
    var tags = '';
    if (m.type && m.type !== 'chat') tags += '<span class="tag type">' + esc(TYPES[m.type] || m.type) + '</span>';
    if (m.stage) tags += '<span class="tag stage">' + esc(STAGES[m.stage] || m.stage) + '</span>';
    if (m.deck_id) tags += '<span class="tag deck">' + esc(m.deck_id) + '</span>';
    tags += '<span class="tag time">' + esc(hhmm(m.timestamp)) + '</span>';
    html += '<div class="' + cls + '">' +
      '<div class="who"><span>' + esc(senderLabel(m)) + '</span>' + badge + '</div>' +
      '<div class="bubble">' + linkify(m.text) + '</div>' +
      '<div class="tags">' + tags + '</div>' +
      '</div>';
  });
  elList.innerHTML = html;
}

function nearBottom() {
  return elList.scrollHeight - elList.scrollTop - elList.clientHeight < 90;
}
function scrollBottom() {
  elList.scrollTop = elList.scrollHeight;
}

function render(keepScroll) {
  var stick = keepScroll ? nearBottom() : true;
  renderFilters();
  renderList();
  if (stick) scrollBottom();
}
function syncLabel() {
  if (!state.lastSync) { elSync.textContent = '불러오는 중…'; return; }
  var d = new Date(state.lastSync);
  elSync.textContent = '마지막 확인 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) +
    ' · 메시지 ' + state.msgs.length + '개';
}

/* ---------------------------------------------------------------- 7. 불러오기 */
function load(opts) {
  opts = opts || {};
  if (state.busy && opts.send !== true) return Promise.resolve();
  return readFile(state.token).then(function (res) {
    var changed = res.sha !== state.sha || !state.sha;
    state.sha = res.sha;
    state.lastSync = Date.now();
    if (changed) {
      state.msgs = res.items.slice().sort(function (a, b) {
        return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
      });
      render(!!opts.keepScroll);
    }
    syncLabel();
    return res;
  }).catch(function (err) {
    elSync.textContent = '불러오기 실패';
    if (!opts.silent) toast(err.message);
    else console.warn('[chat] refresh failed:', err.message);
    if (/401/.test(err.message)) { /* 토큰 만료 — 설정으로 안내 */ }
    throw err;
  });
}

function startAuto() {
  stopAuto();
  if (!state.auto) return;
  state.timer = setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (state.busy) return;
    load({ silent: true, keepScroll: true }).catch(function () { });
  }, AUTO_MS);
}
function stopAuto() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

/* ---------------------------------------------------------------- 8. 전송 */
function senderBadgeLabel() { return SENDERS[state.sender] || state.sender; }

function send() {
  var text = elInput.value.replace(/\s+$/, '');
  if (!text) { elInput.focus(); return; }
  if (!state.token) { showLogin(); return; }
  if (state.busy) return;

  var msg = {
    id: newId(),
    timestamp: nowStamp(),
    sender: state.sender,
    type: elType.value || 'chat',
    deck_id: elDeck.value.trim() || null,
    stage: elStage.value || null,
    text: text
  };

  state.busy = true;
  elSend.disabled = true;
  elSend.textContent = '보내는 중';

  var attempt = 0;
  function tryWrite() {
    attempt++;
    return readFile(state.token).then(function (cur) {
      var arr = cur.items.slice();
      // 같은 id가 이미 있으면(재시도) 중복으로 넣지 않는다
      var dup = arr.some(function (m) { return m && m.id === msg.id; });
      if (!dup) arr.push(msg);
      arr.sort(function (a, b) { return String(a.timestamp || '').localeCompare(String(b.timestamp || '')); });
      return writeFile(state.token, JSON.stringify(arr, null, 2) + '\n', cur.sha,
        'chat: ' + senderBadgeLabel() + ' · ' + (TYPES[msg.type] || msg.type) +
        (msg.deck_id ? ' · ' + msg.deck_id : '') + ' — ' + text.replace(/\s+/g, ' ').slice(0, 48)
      ).then(function (res) {
        if (res.conflict) {
          if (attempt < 3) return sleep(350).then(tryWrite);
          throw new Error('다른 곳에서 동시에 저장하고 있습니다. 잠시 뒤 다시 보내 주세요.');
        }
        state.sha = res.sha;
        state.msgs = arr;
        state.lastSync = Date.now();
        render();
        syncLabel();
        elInput.value = '';
        autoGrow();
        toast('보냈습니다 · ' + (res.commit ? String(res.commit).slice(0, 7) : '커밋 완료'));
      });
    }).catch(function (err) {
      toast('보내지 못했습니다 · ' + err.message);
    }).then(function () {
      state.busy = false;
      elSend.disabled = false;
      elSend.textContent = '전송';
    });
  }
  tryWrite();
}

/* ---------------------------------------------------------------- 9. 입력창 */
function autoGrow() {
  elInput.style.height = 'auto';
  var h = Math.min(elInput.scrollHeight, 132);
  elInput.style.height = h + 'px';
}

function setSender(s) {
  if (!SENDERS[s]) s = 'hwanhee';
  state.sender = s;
  lsSet(LS_SENDER, s);
  Array.prototype.forEach.call(elSeg.querySelectorAll('button'), function (b) {
    var on = b.getAttribute('data-sender') === s;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  elInput.placeholder = (SENDERS[s] || '') + '으로 보내기';
}

/* ---------------------------------------------------------------- 10. 이벤트 */
elConnect.addEventListener('click', function () {
  var t = elToken.value.trim();
  if (!t) { elLoginMsg.textContent = '토큰을 넣어 주세요.'; return; }
  if (!/^(gh[pousr]_|github_pat_)/.test(t)) {
    elLoginMsg.textContent = 'GitHub 토큰 형식이 아닙니다 (github_pat_… 또는 ghp_…).';
    return;
  }
  elConnect.disabled = true;
  elLoginMsg.className = 'loginMsg';
  elLoginMsg.textContent = '토큰을 확인하는 중…';
  checkRepo(t).then(function (info) {
    if (!info.priv) throw new Error('konghwanhee/Agent 가 비공개 저장소로 보이지 않습니다. 토큰의 저장소 선택을 확인해 주세요.');
    if (!info.canPush) throw new Error('이 토큰에는 쓰기 권한이 없습니다. Permissions → Contents: Read and write 로 다시 만들어 주세요.');
    return readFile(t);
  }).then(function (res) {
    state.token = t;
    lsSet(LS_PAT, t);
    state.sha = null;
    state.msgs = res.items;
    state.lastSync = Date.now();
    elLoginMsg.className = 'loginMsg ok';
    elLoginMsg.textContent = '연결되었습니다.';
    showChat();
    render();
    syncLabel();
    startAuto();
  }).catch(function (err) {
    elLoginMsg.className = 'loginMsg';
    elLoginMsg.textContent = err.message;
  }).then(function () {
    elConnect.disabled = false;
  });
});
elToken.addEventListener('keydown', function (e) { if (e.key === 'Enter') elConnect.click(); });

elLogout.addEventListener('click', function () {
  state.token = '';
  lsDel(LS_PAT);
  state.sha = null;
  state.msgs = [];
  showLogin();
  elLoginMsg.className = 'loginMsg ok';
  elLoginMsg.textContent = '로그아웃했습니다. 토큰을 이 브라우저에서 지웠습니다.';
});
elCancelLogin.addEventListener('click', function () {
  if (!state.token) return;
  showChat();
  render();
  startAuto();
});

elRefresh.addEventListener('click', function () {
  elRefresh.classList.add('spin');
  load({ keepScroll: true }).catch(function () { }).then(function () {
    elRefresh.classList.remove('spin');
  });
});
elTokenBtn.addEventListener('click', showLogin);

elAuto.addEventListener('change', function () {
  state.auto = elAuto.checked;
  startAuto();
  toast(state.auto ? '30초마다 새 메시지를 확인합니다' : '자동 새로고침을 껐습니다');
});

elFilters.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button[data-deck]') : null;
  if (!b) return;
  state.filterDeck = b.getAttribute('data-deck');
  renderFilters();
  renderList();
  scrollBottom();
});

elSeg.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button[data-sender]') : null;
  if (!b) return;
  setSender(b.getAttribute('data-sender'));
});

elForm.addEventListener('submit', function (e) {
  e.preventDefault();
  send();
});
elInput.addEventListener('input', autoGrow);
elInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
});

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && state.token && !elChat.hidden) {
    load({ silent: true, keepScroll: true }).catch(function () { });
  }
});

/* ---------------------------------------------------------------- 11. 시작 */
function init() {
  /* 허브의 채팅 팝업(iframe) 안에서는 돌아가기 링크를 숨긴다. */
  if (/[?&]embed=1(&|$)/.test(location.search)) document.body.classList.add('embed');
  state.token = lsGet(LS_PAT) || '';
  setSender(lsGet(LS_SENDER) || 'hwanhee');
  elAuto.checked = state.auto;

  if (!state.token) { showLogin(); return; }
  showChat();
  elList.innerHTML = '<p class="empty">대화를 불러오는 중입니다…</p>';
  load().then(function () { startAuto(); }).catch(function (err) {
    if (/401|404/.test(err.message)) {
      /* 저장된 토큰이 만료·폐기됐거나 저장소 접근이 빠졌다 — 지우고 다시 연결하게 한다. */
      state.token = '';
      lsDel(LS_PAT);
      showLogin();
      elLoginMsg.textContent = '저장된 토큰으로 대화를 읽지 못했습니다. 토큰을 다시 연결해 주세요.';
    } else {
      elList.innerHTML = '<p class="empty">대화를 불러오지 못했습니다.<br>' + esc(err.message) +
        '<br><br><b>↻</b>로 다시 시도해 주세요.</p>';
    }
  });
}

init();
})();
