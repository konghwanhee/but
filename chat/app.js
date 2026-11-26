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

var SENDERS = { hwanhee: '환희', keyring: '끼릿', pickle: '삐꾸' };
var AVATARS = { keyring: 'assets/kkirit-avatar.png', pickle: 'assets/ppikku-avatar.png' };
var READ_ORDER = ['keyring', 'pickle', 'hwanhee'];

/* 챕터·호수 선택 — deck_id 는 지금처럼 문자열 그대로 저장하고, 화면에는 사람이 읽는 라벨로 보여준다. */
var CHAPTERS = [
  { series: 'briefing', label: '뷰티 브리핑', prefix: 'beauty-brief-' },
  { series: 'point', label: '뷰티 포인트', prefix: 'beauty-point-' },
  { series: 'tech', label: '뷰티 테크', prefix: 'beauty-tech-' },
  { series: 'pick', label: '뷰티 픽', prefix: 'beauty-pick-' }
];
var CUSTOM = '__custom__';
/* 브리핑 재개일 — 이 날보다 앞선 날짜는 일자 목록에 넣지 않는다(지나면 영향 없음). */
var BRIEFING_START = '2026-11-30';
var MANIFEST = { decks: [] };
var DECK_META = {};

/* ---------------------------------------------------------------- 1. 상태 */
var state = {
  token: '',
  sha: null,
  msgs: [],
  filterDeck: 'all',
  sender: 'hwanhee',
  busy: false,
  marking: false,
  lastSync: 0
};

/* ---------------------------------------------------------------- 2. DOM */
function $(id) { return document.getElementById(id); }
var elLogin = $('loginView'), elChat = $('chatView');
var elToken = $('tokenInput'), elConnect = $('btnConnect'), elLoginMsg = $('loginMsg');
var elLogout = $('btnLogout'), elCancelLogin = $('btnCancelLogin');
var elList = $('list'), elFilters = $('filters'), elSync = $('syncInfo');
var elRefresh = $('btnRefresh'), elClear = $('btnClearAll');
var elSeg = $('senderSeg');
var elChapter = $('chapterSel'), elDeckSel = $('deckSel');
var elDirect = $('directWrap'), elDeckInput = $('deckInput');
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

/* ---------------------------------------------------------------- 3-1. 챕터·호수 */
function padNum(n) { return (n < 10 ? '0' : '') + n; }
function isoDate(d) {
  return d.getFullYear() + '-' + padNum(d.getMonth() + 1) + '-' + padNum(d.getDate());
}
function parseISO(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/* 2026-11-30 → 2026.11.30 */
function fmtFullDate(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : String(s || '');
}
function chapterOf(series) {
  for (var i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].series === series) return CHAPTERS[i];
  return null;
}
function chapterLabel(series) {
  var c = chapterOf(series);
  return c ? c.label : String(series || '');
}
function issueNoText(d) {
  var raw = (d && d.issueNo !== undefined && d.issueNo !== null) ? String(d.issueNo).trim() : '';
  if (!raw) return '';
  var n = Number(raw);
  return (isNaN(n) ? raw : n) + '호';
}
/* 목록에 들어가는 짧은 제목 — 쉼표·가운뎃점 앞까지만 쓴다. 예: '전성분표, 이 순서만 알면 읽힌다' → '전성분표…' */
function shortTitle(t) {
  var s = String(t || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var cut = s.split(/,\s+|·/)[0].trim() || s;
  if (cut.length > 18) {
    var head = cut.slice(0, 18);
    var sp = head.lastIndexOf(' ');
    if (sp >= 8) head = head.slice(0, sp);
    return head.trim() + '…';
  }
  return cut.length < s.length ? cut + '…' : cut;
}
/* 덱 메타(manifest) 기준 라벨 — '뷰티 포인트 10호', 브리핑은 '뷰티 브리핑 2026.11.30' */
function deckMetaLabel(d) {
  var ch = chapterLabel(d && d.series);
  if (d && d.series === 'briefing') return ch + ' ' + fmtFullDate(d.date);
  var no = issueNoText(d);
  return ch + (no ? ' ' + no : '');
}
function indexManifest(decks) {
  DECK_META = {};
  (decks || []).forEach(function (d) {
    if (!d || !d.id) return;
    DECK_META[d.id] = { series: d.series || '', label: deckMetaLabel(d) };
  });
}
/* 말풍선·필터 칩에 쓰는 사람이 읽는 라벨. manifest 에 없으면 id 규칙으로 풀어 본다. */
function deckLabel(id) {
  if (!id) return '';
  var s = String(id);
  if (DECK_META[s]) return DECK_META[s].label;
  var m = s.match(/^beauty-(point|tech|pick|brief)-(\d{4}-\d{2}-\d{2}|\d+)$/);
  if (m) {
    var ch = chapterLabel(m[1] === 'brief' ? 'briefing' : m[1]);
    if (m[1] === 'brief') return ch + ' ' + fmtFullDate(m[2]);
    var n = Number(m[2]);
    return ch + ' ' + (isNaN(n) ? m[2] : n) + '호';
  }
  return s;
}
function nextDeckId(series) {
  var c = chapterOf(series);
  if (!c) return '';
  if (series === 'briefing') {
    var floor = parseISO(BRIEFING_START);
    var t = new Date();
    t.setHours(0, 0, 0, 0);
    if (floor && t < floor) t = floor;
    return c.prefix + isoDate(t);
  }
  var max = 0;
  (MANIFEST.decks || []).forEach(function (d) {
    if (!d || d.series !== series) return;
    var n = Number(d.issueNo);
    if (!isNaN(n) && n > max) max = n;
  });
  return c.prefix + padNum(max + 1);
}
/* 브리핑은 호수 대신 날짜 — 최근 3일부터 10일 뒤까지(재개일 이전은 제외) */
function briefDates() {
  var out = [];
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var start = new Date(today.getTime() - 3 * 86400000);
  var floor = parseISO(BRIEFING_START);
  if (floor && start < floor) start = floor;
  var last = new Date(today.getTime() + 10 * 86400000);
  for (var i = 0; i < 40; i++) {
    var d = new Date(start.getTime() + i * 86400000);
    if (d > last) break;
    out.push(isoDate(d));
  }
  return out;
}
function buildChapterOptions() {
  var cur = elChapter.value;
  var html = '<option value="">선택 안 함 (일반)</option>';
  CHAPTERS.forEach(function (c) {
    html += '<option value="' + esc(c.series) + '">' + esc(c.label) + '</option>';
  });
  elChapter.innerHTML = html;
  elChapter.value = (cur && chapterOf(cur)) ? cur : '';
}
function syncDirect(focus) {
  var custom = elDeckSel.value === CUSTOM;
  elDirect.hidden = !custom;
  if (!custom) return;
  var hint = nextDeckId(elChapter.value);
  elDeckInput.placeholder = hint ? '예: ' + hint : 'deck_id 직접 입력';
  if (focus) elDeckInput.focus();
}
/* 1번 드롭다운(챕터)에 맞춰 2번 드롭다운(호수·일자)을 채운다. */
function buildDeckOptions() {
  var series = elChapter.value;
  var prev = elDeckSel.value;
  if (!series) {
    elDeckSel.innerHTML = '<option value="">일반 대화</option>';
    elDeckSel.value = '';
    elDeckSel.disabled = true;
    syncDirect(false);
    return;
  }
  var items = [];
  if (series === 'briefing') {
    var byDate = {};
    (MANIFEST.decks || []).forEach(function (d) {
      if (d && d.id && d.series === 'briefing' && d.date) byDate[String(d.date).slice(0, 10)] = d.id;
    });
    briefDates().forEach(function (dt) { if (!byDate[dt]) byDate[dt] = 'beauty-brief-' + dt; });
    Object.keys(byDate).sort().reverse().forEach(function (dt) {
      items.push({ value: byDate[dt], label: fmtFullDate(dt), title: '' });
    });
  } else {
    (MANIFEST.decks || []).filter(function (d) { return d && d.id && d.series === series; })
      .sort(function (a, b) {
        var na = Number(a.issueNo), nb = Number(b.issueNo);
        if (isNaN(na) || isNaN(nb)) return String(b.date || '').localeCompare(String(a.date || ''));
        return nb - na;
      })
      .forEach(function (d) {
        var no = issueNoText(d), tt = shortTitle(d.title);
        items.push({ value: d.id, label: no + (tt ? ' · ' + tt : ''), title: d.title || '' });
      });
  }
  var html = '<option value="">' + (series === 'briefing' ? '일자 선택' : '호수 선택') + '</option>';
  items.forEach(function (it) {
    html += '<option value="' + esc(it.value) + '"' + (it.title ? ' title="' + esc(it.title) + '"' : '') + '>' +
      esc(it.label) + '</option>';
  });
  html += '<option value="' + CUSTOM + '">+ 직접 입력</option>';
  elDeckSel.innerHTML = html;
  elDeckSel.disabled = false;
  var keep = false;
  if (prev) {
    for (var i = 0; i < elDeckSel.options.length; i++) {
      if (elDeckSel.options[i].value === prev) { keep = true; break; }
    }
  }
  elDeckSel.value = keep ? prev : '';
  syncDirect(false);
}
/* ../data/manifest.json — 실패·오프라인·지연이어도 선택 자체는 그대로 쓸 수 있게 넘긴다. */
function loadManifest() {
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
  function settle(decks) {
    clearTimeout(timer);
    MANIFEST.decks = decks || [];
    indexManifest(MANIFEST.decks);
    buildDeckOptions();
    if (!elChat.hidden) { renderFilters(); renderList(); }
  }
  return fetch('../data/manifest.json', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (j) {
      settle((j && Array.isArray(j.decks)) ? j.decks : []);
    })
    .catch(function (err) {
      console.warn('[chat] manifest 를 불러오지 못했습니다:', err && err.message);
      settle([]);
    });
}
/* 지금 선택된 deck_id — '선택 안 함'이나 비어 있으면 null */
function currentDeckId() {
  if (!elChapter.value) return null;
  var v = elDeckSel.value;
  if (!v) return null;
  if (v === CUSTOM) return elDeckInput.value.trim() || null;
  return v;
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

/* 읽은 사람 — read_by 가 없으면 발신자만 읽은 것으로 본다. */
function readersOf(m) {
  if (!m) return [];
  if (Array.isArray(m.read_by)) return m.read_by;
  return m.sender ? [m.sender] : [];
}
/* 끼릿(핑크) · 삐꾸(파랑) · 환희(검정) 체크 — 안 읽은 사람은 연회색 */
function readMarkup(m) {
  var read = readersOf(m);
  var names = READ_ORDER.map(function (who) {
    return SENDERS[who] + ' ' + (read.indexOf(who) >= 0 ? '읽음' : '안 읽음');
  }).join(' · ');
  var html = '<span class="reads" role="img" aria-label="' + esc(names) + '" title="' + esc(names) + '">';
  READ_ORDER.forEach(function (who) {
    html += '<span class="rd ' + who + (read.indexOf(who) >= 0 ? ' on' : ' off') + '">✓</span>';
  });
  return html + '</span>';
}

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
      '" data-deck="' + esc(d) + '" title="' + esc(d) + '">' + esc(deckLabel(d)) +
      '<span class="cnt">' + counts[d] + '</span></button>';
  });
  elFilters.innerHTML = html;
}

function renderList() {
  var msgs = state.msgs.filter(function (m) {
    return state.filterDeck === 'all' || (m && String(m.deck_id || '') === state.filterDeck);
  });
  if (!msgs.length) {
    elList.innerHTML = '<p class="empty">' +
      (state.filterDeck === 'all'
        ? '아직 메시지가 없습니다.<br><b>환희</b>로 첫 메시지를 남겨 보세요.'
        : '이 덱(<b>' + esc(deckLabel(state.filterDeck)) + '</b>)에 쌓인 메시지가 없습니다.') +
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
    var who = m.sender === 'keyring' ? 'keyring' : 'pickle';
    var badge = me ? '' : '<span class="badge ' + who + '">' +
      (m.sender === 'keyring' ? 'KKIRIT' : 'PPIKKU') + '</span>';
    var avatar = me ? '' : '<span class="avatar ' + who + '"><img src="' + (AVATARS[m.sender] || AVATARS.pickle) +
      '" alt="" loading="lazy" decoding="async"></span>';
    var tags = '';
    if (m.deck_id) {
      tags += '<span class="tag deck" title="' + esc(m.deck_id) + '">' + esc(deckLabel(m.deck_id)) + '</span>';
    }
    tags += '<span class="tag time">' + esc(hhmm(m.timestamp)) + '</span>';
    tags += readMarkup(m);
    tags += '<button class="delBtn" type="button" data-del="' + esc(m.id) + '" aria-label="이 메시지 삭제" title="이 메시지 삭제">삭제</button>';
    html += '<div class="' + cls + '">' + avatar +
      '<div class="msgBody">' +
      '<div class="who"><span>' + esc(senderLabel(m)) + '</span>' + badge + '</div>' +
      '<div class="bubble">' + linkify(m.text) + '</div>' +
      '<div class="tags">' + tags + '</div>' +
      '</div></div>';
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
  var full = '마지막 확인 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) +
    ' · 메시지 ' + state.msgs.length + '개';
  elSync.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 확인 · 메시지 ' + state.msgs.length + '개';
  elSync.title = full;
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
      if (!elChat.hidden) markRead();
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
    type: 'chat',
    deck_id: currentDeckId(),
    stage: null,
    read_by: [state.sender],
    text: text
  };

  state.busy = true;
  elSend.disabled = true;
  elClear.disabled = true;
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
        'chat: ' + senderBadgeLabel() + ' · 대화' +
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
      elClear.disabled = false;
      elSend.textContent = '전송';
    });
  }
  tryWrite();
}

/* ---------------------------------------------------------------- 8-1. 삭제 */
function shortSha(sha) { return sha ? String(sha).slice(0, 7) : '커밋 완료'; }

/* 최신 파일을 먼저 읽어 transform 으로 고친 뒤 PUT — 409면 새 SHA로 다시 시도한다.
   transform 이 null 을 돌려주면 저장하지 않는다(이미 지워졌거나 이미 비어 있음). */
function mutateFile(transform, message) {
  var attempt = 0;
  function tryOnce() {
    attempt++;
    return readFile(state.token).then(function (cur) {
      var next = transform(cur.items.slice());
      if (!next) {
        state.sha = cur.sha;
        state.msgs = cur.items.slice().sort(function (a, b) {
          return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
        });
        state.lastSync = Date.now();
        render(true);
        syncLabel();
        return { ok: true, skipped: true };
      }
      return writeFile(state.token, JSON.stringify(next, null, 2) + '\n', cur.sha, message).then(function (res) {
        if (res.conflict) {
          if (attempt < 3) return sleep(350).then(tryOnce);
          throw new Error('다른 곳에서 동시에 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
        }
        state.sha = res.sha;
        state.msgs = next;
        state.lastSync = Date.now();
        render(true);
        syncLabel();
        return res;
      });
    });
  }
  return tryOnce();
}

function deleteMessage(id) {
  if (!state.token || state.busy) return;
  var target = null;
  state.msgs.forEach(function (m) { if (!target && m && m.id === id) target = m; });
  if (!target) return;
  var preview = String(target.text || '').replace(/\s+/g, ' ').slice(0, 40);
  if (!confirm('이 메시지를 삭제할까요?\n\n' + senderLabel(target) + ' · ' + preview +
    (String(target.text || '').length > 40 ? '…' : '') + '\n\n삭제하면 되돌릴 수 없습니다.')) return;

  state.busy = true;
  elClear.disabled = true;
  elRefresh.disabled = true;
  mutateFile(function (arr) {
    var kept = arr.filter(function (m) { return !(m && m.id === id); });
    return kept.length === arr.length ? null : kept;
  }, 'chat: 메시지 삭제 — ' + preview).then(function (res) {
    toast(res && res.skipped ? '이미 삭제된 메시지입니다' : '메시지를 삭제했습니다 · ' + shortSha(res && res.commit));
  }).catch(function (err) {
    toast('삭제하지 못했습니다 · ' + err.message);
  }).then(function () {
    state.busy = false;
    elClear.disabled = false;
    elRefresh.disabled = false;
  });
}

function clearAll() {
  if (!state.token || state.busy) return;
  var n = state.msgs.length;
  if (!n) { toast('이미 비어 있습니다'); return; }
  if (!confirm('대화를 전체 삭제할까요?\n\n메시지 ' + n + '개를 모두 지우고 빈 대화로 되돌립니다.\n삭제하면 되돌릴 수 없습니다.')) return;

  state.busy = true;
  elClear.disabled = true;
  elRefresh.disabled = true;
  mutateFile(function (arr) {
    return arr.length ? [] : null;
  }, 'chat: 대화 전체 삭제').then(function (res) {
    toast(res && res.skipped ? '이미 비어 있습니다' : '대화를 전체 삭제했습니다 · ' + shortSha(res && res.commit));
  }).catch(function (err) {
    toast('전체 삭제하지 못했습니다 · ' + err.message);
  }).then(function () {
    state.busy = false;
    elClear.disabled = false;
    elRefresh.disabled = false;
  });
}

/* ---------------------------------------------------------------- 8-2. 읽음 표시 */
/* 지금 선택된 발신자가 아직 읽지 않은 메시지에 read_by 를 더해 조용히 커밋한다. */
function markRead() {
  if (!state.token || state.busy || state.marking) return;
  var who = state.sender;
  var need = state.msgs.some(function (m) {
    return m && readersOf(m).indexOf(who) < 0;
  });
  if (!need) return;
  state.marking = true;
  mutateFile(function (arr) {
    var changed = false;
    var next = arr.map(function (m) {
      if (!m) return m;
      var list = readersOf(m).slice();
      if (list.indexOf(who) >= 0) return m;
      list.push(who);
      changed = true;
      var copy = {};
      Object.keys(m).forEach(function (k) { copy[k] = m[k]; });
      copy.read_by = list;
      return copy;
    });
    return changed ? next : null;
  }, 'chat: 읽음 표시 — ' + (SENDERS[who] || who)).catch(function () {
    /* 읽음 표시 실패는 조용히 넘긴다(대화는 그대로 보인다). */
  }).then(function () {
    state.marking = false;
  });
}

/* ---------------------------------------------------------------- 9. 입력창 */
function autoGrow() {
  elInput.style.height = 'auto';
  var h = Math.min(elInput.scrollHeight, 132);
  elInput.style.height = h + 'px';
}

/* 받침에 따라 '으로/로' — 환희 → 환희로, 끼릿 → 끼릿으로 */
function withRo(name) {
  var n = String(name == null ? '' : name);
  if (!n) return '로';
  var c = n.charCodeAt(n.length - 1);
  var hasJong = c >= 0xAC00 && c <= 0xD7A3 && ((c - 0xAC00) % 28) !== 0;
  return (hasJong ? '으로' : '로');
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
  elInput.placeholder = (SENDERS[s] || '') + withRo(SENDERS[s]) + ' 보내기';
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
});

elRefresh.addEventListener('click', function () {
  elRefresh.classList.add('spin');
  load({ keepScroll: true }).catch(function () { }).then(function () {
    elRefresh.classList.remove('spin');
  });
});
elClear.addEventListener('click', clearAll);

elList.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  if (e.target.closest('[data-act="token"]')) { showLogin(); return; }
  var b = e.target.closest('button[data-del]');
  if (!b) return;
  deleteMessage(b.getAttribute('data-del'));
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

elChapter.addEventListener('change', function () {
  buildDeckOptions();
});
elDeckSel.addEventListener('change', function () {
  syncDirect(true);
});

elForm.addEventListener('submit', function (e) {
  e.preventDefault();
  send();
});
elInput.addEventListener('input', autoGrow);
elInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
});

/* 허브 팝업을 다시 열 때 한 번 새로 읽어 온다(부모 창에서 postMessage). 자동 주기는 없다 — 갱신은 ↻ 버튼으로만. */
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin) return;
  if (e.data === 'agentchat:resume') {
    if (!state.token || elChat.hidden) return;
    load({ silent: true, keepScroll: true }).catch(function () { });
  }
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
  buildChapterOptions();
  buildDeckOptions();
  loadManifest();

  if (!state.token) { showLogin(); return; }
  showChat();
  elList.innerHTML = '<p class="empty">대화를 불러오는 중입니다…</p>';
  load().catch(function (err) {
    if (/401|404/.test(err.message)) {
      /* 저장된 토큰이 만료·폐기됐거나 저장소 접근이 빠졌다 — 지우고 다시 연결하게 한다. */
      state.token = '';
      lsDel(LS_PAT);
      showLogin();
      elLoginMsg.textContent = '저장된 토큰으로 대화를 읽지 못했습니다. 토큰을 다시 연결해 주세요.';
    } else {
      elList.innerHTML = '<p class="empty">대화를 불러오지 못했습니다.<br>' + esc(err.message) +
        '<br><br><b>↻</b>로 다시 시도해 주세요.' +
        '<br><button class="ghost emptyBtn" type="button" data-act="token">토큰 다시 연결</button></p>';
    }
  });
}

init();
})();
