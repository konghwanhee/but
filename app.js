/* =============================================================================
   뷰티 카드뉴스 허브 — konghwanhee/but
   · 홈: 챕터별(뷰티 포인트 / 뷰티 테크 / 뷰티 브리핑 / 뷰티 픽) 표지 갤러리
   · 상세: 표지·요약·본문 장표 1080x1350 실시간 캔버스 + 문구 수정
           + 현재/전체 장표 PNG 저장 + data/{id}.json GitHub 커밋(PAT)
   · 렌더 엔진은 scripts/cardnews-editor/app.js 의 캔버스·줄바꿈(kr_wrap) 코드를
     그대로 쓰고, 데이터 로딩·화면 이동·GitHub 저장만 이 파일에서 새로 붙였습니다.
   · 외부 라이브러리 없음.
   ============================================================================= */
(function () {
'use strict';

/* ---------------------------------------------------------------- 0. 상수 */
var W = 1080, H = 1350, MX = 92, CR = W - MX, CTM = 1150, SRCB = 1204, BARY = 1332;
var INK = '#111111', WHITE = '#FFFFFF';
var GRAY_EMPH = '#8A8A8A', GRAY_SOFT = '#9A9A9A', GRAY_BODY = '#3F3F3F', HAIRLINE = '#E5E5E5';
var FS = '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,-apple-system,sans-serif';
var WG = { regular: 400, medium: 500, bold: 700, extrabold: 800 };
var KEY = '#1E4ED8';
var KEY_TEXT = '#2A55BB';   // 작은 강조 글씨용 짙은 키 컬러(renderPage에서 KEY로 다시 계산)
var VIS_W = 212, VIS_TOP = 146, VIS_BOTTOM = VIS_TOP + VIS_W, VIS_TEXT_GAP = 24;

var IMGS = {};   // 경로 → URL. 저장소 상대경로(assets/…)는 경로를 그대로 쓴다. 로고만 미리 등록.
var META = {};   // 원본 픽셀 크기(마커 좌표 보정용). 저장소 이미지는 원본 크기 그대로라 비어 있음.

var cv = document.getElementById('cv');
var _ctx = cv.getContext('2d', { willReadFrequently: true });

/* ---------------------------------------------------------------- 1. 텍스트 유틸 */
function fnt(size, weight) { return (WG[weight] || 500) + ' ' + size + 'px ' + FS; }

var _mc = new Map();
var _curFont = '';
function measure(str, size, weight) {
  var s = str === undefined || str === null ? '' : String(str);
  if (!s) return 0;
  var k = weight + '|' + size + '|' + s;
  var v = _mc.get(k);
  if (v !== undefined) return v;
  if (_mc.size > 30000) _mc.clear();   // 긴 편집 세션에서 캐시가 무한히 커지지 않게
  _ctx.font = fnt(size, weight);
  v = _ctx.measureText(s).width;
  _mc.set(k, v);
  return v;
}

function drawText(str, x, y, size, weight, color, anchor) {
  if (str === undefined || str === null) return;
  var s = String(str);
  if (!s) return;
  _ctx.font = fnt(size, weight);
  _ctx.fillStyle = color;
  var a = anchor || 'ls';
  _ctx.textAlign = a.charAt(0) === 'l' ? 'left' : a.charAt(0) === 'r' ? 'right' : 'center';
  var v = a.charAt(1);
  _ctx.textBaseline = v === 'm' ? 'middle' : v === 'a' ? 'top' : 'alphabetic';
  _ctx.fillText(s, x, y);
}

function tracked(str, x, y, size, weight, color, track) {
  if (str === undefined || str === null) return 0;
  var t = String(str); if (!t) return 0;
  var cx = x, chars = Array.from(t);
  for (var i = 0; i < chars.length; i++) {
    drawText(chars[i], cx, y, size, weight, color, 'ls');
    cx += measure(chars[i], size, weight) + (track || 0);
  }
  return Math.round(cx - x - (track || 0));
}

function trackedW(str, size, weight, track) {
  var t = String(str || ''); if (!t) return 0;
  var w = 0, chars = Array.from(t);
  for (var i = 0; i < chars.length; i++) w += measure(chars[i], size, weight);
  return Math.round(w + (track || 0) * (chars.length - 1));
}

/* --- 표 상하 여백 균형 (2026-11-24 환희 님 지시) -------------------------------
   파이썬 `scripts/table_layout.py` 와 같은 식. 셀 글자의 잉크(실제로 칠해지는 영역)가
   행의 위·아래 여백을 같게 갖도록 기준선을 잡고, 표 블록 위·아래 여백도 같은 값으로 둔다. */
var INK_SAMPLE = '가나다 Aa 0123';
var _inkC = new Map();
function inkSpan(size, weight) {
  var k = weight + '|' + size;
  var v = _inkC.get(k);
  if (v) return v;
  if (_inkC.size > 4000) _inkC.clear();
  _ctx.font = fnt(size, weight);
  var m = _ctx.measureText(INK_SAMPLE);
  var asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  v = {
    top: -(typeof asc === 'number' && isFinite(asc) && asc > 0 ? asc : size * 0.80),
    bottom: typeof desc === 'number' && isFinite(desc) && desc >= 0 ? desc : size * 0.11
  };
  _inkC.set(k, v);
  return v;
}
/* 여러 줄 블록(잉크)을 top..bottom 세로 가운데에 앉히는 첫 기준선 */
function blockBase(size, weight, top, bottom, n, lead, lastSize, lastWeight) {
  var a = inkSpan(size, weight).top;
  var b = inkSpan(lastSize || size, lastWeight || weight).bottom;
  var h = (b - a) + (lead || 0) * ((n || 1) - 1);
  return (top + bottom) / 2 - h / 2 - a;
}
function cellBase(size, weight, top, bottom) { return blockBase(size, weight, top, bottom, 1, 0); }
/* --- 표 위·아래 여백 28~56px 범위 고정 (2026-11-24 환희 님 확정) -------------
   파이썬 `scripts/table_layout.py` 와 같은 식. 넉넉하면 기본값(44px)에서 멈춰 위에
   붙이고 남는 공간은 아래 숨 공간으로, 28~56px 사이라면 양쪽을 같은 값으로, 모자라면
   28px를 지키고 행 최소 높이를 허용선(36px)까지 줄인다. */
var GAP_MIN = 28, GAP_MAX = 56, GAP_DEFAULT = 44, ROW_FLOOR = 36;
function clampGap(g) {
  var v = (g === undefined || g === null || isNaN(Number(g))) ? GAP_DEFAULT : Number(g);
  return Math.max(GAP_MIN, Math.min(GAP_MAX, v));
}
function balancedGap(space, need, gap) {
  var g0 = clampGap(gap), room = (space - need) / 2;
  if (room >= GAP_MAX) return Math.max(GAP_MIN, Math.min(g0, GAP_MAX));
  if (room >= GAP_MIN) return room;
  return GAP_MIN;
}
/* 표 블록 계획 — 여백은 28px 아래로 깎지 않고 행 최소 높이를 2px씩 줄여 지킨다 */
function planBlock(topAvail, bottomAvail, headH, nRows, minRowH, gap, minGap, rowCap) {
  var space = bottomAvail - topAvail, n = Math.max(1, nRows);
  var mh = Number(minRowH || 44), floor = ROW_FLOOR;
  while (mh > floor && (space - (headH + n * mh)) / 2 < GAP_MIN) mh = Math.max(floor, mh - 2);
  var g = balancedGap(space, headH + n * mh, gap);
  var rowH = (space - 2 * g - headH) / n;
  if (rowCap && rowH > rowCap) rowH = rowCap;
  return { top: topAvail + g, rowH: rowH, gap: g, tight: rowH < mh - 0.5 };
}
/* 표 아래에 각주(belowH)·밴드(bandH)가 있는 장표 — 아래 여백도 위와 같은 값이 된다 */
function planWithBelow(topAvail, limit, headH, nRows, belowH, bandH, gap, minRowH, rowCap) {
  return planBlock(topAvail, limit - (belowH || 0) - (bandH || 0), headH, nRows, minRowH, gap, undefined, rowCap);
}
/* 라벨 잉크 아래 ~ 본문 첫 줄 잉크 위 — 본문 줄 잉크 간격보다 7px 넓게 */
function inkLineGap(size, weight, lead) {
  var s = inkSpan(size, weight);
  return Math.max(0, lead - (s.bottom - s.top));
}
var LABEL_BODY_EXTRA = 16, LABEL_BODY_MIN = 24;
function labelBodyGap(size, weight, lead, extra) {
  var e = (extra === undefined || extra === null) ? LABEL_BODY_EXTRA : extra;
  return Math.max(inkLineGap(size, weight, lead) + e, LABEL_BODY_MIN);
}
/* 상단 라벨 + 본문 박스 (박스 위·아래 여백 같게) */
function labelBox(labelSize, labelWt, bodySize, bodyWt, lead, n, padTop, extra) {
  var lt = inkSpan(labelSize, labelWt), bt = inkSpan(bodySize, bodyWt);
  var gap = labelBodyGap(bodySize, bodyWt, lead, extra);
  var labelBase = padTop - lt.top;
  var first = labelBase + lt.bottom + gap - bt.top;
  var h = first + lead * (Math.max(1, n) - 1) + bt.bottom + padTop;
  return { labelBase: labelBase, first: first, h: h };
}
/* 높이가 정한 밴드 안에 라벨+본문 블록을 잉크 기준 세로 가운데로 */
function stackBox(labelSize, labelWt, bodySize, bodyWt, lead, n, height, padMin, extra) {
  var lt = inkSpan(labelSize, labelWt), bt = inkSpan(bodySize, bodyWt);
  var gap = labelBodyGap(bodySize, bodyWt, lead, extra);
  var blockH = (lt.bottom - lt.top) + gap + (bt.bottom - bt.top) + lead * (Math.max(1, n) - 1);
  var pm = padMin === undefined ? 14 : padMin, top;
  if (blockH + 2 * pm <= height) top = Math.min(Math.max((height - blockH) / 2, pm), height - blockH - pm);
  else top = Math.max(0, (height - blockH) / 2);
  return { labelBase: top - lt.top, first: top - lt.top + lt.bottom + gap - bt.top, blockH: blockH };
}

/* --- 문장부호 기준 줄바꿈 (kr_wrap.py 이식) ------------------------------- */
var SENT_END = '.!?。！？…', CLAUSE_END = ',、·ㆍ—–:;：；', CLOSERS = '"\'”’)]}」』》】）';
var RANK_PENALTY = [0, 0.15, 0.80], GAP_POW = 2, LAST_WEIGHT = 0.7;
var ORPHAN_WORD_PEN = 1.2, SHORT_LAST_RATIO = 0.45, SHORT_LAST_PEN = 3.0;
var WIDOW_PEN = { 0: 0, 1: 0.75, 2: 0.18 };
var PRE_WORDS = new Set(['하는', '되는', '있는', '없는', '하기', '되기', '위한', '대한', '통한', '같은', '같이',
  '및', '등', '때문에', '경우', '정도', '다시', '또', '먼저', '더', '잘', '꼭']);
var PRE_WORD_PEN = 0.16, NUM_PEN = 0.28, NUM_TAIL_PEN = 0.22;
var MOD_END = new Set(['같은', '이런', '그런', '저런', '어떤', '무슨', '단', '및']), MOD_END_PEN = 0.20;
var MIN_MID_RATIO = 0.40, SLACK = 4, MIN_MID_PEN = 3.0;
var OPEN_QUOTES = '"\'‘“「『《〈';
var SEPS = ['·', '/', '‑', '-', 'ㆍ'];

function rankOf(tok) {
  var core = tok;
  while (core && CLOSERS.indexOf(core.charAt(core.length - 1)) >= 0) core = core.slice(0, -1);
  if (!core) return 2;
  if (core.length > 1 && SENT_END.indexOf(core.charAt(core.length - 1)) >= 0) return 0;
  if (CLAUSE_END.indexOf(core.charAt(core.length - 1)) >= 0) return 1;
  return 2;
}
function hasDigit(s) { for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) return true; return false; }
function isDigitCh(ch) { return !!ch && ch >= '0' && ch <= '9'; }

function splitLongWord(word, size, weight, maxW) {
  var chunks = [], buf = '', chars = Array.from(word);
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    if (buf && measure(buf + ch, size, weight) > maxW) {
      var cut = 0;
      for (var s = 0; s < SEPS.length; s++) {
        var k = buf.lastIndexOf(SEPS[s]);
        if (k >= 0) cut = Math.max(cut, k + 1);
      }
      if (cut > 0 && cut < buf.length) { chunks.push(buf.slice(0, cut)); buf = buf.slice(cut) + ch; }
      else { chunks.push(buf); buf = ch; }
    } else buf += ch;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function tokenize(para, size, weight, maxW) {
  var out = [], words = para.split(/\s+/).filter(function (w) { return w !== ''; });
  for (var i = 0; i < words.length; i++) {
    var wd = words[i];
    if (measure(wd, size, weight) <= maxW) { out.push([wd, false]); continue; }
    var pieces = splitLongWord(wd, size, weight, maxW);
    for (var p = 0; p < pieces.length; p++) out.push([pieces[p], p > 0]);
  }
  return out;
}

function layOut(para, size, weight, maxW) {
  var tokens = tokenize(para, size, weight, maxW), n = tokens.length;
  if (n === 0) return [''];
  function lineText(a, b) {
    var s = tokens[a][0];
    for (var k = a + 1; k <= b; k++) s += (tokens[k][1] ? '' : ' ') + tokens[k][0];
    return s;
  }
  var wcache = new Map();
  function lineWidth(a, b) {
    var k = a + ',' + b, v = wcache.get(k);
    if (v === undefined) { v = measure(lineText(a, b), size, weight); wcache.set(k, v); }
    return v;
  }
  var rem = new Array(n).fill(0);
  for (var i = n - 1; i >= 0; i--) {
    if (rankOf(tokens[i][0]) === 0) rem[i] = 0;
    else rem[i] = (i + 1 < n) ? rem[i + 1] + 1 : 0;
  }
  var INF = Infinity;
  var dp = new Array(n + 1).fill(INF), prev = new Array(n + 1).fill(-1);
  dp[0] = 0;

  function midCost(a, b) {
    var fill = lineWidth(a, b) / maxW, gap = 1 - fill;
    var c = Math.pow(gap, GAP_POW) + RANK_PENALTY[rankOf(tokens[b][0])] + (WIDOW_PEN[rem[b]] || 0);
    if (fill < MIN_MID_RATIO) c += MIN_MID_PEN * (MIN_MID_RATIO - fill);
    var curTok = tokens[b][0];
    if (b + 1 < n) {
      var nxt = tokens[b + 1][0];
      if (hasDigit(curTok) && nxt.length <= 2) c += NUM_TAIL_PEN;
      if (MOD_END.has(curTok)) c += MOD_END_PEN;
      if (PRE_WORDS.has(nxt)) c += PRE_WORD_PEN;
      if (isDigitCh(nxt.charAt(0))) c += NUM_PEN;
      if (OPEN_QUOTES.indexOf(nxt.charAt(0)) >= 0) c = Math.min(c, Math.pow(gap, GAP_POW) + RANK_PENALTY[1]);
    }
    return c;
  }

  for (var i2 = 1; i2 <= n; i2++) {
    for (var a2 = i2 - 1; a2 >= 0; a2--) {
      if (dp[a2] === INF) continue;
      if (lineWidth(a2, i2 - 1) > maxW + SLACK) break;
      var c2 = dp[a2] + midCost(a2, i2 - 1);
      if (c2 < dp[i2]) { dp[i2] = c2; prev[i2] = a2; }
    }
  }

  var best = INF, bestS = 0;
  for (var s3 = 0; s3 < n; s3++) {
    var lw = lineWidth(s3, n - 1);
    if (lw > maxW + SLACK) continue;
    var gap3 = (maxW - lw) / maxW;
    var c3 = dp[s3] + LAST_WEIGHT * Math.pow(gap3, GAP_POW);
    if (gap3 > 1 - SHORT_LAST_RATIO) c3 += SHORT_LAST_PEN * Math.pow(gap3 - (1 - SHORT_LAST_RATIO), 2);
    if (n - s3 === 1 && n > 2) c3 += ORPHAN_WORD_PEN;
    if (c3 < best) { best = c3; bestS = s3; }
  }
  if (!isFinite(best)) return greedy(tokens, size, weight, maxW);

  var starts = [bestS], i4 = bestS;
  while (i4 > 0) {
    var a4 = prev[i4];
    if (a4 < 0) a4 = Math.max(0, i4 - 1);
    starts.push(a4); i4 = a4;
  }
  starts.reverse();
  var lines = [];
  for (var idx = 0; idx < starts.length; idx++) {
    var a5 = starts[idx];
    var b5 = idx + 1 < starts.length ? starts[idx + 1] - 1 : n - 1;
    lines.push(lineText(a5, b5));
  }
  return lines;
}

function greedy(tokens, size, weight, maxW) {
  var lines = [], cur = '';
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i][0], glue = tokens[i][1];
    var cand = cur ? cur + (glue ? '' : ' ') + tok : tok;
    if (!cur || measure(cand, size, weight) <= maxW) cur = cand;
    else { lines.push(cur); cur = tok; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapText(text, size, weight, maxW) {
  if (text === null || text === undefined) return [];
  var t = String(text);
  if (!t.trim()) return [];
  var out = [], paras = t.split('\n');
  for (var i = 0; i < paras.length; i++) {
    var para = paras[i];
    if (!para.trim()) { out.push(''); continue; }
    out = out.concat(layOut(para.trim(), size, weight, maxW));
  }
  return out;
}

/* ---------------------------------------------------------------- 2. 헤드라인 표기 */
function segments(line) {
  if (typeof line === 'string') return [{ text: line, tone: 'ink' }];
  if (!Array.isArray(line) || !line.length) return [];
  if (Array.isArray(line[0])) {
    var out = [];
    for (var i = 0; i < line.length; i++) {
      var seg = line[i];
      if (Array.isArray(seg)) out.push({ text: String(seg[0] === undefined ? '' : seg[0]), tone: seg.length > 1 ? String(seg[1]) : 'ink' });
      else out.push({ text: String(seg === undefined ? '' : seg), tone: 'ink' });
    }
    return out;
  }
  if (line.length === 1) return [{ text: String(line[0]), tone: 'ink' }];
  var text = String(line[0]), spec = String(line[1]);
  if (spec.indexOf('|') >= 0) {
    var parts = spec.split('|'), emph = parts[0], tone = parts[1];
    if (emph && text.slice(-emph.length) === emph) {
      return [{ text: text.slice(0, text.length - emph.length), tone: 'ink' }, { text: emph, tone: tone }];
    }
    if (emph) {
      var sep = /[ ·,]$/.test(text) ? '' : ' ';
      return [{ text: text + sep, tone: 'ink' }, { text: emph, tone: tone }];
    }
  }
  return [{ text: text, tone: spec }];
}
function headlineLines(slide) {
  var l = (slide && slide.headline) || [];
  return l.map(segments);
}
function headlineWidth(lines, size, weight) {
  var widest = 0;
  for (var i = 0; i < lines.length; i++) {
    var tot = 0;
    for (var j = 0; j < lines[i].length; j++) tot += measure(lines[i][j].text, size, weight);
    widest = Math.max(widest, tot);
  }
  return widest;
}
function headlineText(lines) {
  return (lines || []).map(function (l) {
    return segments(l).map(function (s) { return s.text; }).join('');
  }).join(' ');
}
function drawHeadlines(lines, x0, firstY, gap, size, colors) {
  for (var i = 0; i < lines.length; i++) {
    var x = x0;
    for (var j = 0; j < lines[i].length; j++) {
      var seg = lines[i][j];
      var col = seg.tone === 'key' ? KEY : seg.tone === 'gray' ? colors.gray : colors.ink;
      drawText(seg.text, x, firstY + i * gap, size, 'extrabold', col, 'ls');
      x += measure(seg.text, size, 'extrabold');
    }
  }
}

/* ---------------------------------------------------------------- 3. 이미지 */
var _imgMap = new Map();
function getImage(path) {
  if (!path) return null;
  if (_imgMap.has(path)) return _imgMap.get(path);
  var src = IMGS[path] || path;   // 저장소 상대경로(assets/…)를 그대로 쓴다
  if (!src) { _imgMap.set(path, null); return null; }
  var im = new Image();
  im.onload = function () { requestRender(); };
  im.src = src;
  _imgMap.set(path, im);
  return im;
}
function imgOk(im) { return !!im && im.complete && im.naturalWidth > 0; }
function preload() { Object.keys(IMGS).forEach(getImage); }

function placeholder(path, x, y, w, h) {
  _ctx.fillStyle = '#F1F0EC'; _ctx.fillRect(x, y, w, h);
  _ctx.strokeStyle = '#DDDCD6'; _ctx.lineWidth = 1;
  _ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  var nm = String(path || '이미지').split('/').pop();
  drawText('사진', x + w / 2, y + h / 2 - (h > 90 ? 9 : 0), Math.min(18, Math.max(10, h / 12)), 'bold', '#A9A8A0', 'mm');
  if (h > 90) drawText(nm, x + w / 2, y + h / 2 + 12, 10, 'medium', '#B9B8B0', 'mm');
}

function drawCoverCrop(path, x, y, w, h, fx, fy, zoom) {
  var im = getImage(path);
  if (!imgOk(im)) { placeholder(path, x, y, w, h); return false; }
  var sw = im.naturalWidth, sh = im.naturalHeight, target = w / h, z = zoom || 1;
  var ch = Math.min(sh, sw / target) / z, cw = ch * target;
  if (cw > sw) { cw = sw; ch = cw / target; }
  if (ch > sh) { ch = sh; cw = ch * target; }
  var left = (sw - cw) * clamp01(fx === undefined ? 0.5 : fx);
  var top = (sh - ch) * clamp01(fy === undefined ? 0.5 : fy);
  _ctx.drawImage(im, left, top, cw, ch, x, y, w, h);
  return true;
}
function drawContain(path, x, y, w, h, border) {
  var im = getImage(path);
  if (!imgOk(im)) { placeholder(path, x, y, w, h); return; }
  var r = Math.min(w / im.naturalWidth, h / im.naturalHeight);
  var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
  _ctx.drawImage(im, x + (w - nw) / 2, y + (h - nh) / 2, nw, nh);
  if (border) {
    _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
    _ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}
function drawContainPlain(path, x, y, w, h) {
  var im = getImage(path);
  if (!imgOk(im)) { placeholder(path, x, y, w, h); return; }
  var r = Math.min(w / im.naturalWidth, h / im.naturalHeight);
  var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
  _ctx.drawImage(im, x + (w - nw) / 2, y + (h - nh), nw, nh);
}

// 투명 누끼 — 배경·테두리 없이 알파 그대로 앉힌다(제품 사진은 이 방식만 쓴다).
function cutoutFit(path, maxW, maxH, height) {
  var im = getImage(path);
  if (!imgOk(im)) return { w: maxW, h: maxH, im: im };
  var r = height ? height / im.naturalHeight
                 : Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight);
  var w = im.naturalWidth * r, h = im.naturalHeight * r;
  if (w > maxW) { h *= maxW / w; w = maxW; }
  if (h > maxH) { w *= maxH / h; h = maxH; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), im: im };
}

function drawCutout(path, x, y, w, h, align) {
  var f = cutoutFit(path, w, h, null);
  if (!imgOk(f.im)) { placeholder(path, x, y, w, h); return f; }
  var px = x + (w - f.w) / 2;
  var py = align === 'center' ? y + (h - f.h) / 2 : y + (h - f.h);
  _ctx.drawImage(f.im, px, py, f.w, f.h);
  return { w: f.w, h: f.h, x: px, y: py };
}
function drawLogo(tone, x, y, h) {
  var key = tone === 'white' ? '__logo_white__' : '__logo_black__';
  var im = getImage(key);
  if (imgOk(im)) {
    var w = im.naturalWidth * h / im.naturalHeight;
    _ctx.drawImage(im, x, y, w, h);
    return { w: w, h: h };
  }
  drawText('but', x, y + h * 0.85, h * 0.92, 'extrabold', tone === 'white' ? WHITE : INK, 'ls');
  return { w: h * 1.7, h: h };
}
function shadeHex(hex, depth) {
  var c = String(hex || '#000000').replace('#', '');
  if (c.length === 3) c = c.charAt(0) + c.charAt(0) + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2);
  var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  var f = function (v) { var x = Math.round(v * (1 - depth)); return (x < 16 ? '0' : '') + x.toString(16); };
  return '#' + f(r) + f(g) + f(b);
}
function clamp01(v) { v = Number(v); if (isNaN(v)) return 0.5; return Math.max(0, Math.min(1, v)); }
function clampNum(v, lo, hi) { v = Number(v); if (isNaN(v)) return lo; return Math.max(lo, Math.min(hi, v)); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* 그라데이션 스크림 */
function scrim(cov) {
  var st = cov.scrim_top === undefined ? 0.44 : Number(cov.scrim_top);
  var topPx = Math.round(H * st);
  var peak = cov.scrim_max === undefined ? 240 : Number(cov.scrim_max);
  if (peak <= 1) peak = peak * 255;
  var stops = cov.scrim_stops;
  var ease = cov.scrim_ease || 'smooth';
  var power = cov.scrim_power === undefined ? 2.0 : Number(cov.scrim_power);
  var f = function (t) {
    if (stops && stops.length) {
      var xs = stops.map(function (s) { return Number(s[0]); });
      var ys = stops.map(function (s) { return Number(s[1]); });
      if (t <= xs[0]) return ys[0];
      for (var i = 1; i < xs.length; i++) {
        if (t <= xs[i]) {
          var r = (t - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
          return ys[i - 1] + (ys[i] - ys[i - 1]) * r;
        }
      }
      return ys[ys.length - 1];
    }
    if (ease === 'quad') return Math.pow(t, power);
    if (ease === 'cubic') return Math.pow(t, 3);
    if (ease === 'sine') return 1 - Math.cos(t * Math.PI / 2);
    if (ease === 'linear') return t;
    return t * t * (3 - 2 * t);
  };
  var g = _ctx.createLinearGradient(0, topPx, 0, H);
  for (var i2 = 0; i2 <= 48; i2++) {
    var t = i2 / 48;
    var a = Math.max(0, Math.min(1, f(t) * peak / 255));
    g.addColorStop(t, 'rgba(17,17,17,' + a.toFixed(3) + ')');
  }
  _ctx.fillStyle = g; _ctx.fillRect(0, topPx, W, H - topPx);
}

function detectLogoTone() {
  try {
    var d = _ctx.getImageData(0, 40, 420, 135).data;
    var lum = [];
    for (var i = 0; i < d.length; i += 16) {
      lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    lum.sort(function (a, b) { return a - b; });
    var med = lum[Math.floor(lum.length / 2)] || 0;
    return med >= 140 ? 'black' : 'white';
  } catch (e) { return 'white'; }
}

/* ---------------------------------------------------------------- 4. 표지 */
function coverLayout(cov, family) {
  if (cov && cov.layout) return cov.layout;
  if (family === 'tech') return cov && cov.visual ? 'solid' : 'photo';
  if (family === 'point') return 'block';
  return 'photo';
}
function fitHeadSize(lines, start, min, maxW) {
  var size = Number(start);
  while (size > min && headlineWidth(lines, size, 'extrabold') > maxW) size -= 2;
  return size;
}
function drawLinesLeft(lines, x0, firstY, gap, size, colorOf) {
  for (var i = 0; i < lines.length; i++) {
    var x = x0;
    for (var j = 0; j < lines[i].length; j++) {
      var seg = lines[i][j];
      drawText(seg.text, x, firstY + i * gap, size, 'extrabold', colorOf(seg.tone), 'ls');
      x += measure(seg.text, size, 'extrabold');
    }
  }
}
function drawLinesCenter(lines, firstY, gap, size, colorOf) {
  for (var i = 0; i < lines.length; i++) {
    var tot = 0, j;
    for (j = 0; j < lines[i].length; j++) tot += measure(lines[i][j].text, size, 'extrabold');
    var x = W / 2 - tot / 2;
    for (j = 0; j < lines[i].length; j++) {
      var seg = lines[i][j];
      drawText(seg.text, x, firstY + i * gap, size, 'extrabold', colorOf(seg.tone), 'ls');
      x += measure(seg.text, size, 'extrabold');
    }
  }
}

/* 뷰티 포인트 기본 표지 — 상단 솔리드 컬러 블록 + 하단 공식 연출컷 풀블리드(2분할) */
function coverPointBlock(cov) {
  var blockH = Number(cov.block_h || 660);
  var ok = false;
  if (cov.image) {
    if (String(cov.fit || 'cover').toLowerCase() === 'contain') {
      _ctx.fillStyle = WHITE; _ctx.fillRect(0, blockH, W, H - blockH);
      var im0 = getImage(cov.image);
      if (imgOk(im0)) {
        var rr = Math.min(W / im0.naturalWidth, (H - blockH) / im0.naturalHeight);
        var nw0 = im0.naturalWidth * rr, nh0 = im0.naturalHeight * rr;
        _ctx.drawImage(im0, (W - nw0) / 2, blockH + (H - blockH - nh0) / 2, nw0, nh0);
        ok = true;
      }
    } else {
      ok = drawCoverCrop(cov.image, 0, blockH, W, H - blockH, cov.focus, cov.focus_y, cov.zoom || 1);
    }
  }
  if (!ok) { _ctx.fillStyle = INK; _ctx.fillRect(0, blockH, W, H - blockH); }
  var onLight = String(cov.logo_tone || 'white') === 'black';
  var onBlock = onLight ? INK : WHITE;
  _ctx.fillStyle = cov.block_color || KEY; _ctx.fillRect(0, 0, W, blockH);
  drawLogo(onLight ? 'black' : 'white', MX, Number(cov.logo_top === undefined ? 74 : cov.logo_top),
    Number(cov.logo_height || 42));

  var series = cov.series_name === undefined ? 'BEAUTY POINT' : String(cov.series_name);
  if (series) {
    var fs = Number(cov.series_size || 22);
    var sw = trackedW(series, fs, 'bold', 4);
    tracked(series, CR - sw, Number(cov.series_baseline === undefined ? 132 : cov.series_baseline),
      fs, 'bold', onBlock, 4);
  }
  var num = cov.num === undefined ? '' : String(cov.num).trim();
  if (num) {
    drawText(num, CR, Number(cov.num_top === undefined ? 150 : cov.num_top),
      Number(cov.num_size || 232), 'extrabold', cov.num_color || INK, 'ra');
  }

  var lines = headlineLines({ headline: cov.headline || [] });
  var size = fitHeadSize(lines, cov.head_size || 94, 52, CR - MX);
  var gap = Math.round(size * 1.16);
  var subBase = Number(cov.sub_baseline === undefined ? blockH - 44 : cov.sub_baseline);
  var lastMax = subBase - Number(cov.sub_gap === undefined ? 74 : cov.sub_gap);
  var first = cov.head_first === undefined
    ? Math.min(420, lastMax - gap * (lines.length - 1)) : Number(cov.head_first);
  drawLinesLeft(lines, MX, first, gap, size, function (t) { return t === 'key' ? INK : onBlock; });

  if (cov.sub) {
    var ss = Number(cov.sub_size || 27);
    while (ss > 20 && measure(cov.sub, ss, 'medium') > CR - MX) ss -= 1;
    drawText(cov.sub, MX, subBase, ss, 'medium', onBlock, 'ls');
  }
}

/* 네모박스 없이 배경 위에 떠 있는 비주얼 — 투명 PNG(입자·누끼컷) 또는 사진(제형) */
function drawCoverVisual(cov, headLast) {
  var im = getImage(cov.visual);
  if (!imgOk(im)) return;
  var bx = Number(cov.visual_x || 0);
  var by = Number(cov.visual_y === undefined ? headLast + 46 : cov.visual_y);
  var bw = Number(cov.visual_w || (W - 2 * bx));
  var bh = Number(cov.visual_h === undefined ? H - by - 158 : cov.visual_h);
  var iw = im.naturalWidth, ih = im.naturalHeight;
  var cover = (cov.visual_fit || 'contain') === 'cover';
  var r = cover ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih);
  var nw = iw * r, nh = ih * r;
  var x = bx + (bw - nw) / 2 + Number(cov.visual_dx || 0);
  var y = by + (bh - nh) / 2 + Number(cov.visual_dy || 0);
  if (cover) {
    var sx = (nw - bw) * clamp01(cov.visual_focus_x === undefined ? 0.5 : cov.visual_focus_x);
    var sy = (nh - bh) * clamp01(cov.visual_focus_y === undefined ? 0.5 : cov.visual_focus_y);
    _ctx.drawImage(im, sx / r, sy / r, bw / r, bh / r, x, y, bw, bh);
    return;
  }
  var op = cov.visual_opacity === undefined ? 1 : clampNum(cov.visual_opacity, 0, 1);
  if (op < 1) { _ctx.save(); _ctx.globalAlpha = op; }
  if ((cov.visual_mode || 'float') === 'feather' && nw > 4 && nh > 4) {
    var oc = document.createElement('canvas');
    oc.width = Math.round(nw); oc.height = Math.round(nh);
    var o = oc.getContext('2d');
    o.drawImage(im, 0, 0, oc.width, oc.height);
    o.globalCompositeOperation = 'destination-in';
    var f = Math.max(1, Number(cov.feather || 90));
    var ax = Math.min(0.49, f / oc.width), ay = Math.min(0.49, f / oc.height);
    var gx = o.createLinearGradient(0, 0, oc.width, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(ax, 'rgba(0,0,0,1)');
    gx.addColorStop(1 - ax, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = gx; o.fillRect(0, 0, oc.width, oc.height);
    var gy = o.createLinearGradient(0, 0, 0, oc.height);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(ay, 'rgba(0,0,0,1)');
    gy.addColorStop(1 - ay, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = gy; o.fillRect(0, 0, oc.width, oc.height);
    _ctx.drawImage(oc, x, y);
  } else {
    _ctx.drawImage(im, x, y, nw, nh);
  }
  if (op < 1) _ctx.restore();
}

/* 뷰티 테크 기본 표지 — 솔리드 키 컬러 바탕 + 중앙 정렬 타이포 + 테두리 없는 비주얼 */
function coverTechSolid(cov) {
  _ctx.fillStyle = cov.bg_color || KEY; _ctx.fillRect(0, 0, W, H);
  drawLogo('white', MX, Number(cov.logo_top === undefined ? 78 : cov.logo_top),
    Number(cov.logo_height || 44));
  var kick = cov.kicker || '';
  if (kick) {
    var kf = Number(cov.kicker_size || 22);
    var kw = trackedW(kick, kf, 'bold', 5);
    tracked(kick, (W - kw) / 2, Number(cov.kicker_baseline === undefined ? 236 : cov.kicker_baseline),
      kf, 'bold', WHITE, 5);
  }
  var lines = headlineLines({ headline: cov.headline || [] });
  var size = fitHeadSize(lines, cov.head_size || 92, 54, Number(cov.head_max_w || 940));
  var gap = Math.round(size * 1.16);
  var first = Number(cov.head_first === undefined ? 336 : cov.head_first);
  drawLinesCenter(lines, first, gap, size, function (t) { return t === 'key' ? INK : WHITE; });
  if (cov.visual) drawCoverVisual(cov, first + gap * (lines.length - 1));
  if (cov.sub) {
    drawText(cov.sub, W / 2, Number(cov.sub_baseline === undefined ? 1256 : cov.sub_baseline),
      Number(cov.sub_size || 31), 'medium', WHITE, 'ms');
  }
}

function renderCover(c, family) {
  var cov = c.cover || {};
  _ctx.fillStyle = INK; _ctx.fillRect(0, 0, W, H);
  if (family === 'brief') return coverBrief(cov);
  if (family === 'pick') return pickCover();
  var tech = family === 'tech';
  var layout = coverLayout(cov, family);
  if (layout === 'solid') return coverTechSolid(cov);
  if (layout === 'block') return coverPointBlock(cov);
  var hasPhoto = false;
  if (cov.image) {
    hasPhoto = drawCoverCrop(cov.image, 0, 0, W, H, cov.focus, cov.focus_y, cov.zoom || 1);
    if (hasPhoto) scrim(cov);
  }
  var tone = cov.logo_tone;
  if (!tone || tone === 'auto') tone = hasPhoto ? detectLogoTone() : 'white';
  var lh = cov.logo_height === undefined ? (tech ? 44 : 44) : Number(cov.logo_height);
  drawLogo(tone, MX, Number(cov.logo_top === undefined ? 74 : cov.logo_top), lh);

  // 킥커
  var kick = cov.kicker || '';
  if (kick) {
    var kf = Number(cov.kicker_size || (tech ? 21 : 22));
    var tw = trackedW(kick, kf, 'bold', 5);
    var chipW = tw + 44, chipH = tech ? 50 : 48;
    var pos = tech ? 'top_right' : (cov.kicker_pos || 'bottom');
    var cx, cy;
    if (pos === 'top_right') {
      cx = CR - chipW;
      cy = Math.round(cov.kicker_top === undefined ? (tech ? 70 : 74) : cov.kicker_top);
    } else {
      cx = MX;
      cy = Math.round(cov.kicker_top === undefined ? H - 390 : cov.kicker_top);
    }
    _ctx.fillStyle = KEY; _ctx.fillRect(cx, cy, chipW, chipH);
    tracked(kick, cx + 22, cy + chipH / 2 + 8, kf, 'bold', WHITE, 5);
  }

  var lines = headlineLines({ headline: cov.headline || [] });
  var size = Number(cov.head_size || (tech ? 82 : 88));
  var maxW = CR - MX;
  while (size > (tech ? 44 : 48) && headlineWidth(lines, size, 'extrabold') > maxW) size -= 2;
  var gap = Math.round(size * (tech ? 1.17 : 1.16));
  var last = Number(cov.head_last === undefined ? (tech ? H - 158 : H - 160) : cov.head_last);
  var first = last - gap * (lines.length - 1);
  drawHeadlines(lines, MX, first, gap, size, { ink: WHITE, gray: WHITE });

  if (cov.sub) {
    drawText(cov.sub, MX, Number(cov.sub_baseline === undefined ? (tech ? H - 96 : H - 100) : cov.sub_baseline),
      Number(cov.sub_size || 27), 'medium', WHITE, 'ls');
  }
}

function coverBrief(cov) {
  var had = false;
  if (cov.image) {
    had = drawCoverCrop(cov.image, 0, 0, W, H, cov.focus, 0.5, 1);
    if (had) {
      // 무채색
      try {
        _ctx.save();
        _ctx.globalCompositeOperation = 'saturation';
        _ctx.fillStyle = '#808080'; _ctx.fillRect(0, 0, W, H);
        _ctx.restore();
      } catch (e) { }
      _ctx.fillStyle = 'rgba(0,0,0,0.20)'; _ctx.fillRect(0, 0, W, H); // 밝기 0.8
    }
  }
  // 상단 그라데이션
  var topH = Math.round(H * 0.26);
  var gt = _ctx.createLinearGradient(0, 0, 0, topH);
  for (var i = 0; i <= 20; i++) {
    var t = i / 20;
    gt.addColorStop(t, 'rgba(0,0,0,' + (140 * Math.pow(1 - t, 1.35) / 255).toFixed(3) + ')');
  }
  _ctx.fillStyle = gt; _ctx.fillRect(0, 0, W, topH);
  // 하단 그라데이션
  var gTop = Math.round(H * 0.26), gh = H - gTop;
  var gb = _ctx.createLinearGradient(0, gTop, 0, H);
  for (var j = 0; j <= 24; j++) {
    var tt = j / 24;
    gb.addColorStop(tt, 'rgba(6,6,6,' + (254 * Math.pow(tt, 1.0) / 255).toFixed(3) + ')');
  }
  _ctx.fillStyle = gb; _ctx.fillRect(0, gTop, W, gh);
  // 좌측 비네트
  var vw = Math.round(W * 0.70);
  var gv = _ctx.createLinearGradient(0, 0, vw, 0);
  for (var k = 0; k <= 16; k++) {
    var v = k / 16;
    gv.addColorStop(v, 'rgba(0,0,0,' + (85 * Math.pow(1 - v, 1.5) / 255).toFixed(3) + ')');
  }
  _ctx.fillStyle = gv; _ctx.fillRect(0, 0, vw, H);

  drawLogo('white', MX, 78, 44);

  var subF = 31, headF = 90, kickF = 24;
  var lineGap = Math.round(headF * 1.26);
  var lines = headlineLines({ headline: cov.headline || [] });
  var sub = cov.sub || '', kicker = cov.kicker || '';
  var subBase = H - 118, headLast = subBase - 96;
  var headFirst = headLast - lineGap * (lines.length - 1);
  var kickBase = headFirst - 104;
  if (kicker) tracked(kicker, MX, kickBase, kickF, 'bold', '#DEDEDE', 4);
  drawHeadlines(lines, MX, headFirst, lineGap, headF, { ink: WHITE, gray: '#C6C6C6' });
  if (sub) drawText(sub, MX, subBase, subF, 'medium', '#DEDEDE', 'ls');
}

/* ---------------------------------------------------------------- 5. 공통 프레임 */
var _frameAuto = false;
function framePoint(page) {
  var tone = 'black', color = KEY;
  if (_frameAuto) {
    tone = detectLogoTone();
    color = tone === 'black' ? INK : WHITE;
  }
  drawLogo(tone, MX, 74, 42);
  if (page) drawText(page, CR, 96, 25, 'bold', color, 'rs');
}
function progressPoint(cur, total) {
  _ctx.fillStyle = INK; _ctx.fillRect(0, BARY, W, 3);
  _ctx.fillStyle = KEY; _ctx.fillRect(0, BARY - 2, W * cur / Math.max(1, total), 7);
}
function labelPoint(label) {
  if (!label) return;
  tracked(label, MX, 196, 21, 'bold', KEY, 3);
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, 210, 44, 2);
}
function headBlock(slide, firstY, maxW) {
  labelPoint(slide.label || '');
  var mw = maxW || (CR - MX);
  var size = Number(slide.head_size || 62);
  var lines = headlineLines(slide);
  while (size > 34 && headlineWidth(lines, size, 'extrabold') > mw) size -= 2;
  var gap = Math.round(size * 1.22);
  var first = firstY === undefined ? 272 : firstY;
  drawHeadlines(lines, MX, first, gap, size, { ink: INK, gray: GRAY_EMPH });
  return { last: first + gap * (lines.length - 1), size: size };
}
function bodyBlock(slide, base, size, maxW) {
  var body = slide.body || '';
  if (!body) return base;
  size = Number(size || 24);
  var lines = wrapText(body, size, 'regular', maxW || (CR - MX));
  var gap = Math.round(size * 1.62);
  for (var i = 0; i < lines.length; i++) drawText(lines[i], MX, base + i * gap, size, 'regular', INK, 'ls');
  return base + gap * lines.length;
}
function drawSource(text) {
  if (text) drawText(text, MX, SRCB, 19, 'medium', KEY, 'ls');
}
function drawDisclaimer(text) {
  if (!text) return;
  var lines = wrapText(text, 15, 'medium', CR - MX);
  var y = SRCB + 36;
  for (var i = 0; i < lines.length; i++) { drawText(lines[i], MX, y, 15, 'medium', INK, 'ls'); y += 21; }
}
function drawRule(y, w) {
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, y, w || 64, 3);
}
function takeaway(text, height, label, limit) {
  var h = height || 112;
  var base = limit || CTM;
  var y0 = base - h;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, h);
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, y0, 8, h);
  var fsize = h === 104 ? 24 : 25;
  var lines = wrapText(text, fsize, 'bold', CR - MX - 76);
  var n = lines.length;
  var gap = h === 104 ? 32 : 33;
  var first;
  if (label) {
    var kc = String(KEY).replace('#', '');
    var rr = parseInt(kc.slice(0, 2), 16) / 255, gg = parseInt(kc.slice(2, 4), 16) / 255, bb = parseInt(kc.slice(4, 6), 16) / 255;
    var lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    /* 라벨과 첫 줄 사이를 본문 줄 간격보다 넓게, 밴드 위·아래는 같게 (2026-11-24) */
    var sb = stackBox(15, 'bold', fsize, 'bold', gap, n, h, 14, 8);
    tracked(label, MX + 34, y0 + sb.labelBase, 15, 'bold', lum > 0.15 ? KEY : WHITE, 3);
    first = y0 + sb.first;
  } else {
    first = blockBase(fsize, 'bold', y0 + 14, y0 + h - 14, n, gap, fsize, 'bold');
  }
  for (var i = 0; i < n; i++) drawText(lines[i], MX + 34, first + i * gap, fsize, 'bold', WHITE, 'ls');
  return base;
}

/* ---------------------------------------------------------------- 5b. 본문 시각 카드 */
function visTextRight(s) {
  var v = s && s.visual;
  if (!v) return CR;
  if (v.mode === 'side' || v.mode === 'panel') return CR - Number(v.w || 380) - 26;
  if (v.mode === 'logo' || v.mode === 'photo' || v.mode === 'logos') return CR - VIS_W - VIS_TEXT_GAP;
  return CR;
}
function contentTopPoint(s, headLast, gap) {
  var g = Number(s.gap_after_head === undefined ? gap : s.gap_after_head);
  var floor = Number(s.__visFloor || 0);
  return Math.max(headLast + g, floor);
}
function tintOf(hex, mix) {
  var c = String(hex || '#000000').replace('#', '');
  var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  var m = mix === undefined ? 0.075 : mix;
  return 'rgb(' + Math.round(255 - (255 - r) * m) + ',' + Math.round(255 - (255 - g) * m) + ',' +
         Math.round(255 - (255 - b) * m) + ')';
}
function tintLogoCanvas(im, w, h, color) {
  var off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
  var oc = off.getContext('2d');
  oc.drawImage(im, 0, 0, off.width, off.height);
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = color;
  oc.fillRect(0, 0, off.width, off.height);
  return off;
}
function drawTintLogo(path, x, y, w, h, color, maxW, maxH) {
  var im = getImage(path);
  if (!imgOk(im)) { placeholder(path, x, y, w, h); return; }
  var r = Math.min(w * (maxW || 0.86) / im.naturalWidth, h * (maxH || 0.52) / im.naturalHeight);
  var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
  _ctx.drawImage(tintLogoCanvas(im, nw, nh, color || INK), x + (w - nw) / 2, y + (h - nh) / 2);
}
/* 장표에 필요한 만큼만, 내용에 맞는 모양으로 — 파이썬 렌더러와 동일한 좌표 */
function drawBandPoint(s, top) {
  var v = s.visual, h = Number(v.h || 230), w = CR - MX;
  if ((v.fit || 'cover') === 'cover') {
    var bfx = v.focus === undefined ? 0.5 : v.focus;
    var bfy = v.focus_y === undefined ? bfx : v.focus_y;
    drawCoverCrop(v.image, MX, top, w, h, bfx, bfy, 1);
  } else {
    if (v.tint) { _ctx.fillStyle = tintOf(KEY, 0.06); _ctx.fillRect(MX, top, w, h); }
    drawContain(v.image, MX + w * 0.03, top + h * 0.03, w * 0.94, h * 0.94, false);
  }
  _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
  _ctx.strokeRect(MX + 0.5, top + 0.5, w - 1, h - 1);
  var cap = String(v.caption || '').trim();
  if (cap && (v.caption_mode || 'overlay') === 'overlay') {
    var bar = Number(v.caption_bar || 30);
    _ctx.fillStyle = WHITE; _ctx.fillRect(MX + 1, top + h - bar, w - 2, bar - 1);
    drawText(cap, MX + 16, top + h - bar / 2 + 1, Number(v.caption_size || 17), 'medium', INK, 'lm');
  } else if (cap) {
    var capY = top + h + 24, lines = wrapText(cap, Number(v.caption_size || 17), 'medium', w);
    for (var i = 0; i < lines.length; i++) drawText(lines[i], MX, capY + i * 23, Number(v.caption_size || 17), 'medium', INK, 'ls');
    return { x: MX, y: top, w: w, h: h + 24 + 23 * (lines.length - 1) + 4 };
  }
  return { x: MX, y: top, w: w, h: h };
}
function drawNotePoint(s, top) {
  var v = s.visual, h = Number(v.h || 150), w = CR - MX;
  _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
  _ctx.strokeRect(MX + 0.5, top + 0.5, w - 1, h - 1);
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, top, 6, h - 1);
  var y = top + 30;
  if (v.title) { tracked(v.title, MX + 26, y, 15, 'bold', KEY_TEXT, 2); y += 26; }
  var size = Number(v.size || 21);
  (v.lines || []).forEach(function (ln) {
    var ls = wrapText(ln, size, 'medium', w - 52);
    for (var k = 0; k < ls.length; k++) {
      drawText(ls[k], MX + 26, y + size, size, 'medium', INK, 'ls');
      y += Math.round(size * 1.42);
    }
  });
  if (v.caption) drawText(v.caption, MX + 26, top + h - 16, 14, 'medium', KEY_TEXT, 'ls');
  return { x: MX, y: top, w: w, h: h };
}
function drawStripPoint(s, top) {
  var v = s.visual, labels = v.labels || [];
  var list = labels.length ? [] : (v.images || [v.image]).filter(Boolean).slice(0, 4);
  var h = Number(v.h || 120), w = CR - MX, n = Math.max(1, labels.length || list.length), cw = w / n;
  _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
  _ctx.strokeRect(MX + 0.5, top + 0.5, w - 1, h - 1);
  for (var i = 0; i < n; i++) {
    var x0 = MX + i * cw;
    if (i) { _ctx.fillStyle = INK; _ctx.fillRect(x0, top + 20, 1, h - 41); }
    if (labels.length) {
      var size = Number(v.label_size || 25);
      while (size > 14 && measure(String(labels[i]), size, 'bold') > cw * 0.82) size--;
      drawText(String(labels[i]), x0 + cw / 2, top + h / 2, size, 'bold', INK, 'mm');
      continue;
    }
    drawTintLogo(list[i], x0, top, cw, h, INK, 0.68, 0.50);
  }
  return { x: MX, y: top, w: w, h: h };
}
function drawGridPoint(s, top) {
  var v = s.visual, cells = v.cells || [], cols = Number(v.cols || 2), gap = 20, w = CR - MX;
  var cw = (w - gap * (cols - 1)) / cols, ch = Number(v.ch || 148);
  for (var i = 0; i < cells.length; i++) {
    var cx = MX + (i % cols) * (cw + gap), cy = top + Math.floor(i / cols) * (ch + gap);
    var tone = cells[i].tone || 'ink';
    _ctx.fillStyle = tone === 'ink' ? INK : KEY;
    _ctx.fillRect(cx, cy, cw, ch);
    drawTintLogo(cells[i].image, cx, cy + ch * 0.16, cw, ch * 0.40, WHITE, 0.56, 1);
    if (cells[i].label) {
      var tw = measure(cells[i].label, 19, 'bold');
      drawText(cells[i].label, cx + cw / 2 - tw / 2, cy + ch - 22, 19, 'bold', WHITE, 'ls');
    }
  }
  var rows = Math.ceil(cells.length / Math.max(1, cols));
  return { x: MX, y: top, w: w, h: Math.round(ch * rows + gap * (rows - 1)) };
}
function drawFiguresPoint(s, top) {
  var v = s.visual, cells = v.cells || [], h = Number(v.h || 178), w = CR - MX;
  var n = Math.max(1, cells.length), cw = w / n;
  _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
  _ctx.strokeRect(MX + 0.5, top + 0.5, w - 1, h - 1);
  for (var i = 0; i < cells.length; i++) {
    var x0 = MX + i * cw;
    if (i) { _ctx.fillStyle = INK; _ctx.fillRect(x0, top + 22, 1, h - 45); }
    drawText(cells[i].value || '', x0 + 30, top + h * 0.52, 58, 'extrabold',
             (cells[i].tone || 'key') === 'key' ? KEY : INK, 'ls');
    drawText(cells[i].label || '', x0 + 30, top + h * 0.80, 20, 'medium', INK, 'ls');
  }
  return { x: MX, y: top, w: w, h: h };
}
function drawSidePoint(s) {
  var v = s.visual, w = Number(v.w || 380), h = Number(v.h || 300);
  var x0 = CR - w, y0 = Number(v.top === undefined ? VIS_TOP : v.top);
  var cutout = !!v.cutout;
  if (cutout && v.images && v.images.length) {
    // 누끼 2~3개를 같은 바닥선에 맞춰 나란히(카드·테두리 없음)
    var specs = v.images, gap = Number(v.gap === undefined ? 30 : v.gap);
    // labels: 누끼 아래 제품명만 작은 글자로 (상자·테두리 없음)
    var labels = v.labels || [], lsize = Number(v.label_size || 17);
    var labelH = labels.length ? lsize + 14 : 0;
    var sizes = specs.map(function (sp) {
      return cutoutFit(sp.image, w, h - labelH, Math.min(Number(sp.height || h), h - labelH));
    });
    var total = sizes.reduce(function (a, q) { return a + q.w; }, 0) + gap * (sizes.length - 1);
    if (total > w) {
      var f = w / total;
      sizes = sizes.map(function (q) { return { w: Math.max(1, Math.round(q.w * f)), h: Math.max(1, Math.round(q.h * f)), im: q.im }; });
      total = sizes.reduce(function (a, q) { return a + q.w; }, 0) + gap * (sizes.length - 1);
    }
    var cx = x0 + (w - total) / 2, base = y0 + h - labelH;
    sizes.forEach(function (q, i) {
      if (imgOk(q.im)) _ctx.drawImage(q.im, cx, base - q.h, q.w, q.h);
      if (labels[i]) drawText(labels[i], cx + q.w / 2, base + labelH - 6, lsize, 'medium', INK, 'ms');
      cx += q.w + gap;
    });
    return { x: x0, y: y0, w: w, h: h };
  }
  var isLogo = v.tone === 'key' || /\.svg$/.test(v.image || '') || /_logo\.png$/.test(v.image || '');
  if (cutout && !isLogo) {
    var sc = Number(v.fit_scale === undefined ? 1 : v.fit_scale);
    var sy = Number(v.fit_scale_y === undefined ? sc : v.fit_scale_y);
    drawCutout(v.image, x0, y0, w * sc, h * sy, 'center');
  } else if (isLogo) {
    _ctx.fillStyle = KEY; _ctx.fillRect(x0, y0, w, h);
    drawTintLogo(v.image, x0, y0, w, h, WHITE, 0.72, 0.24);
  } else {
    if (v.fit === 'cover') {
      drawCoverCrop(v.image, x0, y0, w, h, v.focus === undefined ? 0.5 : v.focus, 0.5, 1);
    } else {
      if (v.tint !== false) { _ctx.fillStyle = tintOf(KEY, v.mix === undefined ? 0.075 : v.mix); _ctx.fillRect(x0, y0, w, h); }
      drawContain(v.image, x0 + w * 0.08, y0 + h * 0.07, w * 0.84, h * 0.86, false);
    }
  }
  if (v.frame !== false && !cutout) {
    _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
    _ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  }
  return { x: x0, y: y0, w: w, h: h };
}
var POINT_VIS_MODES = { band: drawBandPoint, strip: drawStripPoint, grid: drawGridPoint,
                        figures: drawFiguresPoint, side: drawSidePoint, note: drawNotePoint,
                        logowall: drawLogoWallPoint };

/* 전폭 로고 월 — 칸 없이 크기가 다른 로고를 한 줄로 (베이스라인 정렬) */
function drawLogoWallPoint(s, top) {
  var v = s.visual, list = (v.images || [v.image]).filter(Boolean);
  var heights = (v.heights || [44, 66, 50, 74]).slice();
  while (heights.length < list.length) heights.push(heights[heights.length - 1]);
  var gap = Number(v.gap || 44), avail = CR - MX;
  var maxH = Math.max.apply(null, heights.slice(0, list.length));
  var items = list.map(function (p, i) {
    var im = getImage(p), hh = heights[i];
    if (!imgOk(im)) return { w: 0, h: hh, im: null, p: p };
    return { w: im.naturalWidth * hh / im.naturalHeight, h: hh, im: im, p: p };
  });
  var sum = items.reduce(function (a, it) { return a + it.w; }, 0);
  var total = sum + gap * (items.length - 1);
  if (total > avail && sum > 0) {
    var k = (avail - gap * (items.length - 1)) / sum;
    items = items.map(function (it) { return { w: it.w * k, h: it.h * k, im: it.im, p: it.p }; });
    maxH = maxH * k;
    sum = items.reduce(function (a, it) { return a + it.w; }, 0);
    total = sum + gap * (items.length - 1);
  }
  var x = MX + (avail - total) / 2, base = top + maxH;
  items.forEach(function (it) {
    if (!it.im) { placeholder(it.p, x, base - it.h, it.w, it.h); x += it.w + gap; return; }
    _ctx.drawImage(tintLogoCanvas(it.im, it.w, it.h, INK), x, base - it.h);
    x += it.w + gap;
  });
  _ctx.fillStyle = INK; _ctx.fillRect(MX, base + 18, avail, 1);
  return { x: MX, y: top, w: avail, h: maxH + 19 };
}

/* 사진 가장자리 잉크 스크림 — 아래/위/왼쪽에서 오는 그라데이션 */
function bandScrim(x, y, w, h, bottom, top, start, left) {
  var s0 = y + h * (start === undefined ? 0.42 : start);
  if (bottom > 0) {
    var g = _ctx.createLinearGradient(0, s0, 0, y + h);
    g.addColorStop(0, 'rgba(17,17,17,0)');
    g.addColorStop(1, 'rgba(17,17,17,' + (bottom / 255).toFixed(3) + ')');
    _ctx.fillStyle = g; _ctx.fillRect(x, s0, w, y + h - s0);
  }
  if (top > 0) {
    var t1 = y + h * 0.34;
    var gt = _ctx.createLinearGradient(0, y, 0, t1);
    gt.addColorStop(0, 'rgba(17,17,17,' + (top / 255).toFixed(3) + ')');
    gt.addColorStop(1, 'rgba(17,17,17,0)');
    _ctx.fillStyle = gt; _ctx.fillRect(x, y, w, t1 - y);
  }
  if (left > 0) {
    var gl = _ctx.createLinearGradient(x, 0, x + w * 0.72, 0);
    gl.addColorStop(0, 'rgba(17,17,17,' + (left / 255).toFixed(3) + ')');
    gl.addColorStop(0.33, 'rgba(17,17,17,' + (left / 255).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(17,17,17,0)');
    _ctx.fillStyle = gl; _ctx.fillRect(x, y, w * 0.72, h);
  }
}

/* 전폭 상단 풀블리드 컷 — 제목을 사진 아래쪽에 얹는다 */
function drawTopBandPoint(s) {
  var v = s.visual, h = Number(v.h || 470), y0 = Number(v.top || 0);
  drawCoverCrop(v.image, 0, y0, W, h, v.focus === undefined ? 0.5 : v.focus, 0.5, 1);
  bandScrim(0, y0, W, h, Number(v.scrim_bottom === undefined ? 238 : v.scrim_bottom),
    Number(v.scrim_top || 0), v.scrim_start, Number(v.scrim_left || 0));
  _ctx.fillStyle = INK; _ctx.fillRect(0, y0 + h - 3, W, 3);
  return { x: 0, y: y0, w: W, h: h };
}

function drawHeadOnPhoto(s, rect) {
  var maxW = Math.round(W * 0.86) - MX;
  var size = Number(s.head_size || 78);
  var lines = headlineLines(s);
  while (size > 40 && headlineWidth(lines, size, 'extrabold') > maxW) size -= 2;
  var gap = Math.round(size * 1.18);
  var last = rect.y + rect.h - Number(s.head_bottom === undefined ? 56 : s.head_bottom);
  var first = last - gap * (lines.length - 1);
  var label = s.label || '';
  if (label) {
    var ly = first - Math.round(size * 1.02) - 16;
    var lw = trackedW(label, 21, 'bold', 3);
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, ly - 30, lw + 30, 36);
    tracked(label, MX + 15, ly - 3, 21, 'bold', WHITE, 3);
  }
  drawLinesLeft(lines, MX, first, gap, size, function (t) { return t === 'key' ? KEY : WHITE; });
  return { last: last, size: size };
}
function whiteLogoCanvas(im, w, h) {
  var off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
  var oc = off.getContext('2d');
  oc.drawImage(im, 0, 0, off.width, off.height);
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = WHITE;
  oc.fillRect(0, 0, off.width, off.height);
  return off;
}
function drawVisLogo(path, x, y, w, h, maxW, maxH) {
  var im = getImage(path);
  if (!imgOk(im)) { placeholder(path, x, y, w, h); return; }
  var r = Math.min(w * (maxW || 0.86) / im.naturalWidth, h * (maxH || 0.52) / im.naturalHeight);
  var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
  _ctx.drawImage(whiteLogoCanvas(im, nw, nh), x + (w - nw) / 2, y + (h - nh) / 2);
}
function drawVisualPoint(s) {
  var v = s.visual;
  if (!v) return;
  var x0 = CR - VIS_W, y0 = VIS_TOP, mode = v.mode || 'logo';
  if (mode === 'logo' || mode === 'logos') {
    _ctx.fillStyle = KEY; _ctx.fillRect(x0, y0, VIS_W, VIS_W);
    var paths = (mode === 'logos' ? (v.images || []) : [v.image]).filter(Boolean);
    if (paths.length === 1) {
      drawVisLogo(paths[0], x0 + 12, y0 + 12, VIS_W - 24, VIS_W - 24);
    } else if (paths.length === 2) {
      var ch = (VIS_W - 24) / 2;
      for (var i = 0; i < 2; i++) {
        drawVisLogo(paths[i], x0 + 12, y0 + 6 + i * ch, VIS_W - 24, ch - 10, 0.90, 0.78);
        if (i === 0) { _ctx.fillStyle = WHITE; _ctx.fillRect(x0 + 26, y0 + 6 + ch, VIS_W - 52, 1); }
      }
    } else {
      var list = paths.slice(0, 4), rh = (VIS_W - 20) / list.length;
      for (var j = 0; j < list.length; j++) {
        var ry = y0 + 10 + j * rh;
        drawVisLogo(list[j], x0 + 12, ry, VIS_W - 24, rh, 0.94, 0.62);
        if (j) { _ctx.fillStyle = WHITE; _ctx.fillRect(x0 + 24, ry, VIS_W - 48, 1); }
      }
    }
  } else {
    if ((v.fit || 'contain') === 'cover') {
      drawCoverCrop(v.image, x0, y0, VIS_W, VIS_W, v.focus === undefined ? 0.5 : v.focus, 0.5, 1);
    } else {
      drawContain(v.image, x0, y0, VIS_W, VIS_W, false);
    }
    _ctx.strokeStyle = INK; _ctx.lineWidth = 1;
    _ctx.strokeRect(x0 + 0.5, y0 + 0.5, VIS_W - 1, VIS_W - 1);
  }
}

/* ---------------------------------------------------------------- 6. 뷰티 포인트 장표 */
function pTable(s, headLast) {
  var spec = s.table || {}, cols = spec.columns || [], rows = spec.rows || [];
  var gapP = clampGap(spec.table_gap === undefined ? (s.table_gap === undefined ? GAP_DEFAULT : s.table_gap) : spec.table_gap);
  var ncol = cols.length || 1;
  var raw = (spec.widths && spec.widths.length) ? spec.widths : new Array(ncol).fill(1);
  var tot = raw.reduce(function (a, b) { return a + Number(b); }, 0) || 1;
  var widths = raw.map(function (w) { return Number(w) / tot * (CR - MX); });
  var keyCells = {};
  (spec.key_cells || []).forEach(function (cc) { keyCells[cc[0] + ',' + cc[1]] = true; });
  var prevInk;
  if (s.body) {
    /* 본문이 있으면 headLast 는 본문 블록의 끝(마지막 줄 + 한 줄 간격) — 본문 잉크 아래에서 잰다 */
    var bs0 = Number(s.body_size || 24);
    prevInk = headLast - (Math.round(bs0 * 1.62) - inkSpan(bs0, 'regular').bottom);
  } else {
    prevInk = headLast + inkSpan(Number(s.__headSize || 62), 'extrabold').bottom;
  }
  var headH = Number(spec.head_height || 54), headHT = 22 + headH;
  var bandH = s.takeaway ? 112 : 0;
  var limitP = (s.__limit || CTM), floorP = Number(s.__visFloor || 0);
  var boost = Number(spec.key_size_boost === undefined ? 2 : spec.key_size_boost);
  var size = Number(spec.cell_size || 24);
  while (size > 17) {
    var ok = true;
    for (var r = 0; r < rows.length && ok; r++) {
      for (var j2 = 0; j2 < rows[r].length; j2++) {
        var hot0 = keyCells[r + ',' + j2];
        var parts0 = String(rows[r][j2]).split('\n');
        for (var q = 0; q < parts0.length; q++) {
          if (measure(parts0[q], size + (hot0 ? boost : 0), hot0 ? 'bold' : 'medium') > widths[j2] - 34) { ok = false; break; }
        }
        if (!ok) break;
      }
    }
    if (ok) break;
    size -= 1;
  }
  /* 표 위·아래 여백 28~56px 범위 고정 — 세로가 빠듯하면 글자를 1px씩 줄여 지킨다 */
  var size0 = size, plan = null;
  for (var extra = 0; extra < 4; extra++) {
    var szc = Math.max(17, size0 - extra);
    var leadC = Math.round(szc * 1.36);
    var linesMax = 1;
    rows.forEach(function (rr) { (rr || []).forEach(function (cc) { linesMax = Math.max(linesMax, String(cc).split('\n').length); }); });
    var inkH = inkSpan(szc, 'medium').bottom - inkSpan(szc, 'medium').top;
    var contentH = inkH + leadC * (linesMax - 1) + 28;
    plan = planWithBelow(Math.max(prevInk, floorP - gapP), limitP, headHT, rows.length, 0, bandH,
                         gapP, contentH, spec.row_height);
    if (!plan.tight || floorP > prevInk + gapP) break;
    size = szc;
  }
  size = Math.max(17, size0 - extra);
  var top = Math.max(plan.top, floorP);
  var rowH = Math.max(1, (limitP - bandH - plan.gap - (top + headHT)) / Math.max(1, rows.length));
  gapP = plan.gap;
  drawRule(top);
  var headTop = top + 22;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, headTop, CR - MX, headH);
  var fh = Number(spec.head_size || 21), x = MX;
  var headBase = cellBase(fh, 'bold', headTop, headTop + headH);
  cols.forEach(function (c, j) {
    var align = spec.align && spec.align[j] === 'r';
    var tx = align ? x + widths[j] - 18 : x + (j ? 18 : 20);
    drawText(c, tx, headBase, fh, 'bold', WHITE, align ? 'rs' : 'ls');
    x += widths[j];
  });
  var listTop = headTop + headH;
  var leadT = Math.round(size * 1.36);
  for (var i = 0; i < rows.length; i++) {
    var y0 = listTop + rowH * i, cy = y0 + rowH / 2;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1);
    var x2 = MX;
    for (var j3 = 0; j3 < rows[i].length; j3++) {
      var align2 = spec.align && spec.align[j3] === 'r';
      var tx2 = align2 ? x2 + widths[j3] - 18 : x2 + (j3 ? 18 : 20);
      var hot = keyCells[i + ',' + j3];
      var parts = String(rows[i][j3]).split('\n');
      var color = hot ? KEY_TEXT : INK;
      var wt = hot || j3 === 0 ? 'bold' : 'medium';
      var sz = size + (hot ? boost : 0);
      var base = blockBase(sz, wt, y0, y0 + rowH, parts.length, leadT,
                           Math.max(17, size - 2), hot ? 'bold' : 'medium');
      for (var k = 0; k < parts.length; k++) {
        var wsz = k === 0 ? wt : 'medium';
        var ssz = k === 0 ? sz : Math.max(17, size - 2);
        drawText(parts[k], tx2, base + k * leadT, ssz, hot && k > 0 ? 'bold' : wsz, color, align2 ? 'rs' : 'ls');
      }
      x2 += widths[j3];
    }
  }
  var endY = listTop + rowH * rows.length;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, endY, CR - MX, 2);
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT', s.__limit || CTM); return s.__limit || CTM; }
  return endY;
}

function pCards(s, headLast) {
  var top = contentTopPoint(s, headLast, 56);
  var cards = s.cards || [];
  var gap = 24, cw = (CR - MX - gap * (cards.length - 1)) / Math.max(1, cards.length);
  var pad = 34, bandH = s.takeaway ? 112 : 0;
  var itemSize = Number(s.item_size || 21), itemGap = Math.round(itemSize * 1.5);
  var titleSize = Number(s.card_title_size || 40), noteSize = Number(s.card_note_size || 19);
  function parts(item) {
    if (item && typeof item === 'object') return [String(item.text || ''), String(item.sub || '')];
    return [String(item == null ? '' : item), ''];
  }
  var limit = (s.__limit || CTM) - (bandH ? bandH + 34 : 0);
  var need = 0;
  cards.forEach(function (card) {
    var y = 178;
    (card.items || []).forEach(function (item) {
      var p = parts(item);
      var lines = wrapText(p[0], itemSize, 'medium', cw - pad * 2 - 22);
      y += itemGap * lines.length;
      if (p[1]) y += 24;
      y += 16;
    });
    if (card.note) y += 42;
    need = Math.max(need, y);
  });
  var ch = Math.min(limit - top, need + 56);
  ch = Math.max(ch, 320);
  var slack = limit - (top + ch);
  if (slack > 60) top += Math.round(slack * 0.45);

  var ends = [];
  cards.forEach(function (card, i) {
    var x = MX + i * (cw + gap);
    var bg = (card.tone || 'ink') === 'ink' ? INK : KEY;
    _ctx.fillStyle = bg; _ctx.fillRect(x, top, cw, ch);
    var tx = x + pad;
    tracked(card.eyebrow || '', tx, top + 62, 18, 'bold', WHITE, 3);
    var title = card.title || '';
    var size = titleSize;
    while (measure(title, size, 'extrabold') > cw - pad * 2 && size > 28) size -= 1;
    drawText(title, tx, top + 122, size, 'extrabold', WHITE, 'ls');
    var y = top + 178;
    (card.items || []).forEach(function (item) {
      var p = parts(item);
      _ctx.fillStyle = WHITE; _ctx.fillRect(tx, y - 9, 10, 10);
      var lines = wrapText(p[0], itemSize, 'medium', cw - pad * 2 - 22);
      for (var k = 0; k < lines.length; k++) drawText(lines[k], tx + 22, y + k * itemGap, itemSize, 'medium', WHITE, 'ls');
      y += itemGap * lines.length;
      if (p[1]) {
        drawText(p[1], tx + 22, y + 3, Number(s.card_sub_size || 15), 'medium', WHITE, 'ls');
        y += 24;
      }
      y += 16;
    });
    ends.push(y - 16);
  });
  if (cards.some(function (c) { return c.note; })) {
    var ruleY = Math.min(top + ch - 74, Math.max.apply(null, ends) + 26);
    cards.forEach(function (card, i) {
      if (!card.note) return;
      var x2 = MX + i * (cw + gap);
      _ctx.fillStyle = WHITE; _ctx.fillRect(x2 + pad, ruleY, cw - pad * 2, 2);
      drawText(card.note, x2 + pad, ruleY + 34, noteSize, 'bold', WHITE, 'ls');
    });
  }
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT', s.__limit || CTM); return s.__limit || CTM; }
  return top + ch;
}

function pBrandPair(s, headLast) {
  var top = contentTopPoint(s, headLast, 48);
  var images = s.images || [], n = images.length || 1;
  var cutout = !!s.cutout;
  var gap = Number(s.gap === undefined ? (cutout ? 52 : 24) : s.gap);
  var cell = (CR - MX - gap * (n - 1)) / n;
  var ih = Number(s.image_height || 300);
  var tdy = Number(s.tag_gap === undefined ? 12 : s.tag_gap);
  function tagAt(x, tag) {
    if (cutout && (s.tag_style === undefined ? 'text' : s.tag_style) === 'text') {
      tracked(tag, x + 2, top - tdy - 6, 16, 'bold', INK, 2);
      return;
    }
    var tw = trackedW(tag, 16, 'bold', 2);
    _ctx.fillStyle = KEY; _ctx.fillRect(x, top - tdy, tw + 26, 32);
    tracked(tag, x + 13, top - tdy + 27, 16, 'bold', WHITE, 2);
  }
  if (cutout) {
    // 누끼는 칸에 가두지 않고 한 덩어리로 묶어 가운데 앉힌다
    var sizes = images.map(function (spec) {
      return cutoutFit(spec.image, CR - MX, ih, Math.min(Number(spec.height || ih), ih));
    });
    var total = sizes.reduce(function (a, q) { return a + q.w; }, 0) + gap * (n - 1);
    var cursor = MX + (((CR - MX - total) / 2) * (s.pack === false ? 0 : 1));
    images.forEach(function (spec, i) {
      var q = sizes[i];
      if (imgOk(q.im)) _ctx.drawImage(q.im, cursor, top + (ih - q.h), q.w, q.h);
      if (spec.tag) tagAt(cursor, spec.tag);
      cursor += q.w + gap;
    });
  } else {
    images.forEach(function (spec, i) {
      var x = MX + i * (cell + gap);
      var tagX = x;
      if (spec.cutout) {
        // 사진이 아니라 투명 누끼(RGBA)면 알파 그대로 얹는다 — 사각 바탕·회색 면이 남지 않는다.
        // `height` 로 제품마다 기준선에 맞춘 높이를 따로 줄 수 있고, 태그는 누끼의 왼쪽 끝에 맞춘다.
        var ch2 = Math.min(Number(spec.height || ih), ih);
        var q2 = cutoutFit(spec.image, cell, ih, ch2);
        if (imgOk(q2.im)) _ctx.drawImage(q2.im, x + (cell - q2.w) / 2, top + ih - q2.h, q2.w, q2.h);
        tagX = x + (cell - q2.w) / 2;
        _ctx.fillStyle = INK; _ctx.fillRect(x, top + ih + 2, cell, 2);
      } else if (spec.framed) drawContain(spec.image, x, top, cell, ih, true);
      else {
        drawContainPlain(spec.image, x, top, cell, ih);
        _ctx.fillStyle = INK; _ctx.fillRect(x, top + ih + 2, cell, 2);
      }
      if (spec.caption) drawText(spec.caption, x, top + ih + 30, 19, 'bold', INK, 'ls');
      if (spec.tag) tagAt(tagX, spec.tag);
    });
  }
  var cap = images[0] && images[0].caption;
  var tableTop = top + ih + (cap ? 58 : 40);
  var spec2 = s.table || {}, cols = spec2.columns || [], rows = spec2.rows || [];
  var ncol = cols.length || 1;
  var raw = (spec2.widths && spec2.widths.length) ? spec2.widths : new Array(ncol).fill(1);
  var tot = raw.reduce(function (a, b) { return a + Number(b); }, 0) || 1;
  var widths = raw.map(function (w) { return Number(w) / tot * (CR - MX); });
  var keyCells = {};
  (spec2.key_cells || []).forEach(function (cc) { keyCells[cc[0] + ',' + cc[1]] = true; });
  var headH = Number(spec2.head_height || 46);
  _ctx.fillStyle = INK; _ctx.fillRect(MX, tableTop, CR - MX, headH);
  var fh = Number(spec2.head_size || 19), x2 = MX;
  cols.forEach(function (c, j) {
    drawText(c, x2 + 20, tableTop + headH / 2, fh, 'bold', WHITE, 'lm');
    x2 += widths[j];
  });
  var listTop = tableTop + headH;
  var rowH = (CTM - listTop) / Math.max(1, rows.length);
  var size = Number(spec2.cell_size || 22);
  while (size > 16) {
    var ok = true;
    for (var r = 0; r < rows.length && ok; r++) {
      for (var j = 0; j < rows[r].length; j++) {
        var parts = String(rows[r][j]).split('\n');
        for (var p = 0; p < parts.length; p++) if (measure(parts[p], size, 'medium') > widths[j] - 30) { ok = false; break; }
        if (!ok) break;
      }
    }
    if (ok) break;
    size -= 1;
  }
  var lead = Math.round(size * 1.34);
  for (var i = 0; i < rows.length; i++) {
    var y0 = listTop + rowH * i, cy = y0 + rowH / 2;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1);
    var x3 = MX;
    for (var j2 = 0; j2 < rows[i].length; j2++) {
      var cellLines = String(rows[i][j2]).split('\n');
      var hot = keyCells[i + ',' + j2];
      var color = hot ? KEY : INK;
      var wt = hot || j2 === 0 ? 'bold' : 'medium';
      var ty = cy - lead * (cellLines.length - 1) / 2;
      for (var k = 0; k < cellLines.length; k++) {
        var fnt2 = k === 0 ? wt : (hot ? 'bold' : 'medium');
        var sz = k === 0 ? size : Math.max(16, size - 3);
        drawText(cellLines[k], x3 + 20, ty + k * lead, sz, fnt2, color, 'lm');
      }
      x3 += widths[j2];
    }
  }
  _ctx.fillStyle = INK; _ctx.fillRect(MX, CTM, CR - MX, 2);
  return CTM;
}

function pBrandWide(s, headLast) {
  var top = contentTopPoint(s, headLast, 46);
  var spec = s.image || {};
  var iw = Number(s.image_width || 340), ih = Number(s.image_height || 430);
  if (spec.logo) {
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, top, iw, ih);
    var im = getImage(spec.image);
    if (imgOk(im)) {
      var lw = Math.round(iw * 0.72), lh = Math.max(1, Math.round(im.naturalHeight * lw / im.naturalWidth));
      // 흰색으로 그리기
      var off = document.createElement('canvas');
      off.width = lw; off.height = lh;
      var oc = off.getContext('2d');
      oc.drawImage(im, 0, 0, lw, lh);
      oc.globalCompositeOperation = 'source-in';
      oc.fillStyle = WHITE; oc.fillRect(0, 0, lw, lh);
      var ly = top + Math.round(ih * 0.40);
      _ctx.drawImage(off, MX + (iw - lw) / 2, ly);
      _ctx.fillStyle = WHITE;
      _ctx.fillRect(MX + (iw - lw) / 2, ly + lh + 28, lw, 3);
      var wrapped = [];
      (spec.lines || []).forEach(function (ln) { wrapped = wrapped.concat(wrapText(ln, 15, 'bold', iw - 56)); });
      var by = top + ih - 40;
      wrapped.slice().reverse().forEach(function (ln, k) {
        tracked(ln, MX + 30, by - k * 30, 15, 'bold', WHITE, 1);
      });
    }
  } else {
    drawContainPlain(spec.image, MX, top, iw, ih);
    _ctx.fillStyle = INK; _ctx.fillRect(MX, top + ih + 2, iw, 2);
  }
  var capBottom = top + ih;
  if (spec.caption && !spec.logo) {
    var lines = wrapText(spec.caption, 18, 'medium', iw);
    for (var k2 = 0; k2 < lines.length; k2++) drawText(lines[k2], MX, top + ih + 34 + k2 * 25, 18, 'medium', KEY, 'ls');
    capBottom = top + ih + 34 + 25 * (lines.length - 1);
  }
  var colX = MX + iw + 46, colW = CR - colX, y = top;
  var bandH = s.takeaway ? 112 : 0;
  var limit = CTM - (bandH ? bandH + 30 : 0);
  (s.blocks || []).forEach(function (block) {
    tracked(block.label || '', colX, y + 16, 17, 'bold', KEY, 2);
    var size = Number(block.size || 22);
    var lines2 = wrapText(block.text || '', size, block.bold ? 'bold' : 'medium', colW);
    var gap = Math.round(size * 1.55);
    for (var k3 = 0; k3 < lines2.length; k3++) drawText(lines2[k3], colX, y + 56 + k3 * gap, size, block.bold ? 'bold' : 'medium', INK, 'ls');
    y = y + 56 + gap * lines2.length + Number(s.block_gap === undefined ? 40 : s.block_gap);
  });
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT'); return CTM; }
  return Math.max(capBottom, y);
}

function noteBlock(s, noteH, note, withKeyBar, limit) {
  var ny = (limit || CTM) - noteH;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, ny, CR - MX, noteH);
  if (withKeyBar) { _ctx.fillStyle = KEY; _ctx.fillRect(MX, ny, 8, noteH); }
  var label = s.note_label === undefined ? 'POINT' : String(s.note_label);
  if (label) {
    var kc = String(KEY).replace('#', '');
    var rr = parseInt(kc.slice(0, 2), 16) / 255, gg = parseInt(kc.slice(2, 4), 16) / 255, bb = parseInt(kc.slice(4, 6), 16) / 255;
    var lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    tracked(label, MX + 32, ny + 26, 15, 'bold', (!withKeyBar || lum <= 0.15) ? WHITE : KEY, 3);
  }
  var base = ny + (label ? 62 : 50);
  var lines = wrapText(note, 21, 'bold', CR - MX - 64);
  for (var i = 0; i < lines.length; i++) drawText(lines[i], MX + 32, base + i * 30, 21, 'bold', WHITE, 'ls');
}

function pList(s, headLast) {
  var top = contentTopPoint(s, headLast, 56);
  var items = s.items || [], note = s.note || '', noteH = 0;
  if (note) noteH = 34 + 30 * wrapText(note, 21, 'bold', CR - MX - 64).length + 28;
  var lim = s.__limit || CTM;
  var avail = lim - noteH - 20 - top;
  var step = avail / Math.max(1, items.length);
  var bodySize = 21, bodyGap = 31;
  [21, 20, 19, 18, 17].some(function (bs) {
    var lh = Math.round(bs * 1.48);
    var fits = items.every(function (it) {
      return 70 + lh * (wrapText(it.body || '', bs, 'regular', CR - MX - 88).length - 1) <= step - 44;
    });
    if (fits) { bodySize = bs; bodyGap = lh; return true; }
    return false;
  });
  items.forEach(function (item, i) {
    var y = top + step * i;
    drawText(pad2(i + 1), MX, y + 44, 40, 'extrabold', KEY, 'ls');
    drawText(item.title, MX + 88, y + 30, 27, 'bold', INK, 'ls');
    var lines = wrapText(item.body || '', bodySize, 'regular', CR - MX - 88);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], MX + 88, y + 70 + k * bodyGap, bodySize, 'regular', INK, 'ls');
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y + step - 26, CR - MX, 1);
  });
  if (note) noteBlock(s, noteH, note, false, lim);
  return lim;
}

/* 제품 한 줄 비교 — 성분 계열 · 제품 누끼 · 허가 분류 (파이썬 make_lineup 과 같은 좌표) */
function pLineup(s, headLast) {
  if (s.layout === 'rows') return pLineupRows(s, headLast);
  if (s.layout === 'table') return pLineupTable(s, headLast);
  var items = s.products || [], n = Math.max(1, items.length);
  var lim = s.__limit || CTM;
  var bandH = s.takeaway ? 112 : 0;
  var famY = Math.max(headLast + Number(s.gap_after_head === undefined ? 34 : s.gap_after_head), 0) + 30;
  var base = lim - bandH - (bandH ? 150 : 112);
  var imgH = base - (famY + 30);
  var colW = (CR - MX) / n;
  var famSize = Number(s.family_size || 15), nameSize = Number(s.name_size || 19), clsSize = Number(s.class_size || 15);
  var i = 0;
  while (i < n) {
    var fam = items[i].family || '', j = i;
    while (j + 1 < n && (items[j + 1].family || '') === fam) j++;
    _ctx.fillStyle = KEY;
    _ctx.fillRect(MX + colW * i + 10, famY - 26, colW * (j - i + 1) - 20, 2);
    i = j + 1;
  }
  items.forEach(function (it, k) {
    var cx = MX + colW * (k + 0.5);
    if (it.family) drawText(it.family, cx, famY, famSize, 'bold', KEY_TEXT, 'ms');
    /* 제품마다 좌우 여백(gap)·높이(height, px)·배율(scale)을 따로 줄 수 있다(파이썬 make_lineup 과 같은 규칙) */
    var gap = it.gap === undefined ? 34 : (Number(it.gap) || 0);
    var maxW = Math.round(colW - gap);
    var wantH = it.height === undefined ? null : Math.min(Number(it.height) || imgH, imgH);
    var f = wantH ? cutoutFit(it.image, maxW, wantH, wantH) : cutoutFit(it.image, maxW, imgH, null);
    var sc = it.scale === undefined ? 1 : (Number(it.scale) || 1);
    if (sc !== 1) { f.w = Math.max(1, Math.round(f.w * sc)); f.h = Math.max(1, Math.round(f.h * sc)); }
    if (imgOk(f.im)) _ctx.drawImage(f.im, cx - f.w / 2, base - 8 - f.h, f.w, f.h);
    else placeholder(it.image, cx - maxW / 2, base - 8 - imgH, maxW, imgH);
  });
  _ctx.fillStyle = INK; _ctx.fillRect(MX, base, CR - MX, 1);
  var ny = base + 30;
  items.forEach(function (it, k) {
    var cx = MX + colW * (k + 0.5);
    var lines = wrapText(it.name || '', nameSize, 'bold', Math.round(colW - 18)).slice(0, 2);
    for (var li = 0; li < lines.length; li++)
      drawText(lines[li], cx, ny + li * Math.round(nameSize * 1.22), nameSize, 'bold', INK, 'ms');
    if (it.class) drawText(it.class, cx, ny + Math.round(nameSize * 1.22) * 2 + 6, clsSize, 'bold', KEY_TEXT, 'ms');
  });
  var bottom = ny + Math.round(nameSize * 1.22) * 2 + clsSize + 12;
  if (s.takeaway) takeaway(s.takeaway, bandH, s.takeaway_label || 'POINT', lim);
  return bottom;
}

/* 제품을 행으로 — 제형 스와치 + 제품명·허가 분류 + 포장/사용/제형 (파이썬 make_lineup_rows 와 같은 좌표) */
function pLineupRows(s, headLast) {
  var items = s.products || [], n = Math.max(1, items.length);
  var lim = s.__limit || CTM;
  var top = Math.max(headLast + Number(s.gap_after_head === undefined ? 26 : s.gap_after_head), 0);
  var rowH = (lim - top) / n;
  var swW = Number(s.swatch_w || 150), swH = Number(s.swatch_h || 108);
  var textX = MX + swW + 18;
  var nameSize = Number(s.name_size || 25), metaSize = Number(s.class_size || 14);
  var specSize = Number(s.spec_size || 17), labelSize = Number(s.spec_label_size || 13);
  var labelW = Number(s.spec_label_w || 54);
  var nameTop = Number(s.name_top === undefined ? 38 : s.name_top);
  var specTop = Number(s.spec_top === undefined ? 76 : s.spec_top);
  var specGap = Number(s.spec_gap || 26);
  items.forEach(function (it, k) {
    var y0 = top + rowH * k;
    if (k) { _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1); }
    if (it.image) drawContain(it.image, MX, y0 + (rowH - swH) / 2, swW, swH, false);
    drawText(it.name || '', textX, y0 + nameTop, nameSize, 'bold', INK, 'ls');
    var meta = [it.family, it.class].filter(function (v) { return !!v; }).join(' · ');
    if (meta) drawText(meta, CR, y0 + nameTop, metaSize, 'bold', KEY_TEXT, 'rs');
    (it.spec || []).slice(0, 3).forEach(function (sp, j) {
      var by = y0 + specTop + j * specGap;
      if (sp.label) drawText(sp.label, textX, by, labelSize, 'bold', KEY, 'ls');
      drawText(sp.value || '', textX + labelW, by, specSize, 'medium', INK, 'ls');
    });
  });
  return top + rowH * n;
}

/* 제품 5종 비교 표 — 제형 / 제품·허가 / 포장·사용 / 구매처·사용대상 (파이썬 make_lineup_table 과 같은 좌표) */
function pLineupTable(s, headLast) {
  var items = s.products || [], n = Math.max(1, items.length);
  var lim = s.__limit || CTM;
  var bandH = s.takeaway ? 112 : 0;
  /* 표 위 여백은 28~56px 범위 고정 — 앞 블록 잉크 아래에서 잰다 (2026-11-24) */
  var prevInkL = headLast;
  if (s.body) {
    var bsL = Number(s.body_size || 24);
    prevInkL = headLast - (Math.round(bsL * 1.62) - inkSpan(bsL, 'regular').bottom);
  } else {
    prevInkL = headLast + inkSpan(Number(s.__headSize || 62), 'extrabold').bottom;
  }
  var top = Math.max(prevInkL + clampGap(s.gap_after_head === undefined ? GAP_DEFAULT : s.gap_after_head), 0);
  var headH = Number(s.head_row_h === undefined ? 54 : s.head_row_h);
  var swW = Number(s.swatch_w === undefined ? 168 : s.swatch_w), swH = Number(s.swatch_h === undefined ? 96 : s.swatch_h);
  var gapA = Number(s.gap_a === undefined ? 12 : s.gap_a), nameW = Number(s.name_w === undefined ? 196 : s.name_w);
  var gapB = Number(s.gap_b === undefined ? 20 : s.gap_b), specW = Number(s.spec_w === undefined ? 250 : s.spec_w);
  var gapC = Number(s.gap_c === undefined ? 14 : s.gap_c);
  var nameSize = Number(s.name_size === undefined ? 21 : s.name_size), clsSize = Number(s.class_size === undefined ? 14 : s.class_size);
  var specSize = Number(s.spec_size === undefined ? 17 : s.spec_size), labelSize = Number(s.spec_label_size === undefined ? 14 : s.spec_label_size);
  var labelW = Number(s.spec_label_w === undefined ? 56 : s.spec_label_w);
  var headSize = Number(s.head_row_size === undefined ? 15 : s.head_row_size);
  var lineGap = Number(s.line_gap === undefined ? 32 : s.line_gap), tint = s.zebra || '';
  var specRows = Number(s.spec_rows === undefined ? 2 : s.spec_rows);   /* 열마다 두 줄 */
  var xSw = MX, xName = xSw + swW + gapA, xSpec = xName + nameW + gapB, xSpec2 = xSpec + specW + gapC;

  var heads = [[s.col_swatch || '제형', xSw], [s.col_product || '제품 · 허가', xName],
               [s.col_pack || '포장 · 사용', xSpec], [s.col_buy || '구매처 · 사용대상', xSpec2]];
  var rowsTop;
  if (String(s.head_style || 'rule') === 'band') {
    var bandTop = top + Number(s.head_band_y || 0);
    _ctx.fillStyle = INK; _ctx.fillRect(MX, bandTop, CR - MX, headH);
    var bandSize = Number(s.head_band_size === undefined ? 21 : s.head_band_size);
    var pad = Number(s.head_band_pad === undefined ? 20 : s.head_band_pad);
    heads.forEach(function (h, i) {
      drawText(String(h[0]), h[1] + (i === 0 ? pad : 0), bandTop + headH / 2, bandSize, 'bold', WHITE, 'lm');
    });
    rowsTop = bandTop + headH;
  } else {
    heads.forEach(function (h) { tracked(String(h[0]), h[1], top + 15, headSize, 'bold', KEY_TEXT, 0.8); });
    _ctx.fillStyle = INK; _ctx.fillRect(MX, top + 25, CR - MX, 1);
    rowsTop = top + headH;
  }
  var rowH = (lim - bandH - (bandH ? GAP_MIN : 0) - rowsTop) / n;
  for (var k = 0; k < n; k++) {
    if (tint && k % 2 === 1) {
      _ctx.fillStyle = tint;
      _ctx.fillRect(MX, Math.round(rowsTop + rowH * k), CR - MX, Math.round(rowH));
    }
  }

  /* 행 안 글자 블록의 잉크 위·아래 여백을 같게 (파이썬 make_lineup_table 과 같은 식) */

  items.forEach(function (it, k) {
    var y0 = rowsTop + rowH * k;
    if (it.image) {
      var sc = it.scale === undefined ? 1 : (Number(it.scale) || 1);
      var boxW = swW * sc, boxH = swH * sc;
      drawContain(it.image, xSw + (swW - boxW) / 2, y0 + (rowH - boxH) / 2, boxW, boxH, false);
    }
    var nameLines = wrapText(it.name || '', nameSize, 'bold', nameW).slice(0, 2);
    var nLines = nameLines.length + 1;          /* 제품명 줄 + 성분·허가 줄 */
    var b1 = blockBase(nameSize, 'bold', y0, y0 + rowH, nLines, lineGap, clsSize, 'bold');
    for (var li = 0; li < nameLines.length; li++)
      drawText(nameLines[li], xName, b1 + li * lineGap, nameSize, 'bold', INK, 'ls');
    var meta = [it.family, it.class].filter(function (v) { return !!v; }).join(' · ');
    if (meta)
      drawText(meta, xName, b1 + nameLines.length * lineGap, clsSize, 'bold', KEY_TEXT, 'ls');
    /* 포장·사용 은 왼쪽 열, 구매처·사용대상 은 오른쪽 열 — `제형` 은 왼쪽 스와치가 맡는다 */
    var specs = (it.spec || []).filter(function (sp) { return String(sp.label || '') !== '제형'; });
    [[xSpec, specs.slice(0, specRows)], [xSpec2, specs.slice(specRows, specRows * 2)]].forEach(function (col) {
      col[1].forEach(function (sp, j) {
        var by = b1 + j * lineGap;
        if (sp.label) drawText(sp.label, col[0], by, labelSize, 'bold', KEY, 'ls');
        drawText(sp.value || '', col[0] + labelW, by, specSize, 'medium', INK, 'ls');
      });
    });
  });

  _ctx.fillStyle = INK;
  _ctx.fillRect(MX, Math.round(rowsTop + rowH * n), CR - MX, 1);
  if (s.takeaway) takeaway(s.takeaway, bandH, s.takeaway_label || 'POINT', lim);
  return rowsTop + rowH * n;
}

/* 직접 만든 도해 이미지 한 장 — 사슬 길이·입자 비교 (파이썬 make_figure 와 같은 좌표) */
function pFigure(s, headLast) {
  var fig = s.figure || {};
  var lim = s.__limit || CTM;
  var bandH = s.takeaway ? 112 : 0;
  var top = headLast + Number(s.gap_after_head === undefined ? 40 : s.gap_after_head);
  var availH = lim - bandH - (bandH ? 30 : 0) - top;
  var h = Number(fig.h || availH), w = CR - MX;
  var im = getImage(fig.image), bottom = top + h;
  if (imgOk(im)) {
    var r = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
    _ctx.drawImage(im, MX + (w - nw) / 2, top + (h - nh) / 2, nw, nh);
    bottom = top + Math.max(h, nh);
  } else {
    placeholder(fig.image, MX, top, w, h);
  }
  if (s.caption) { drawText(String(s.caption), MX, bottom + 22, 16, 'medium', INK, 'ls'); bottom += 22; }
  if (s.takeaway) takeaway(s.takeaway, bandH, s.takeaway_label || 'POINT', lim);
  return bottom;
}

function pReasons(s, headLast) {
  var top = contentTopPoint(s, headLast, 52);
  var items = s.items || [], note = s.note || '', noteH = 0;
  var label = note ? (s.note_label === undefined ? 'POINT' : String(s.note_label)) : '';
  if (note) {
    var nl = wrapText(note, 21, 'bold', CR - MX - 64).length;
    noteH = (label ? 62 : 50) + 30 * (nl - 1) + 30;
  }
  var avail = CTM - noteH - 18 - top;
  var numX = MX + 28, colX = MX + 132;
  var colW = CR - colX;
  var blocks = [], size = 21, gap = 31;
  var tries = [21, 20, 19, 18, 17];
  for (var t = 0; t < tries.length; t++) {
    size = tries[t]; gap = Math.round(size * 1.48);
    blocks = items.map(function (it) {
      var lines = wrapText(it.body || '', size, 'regular', colW);
      return { lines: lines, h: 82 + gap * (lines.length - 1) + 24 };
    });
    var sum = blocks.reduce(function (a, b) { return a + b.h; }, 0);
    if (sum <= avail) break;
  }
  var step = avail / Math.max(1, items.length);
  var y = top;
  items.forEach(function (item, i) {
    var b = blocks[i], blk = Math.max(b.h, step);
    var barH = Math.min(blk - 34, 132);
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, y + 4, 7, barH);
    drawText(pad2(i + 1), numX, y + 60, 50, 'extrabold', KEY, 'ls');
    drawText(item.title, colX, y + 38, 31, 'bold', INK, 'ls');
    for (var k = 0; k < b.lines.length; k++) drawText(b.lines[k], colX, y + 82 + k * gap, size, 'regular', INK, 'ls');
    var ry = y + blk - 16;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, ry, CR - MX, 1);
    y += blk;
  });
  if (note) noteBlock(s, noteH, note, true);
  return CTM;
}

function pBars(s, headLast) {
  var spec = s.chart || {}, items = spec.items || [];
  var top = contentTopPoint(s, headLast, 44);
  if (s.body) top = bodyBlock(s, top + 8, s.body_size || 22) + 30;
  var lx = MX, ly = top;
  var inkFirst = !!spec.legend_ink_first;
  var firstLabel = inkFirst ? (spec.ink_label || '코스메틱 크림') : (spec.key_label || 'MD 크림');
  var firstKey = !inkFirst;
  var secondLabel = inkFirst ? (spec.key_label || 'MD 크림') : (spec.ink_label || '코스메틱 크림');
  var secondKey = inkFirst;
  _ctx.fillStyle = firstKey ? KEY : INK; _ctx.fillRect(lx, ly, 20, 20);
  drawText(firstLabel, lx + 32, ly + 10, 20, 'bold', INK, 'lm');
  var lx2 = lx + 32 + measure(firstLabel, 20, 'bold') + 44;
  _ctx.fillStyle = secondKey ? KEY : INK; _ctx.fillRect(lx2, ly, 20, 20);
  drawText(secondLabel, lx2 + 32, ly + 10, 20, 'bold', INK, 'lm');

  var chartTop = ly + 66, note = spec.note || '', noteH = 0;
  if (note) noteH = 30 * wrapText(note, 20, 'medium', CR - MX).length + 26;
  var band = s.takeaway ? 142 : 0;
  var avail = CTM - band - noteH - chartTop;
  var rowH = Math.min(Number(spec.row_height || 96), avail / Math.max(1, items.length));
  var labW = Number(spec.label_width || 300), valW = Number(spec.value_width || 150);
  var barX0 = MX + labW, barW = CR - barX0 - valW;
  var maxv = 1;
  items.forEach(function (it) { maxv = Math.max(maxv, Number(it.value) || 0); });
  var bh = Math.min(30, rowH * 0.42);
  items.forEach(function (it, i) {
    var cy = chartTop + rowH * i + rowH / 2;
    drawText(it.label, barX0 - 22, cy, 22, 'bold', INK, 'rm');
    var w = Math.max(4, (Number(it.value) || 0) / maxv * barW);
    _ctx.fillStyle = it.key ? KEY : INK;
    _ctx.fillRect(barX0, cy - bh / 2, w, bh);
    drawText(it.display, CR, cy, 23, 'bold', it.key ? KEY : INK, 'rm');
  });
  var axisY = chartTop + rowH * items.length;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, axisY, CR - MX, 2);
  if (note) {
    var lines = wrapText(note, 20, 'medium', CR - MX);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], MX, axisY + 40 + k * 30, 20, 'medium', INK, 'ls');
  }
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT'); return CTM; }
  return axisY + noteH;
}

/* ---------------------------------------------------------------- 7. 뷰티 테크 장표 */
function headBlockTech(slide) {
  labelPoint(slide.label || '');
  var maxW = CR - MX;
  var size = Number(slide.head_size || 60);
  var lines = headlineLines(slide);
  while (size > 34 && headlineWidth(lines, size, 'extrabold') > maxW) size -= 2;
  var gap = Math.round(size * 1.22), first = 272;
  drawHeadlines(lines, MX, first, gap, size, { ink: INK, gray: GRAY_EMPH });
  return { last: first + gap * (lines.length - 1), size: size };
}
function bodyTextTech(text, y, size, maxW, color, weight) {
  size = Number(size || 24);
  var lines = wrapText(text || '', size, weight || 'regular', maxW || (CR - MX));
  var gap = Math.round(size * 1.55);
  for (var i = 0; i < lines.length; i++) drawText(lines[i], MX, y + i * gap, size, weight || 'regular', color || INK, 'ls');
  return lines.length ? y + gap * (lines.length - 1) : y;
}
function bandPhoto(spec, x0, y0, w, h, zoom, focusY) {
  var im = getImage(spec.image);
  if (!imgOk(im)) { placeholder(spec.image, x0, y0, w, h); return { scale: 1, left: 0, top: 0, k: 1 }; }
  var sw = im.naturalWidth, sh = im.naturalHeight, target = w / h, z = zoom || 1;
  var meta = META[spec.image];
  var k = meta && meta[0] ? im.naturalWidth / meta[0] : 1;   // 원본 → 내장 축소 배율
  var ch = Math.min(sh, sw / target) / z, cw = ch * target;
  if (cw > sw) { cw = sw; ch = cw / target; }
  if (ch > sh) { ch = sh; cw = ch * target; }
  var fy = clamp01(spec.focus_y === undefined ? (focusY === undefined ? 0.5 : focusY) : spec.focus_y);
  var fx = clamp01(spec.focus === undefined ? 0.5 : spec.focus);
  var left = (sw - cw) * fx, top = (sh - ch) * fy;
  _ctx.drawImage(im, left, top, cw, ch, x0, y0, w, h);
  return { scale: w / cw, left: left, top: top, k: k };
}
function numBadge(x, y, size, text) {
  _ctx.fillStyle = KEY; _ctx.fillRect(x, y, size, size);
  drawText(text, x + size / 2, y + size / 2 + 2, Math.round(size * 0.46), 'extrabold', WHITE, 'mm');
}

function tPoints(s, headLast) {
  var top = contentTopPoint(s, headLast, 40);
  if (s.body) top = bodyTextTech(s.body, top + 4, s.body_size || 22) + 34;
  var pts = s.points || [], numW = 56, colW = CR - MX - numW;
  var limit = CTM - (s.takeaway ? 120 : 0);
  var measured = pts.map(function (p) {
    var size = Number(p.size || 20);
    var lines = wrapText(p.text || '', size, 'medium', colW);
    var gap = Math.round(size * 1.5);
    var h = 84 + gap * (lines.length - 1) + 34;
    return { lines: lines, gap: gap, h: h, size: size };
  });
  var sum = 0; measured.forEach(function (m) { sum += m.h; });
  var avail = limit - top;
  var extra = Math.max(0, Math.min(40, (avail - sum) / Math.max(1, pts.length)));
  var y = top;
  pts.forEach(function (p, i) {
    var m = measured[i], hh = m.h + extra;
    drawText(p.num || pad2(i + 1), MX, y + 40, 22, 'bold', KEY, 'ls');
    drawText(p.title, MX + numW, y + 42, 30, 'extrabold', INK, 'ls');
    for (var k = 0; k < m.lines.length; k++) drawText(m.lines[k], MX + numW, y + 84 + k * m.gap, m.size, 'medium', INK, 'ls');
    var end = y + hh;
    if (i < pts.length - 1) { _ctx.fillStyle = INK; _ctx.fillRect(MX, end - 1, CR - MX, 1); }
    y = end;
  });
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tBand(s, headLast) {
  var top;
  if (s.lead) {
    var ls = Number(s.lead_size || 21);
    var leadLines = wrapText(s.lead, ls, 'medium', CR - MX);
    var lhg = Math.round(ls * 1.55);
    for (var li = 0; li < leadLines.length; li++) drawText(leadLines[li], MX, headLast + 44 + li * lhg, ls, 'medium', INK, 'ls');
    top = headLast + 44 + lhg * (leadLines.length - 1) + 26;
  } else top = headLast + Number(s.gap_after_head === undefined ? 34 : s.gap_after_head);
  var bandH = Number(s.band_height || 470);
  var geo = bandPhoto(s.image || {}, 0, top, W, bandH, Number((s.image || {}).zoom || s.zoom || 1), Number(s.focus_y === undefined ? 0.5 : s.focus_y));
  (s.markers || []).forEach(function (mk) {
    var mx = (Number(mk.x) * geo.k - geo.left) * geo.scale;
    var my = top + (Number(mk.y) * geo.k - geo.top) * geo.scale;
    var r = Number(mk.r || 17);
    _ctx.fillStyle = WHITE;
    _ctx.beginPath(); _ctx.arc(mx, my, r, 0, Math.PI * 2); _ctx.fill();
    drawText(mk.num, mx, my + 1, Math.round(r * 0.95), 'extrabold', KEY, 'mm');
  });
  _ctx.fillStyle = KEY; _ctx.fillRect(0, top, W, 4); _ctx.fillRect(0, top + bandH - 4, W, 4);
  var legend = s.legend || [], ly = top + bandH + 30;
  var rowH = Math.min(92, (CTM + 4 - ly) / Math.max(1, legend.length));
  legend.forEach(function (item, i) {
    var y = ly + rowH * i;
    drawText(item.num || pad2(i + 1), MX, y + 20, 17, 'bold', KEY, 'ls');
    drawText(item.title, MX + 44, y + 24, 22, 'bold', INK, 'ls');
    var lines = wrapText(item.desc || '', 17, 'medium', CR - MX - 44);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], MX + 44, y + 52 + k * 25, 17, 'medium', INK, 'ls');
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y + rowH - 8, CR - MX, 1);
  });
  return CTM;
}

function calloutDot(mx, my, r, text) {
  _ctx.fillStyle = WHITE;
  _ctx.beginPath(); _ctx.arc(mx, my, r, 0, Math.PI * 2); _ctx.fill();
  drawText(text, mx, my + 1, Math.round(r * 0.92), 'extrabold', KEY, 'mm');
}

function tSplit(s, headLast) {
  var top;
  if (s.lead) {
    var ls = Number(s.lead_size || 21);
    var leadLines = wrapText(s.lead, ls, 'medium', CR - MX);
    var lhg = Math.round(ls * 1.55);
    for (var li = 0; li < leadLines.length; li++) drawText(leadLines[li], MX, headLast + 44 + li * lhg, ls, 'medium', INK, 'ls');
    top = headLast + 44 + lhg * (leadLines.length - 1) + 26;
  } else top = headLast + Number(s.gap_after_head === undefined ? 40 : s.gap_after_head);
  var spec = s.image || {};
  var iw = Number(s.image_width || 430), ih = Number(s.image_height || 470);
  var right = s.image_side === 'right';
  var ix = right ? (CR - iw) : (s.bleed_left ? 0 : MX);
  var iwFull = iw + ((!right && ix === 0) ? MX : 0);
  var geo = bandPhoto(spec, ix, top, iwFull, ih,
                      Number(spec.zoom || 1), Number(spec.focus_y === undefined ? 0.5 : spec.focus_y));
  if (s.frame) {
    _ctx.strokeStyle = INK; _ctx.lineWidth = 1; _ctx.strokeRect(ix + 0.5, top + 0.5, iw - 1, ih - 1);
  }
  (s.markers || []).forEach(function (mk) {
    var mx = ix + (Number(mk.x) * geo.k - geo.left) * geo.scale;
    var my = top + (Number(mk.y) * geo.k - geo.top) * geo.scale;
    calloutDot(mx, my, Number(mk.r || 17) * Number(mk.scale || 1), mk.num);
  });
  if (s.image_caption) {
    var cf = Number(s.caption_size || 15);
    var capLines = wrapText(s.image_caption, cf, 'medium', iw);
    for (var ci = 0; ci < capLines.length; ci++) drawText(capLines[ci], ix, top + ih + 30 + ci * 24, cf, 'medium', INK, 'ls');
  }
  var colX, colW;
  if (right) { colX = MX; colW = CR - iw - 48 - MX; }
  else { colX = MX + iwFull + 48; colW = CR - colX; }
  var y = top;
  var limit = CTM - (s.takeaway ? 120 : 0);
  var blocks = s.blocks || [];
  var measured = blocks.map(function (block) {
    var sz = Number(block.size || 21);
    var ln = wrapText(block.text || '', sz, 'medium', colW);
    var gp = Math.round(sz * 1.52);
    return { block: block, size: sz, lines: ln, gap: gp, h: 52 + gp * ln.length };
  });
  var baseGap = Number(s.block_gap === undefined ? 34 : s.block_gap);
  var n = measured.length;
  var sumH = measured.reduce(function (a, m) { return a + m.h; }, 0);
  var spare = limit - y - sumH - baseGap * Math.max(0, n - 1);
  var add = n > 1 ? Math.max(0, Math.min(36, spare / (n - 1))) : 0;
  measured.forEach(function (m) {
    tracked(m.block.label || '', colX, y + 14, 17, 'bold', KEY, 3);
    for (var k = 0; k < m.lines.length; k++) drawText(m.lines[k], colX, y + 52 + k * m.gap, m.size, 'medium', INK, 'ls');
    y = y + m.h + baseGap + add;
  });
  if (s.note) {
    var nf = Number(s.note_size || 18);
    var ny = y + Number(s.note_gap === undefined ? 16 : s.note_gap);
    _ctx.fillStyle = INK; _ctx.fillRect(colX, ny - 22, colW, 1);
    var nlines = wrapText(s.note, nf, 'medium', colW - 6);
    for (var ni = 0; ni < nlines.length; ni++) drawText(nlines[ni], colX, ny + ni * 27, nf, 'medium', INK, 'ls');
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tDuo(s, headLast) {
  var top;
  if (s.lead) {
    var ls = Number(s.lead_size || 21);
    var leadLines = wrapText(s.lead, ls, 'medium', CR - MX);
    var lhg = Math.round(ls * 1.55);
    for (var li = 0; li < leadLines.length; li++) drawText(leadLines[li], MX, headLast + 44 + li * lhg, ls, 'medium', INK, 'ls');
    top = headLast + 44 + lhg * (leadLines.length - 1) + 30;
  } else top = headLast + Number(s.gap_after_head === undefined ? 34 : s.gap_after_head);
  var panels = s.panels || [], n = panels.length;
  var gap = Number(s.gap === undefined ? 16 : s.gap);
  var pw = (CR - MX - gap * (n - 1)) / n, ih = Number(s.image_height || 340);
  var size = Number(s.text_size || 17), lhg2 = Math.round(size * 1.52);
  var maxBottom = top + ih + 34;
  panels.forEach(function (p, i) {
    var x = MX + i * (pw + gap);
    var spec = p.image || {};
    var geo = bandPhoto(spec, x, top, Math.round(pw), ih, Number(spec.zoom || 1),
                        Number(spec.focus_y === undefined ? 0.5 : spec.focus_y));
    (p.markers || []).forEach(function (mk) {
      var mx = x + (Number(mk.x) * geo.k - geo.left) * geo.scale;
      var my = top + (Number(mk.y) * geo.k - geo.top) * geo.scale;
      calloutDot(mx, my, Number(mk.r || 17) * Number(mk.scale || 1), mk.num);
    });
    calloutDot(x + 26, top + 26, Number(s.badge_r || 18), p.num || pad2(i + 1));
    var cy = top + ih + 34;
    drawText(p.title || '', x, cy, Number(p.title_size || 27), 'extrabold', INK, 'ls');
    if (p.tag) tracked(p.tag, x, cy + 28, 13, 'bold', KEY, 2);
    var lines = wrapText(p.text || '', size, 'medium', Math.round(pw));
    for (var k = 0; k < lines.length; k++) drawText(lines[k], x, cy + 62 + k * lhg2, size, 'medium', INK, 'ls');
    maxBottom = Math.max(maxBottom, cy + 62 + lhg2 * (lines.length - 1));
  });
  if (s.note) {
    var y = maxBottom + Number(s.note_gap === undefined ? 34 : s.note_gap);
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y - 24, CR - MX, 1);
    var nl = wrapText(s.note, 19, 'medium', CR - MX - 8);
    for (var ni = 0; ni < nl.length; ni++) drawText(nl[ni], MX, y + ni * 29, 19, 'medium', INK, 'ls');
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tTable(s, headLast) {
  var spec = s.table || {}, cols = spec.columns || [], rows = spec.rows || [];
  /* 표 위·아래 여백을 같은 값으로 (파이썬 make_table 과 같은 식, 2026-11-24) */
  var gap = clampGap(spec.table_gap === undefined ? (s.table_gap === undefined ? GAP_DEFAULT : s.table_gap) : spec.table_gap);
  var ncol = cols.length || 1;
  var raw = (spec.widths && spec.widths.length) ? spec.widths : new Array(ncol).fill(1);
  var tot = raw.reduce(function (a, b) { return a + Number(b); }, 0) || 1;
  var widths = raw.map(function (w) { return Number(w) / tot * (CR - MX); });
  var keyCells = {};
  (spec.key_cells || []).forEach(function (cc) { keyCells[cc[0] + ',' + cc[1]] = true; });
  var headH = Number(spec.head_height || 52);
  /* 앞 요소(헤드라인·본문)의 잉크 아래 끝 — 여기서 28~56px를 띄운다 */
  var prevBottom = headLast + inkSpan(Number(s.__headSize || 60), 'extrabold').bottom;
  if (s.body) {
    var bodySizeT = Number(s.body_size || 22);
    var bodyY = headLast + Number(s.gap_after_head === undefined ? 44 : s.gap_after_head) + 10;
    prevBottom = bodyTextTech(s.body, bodyY, bodySizeT) + inkSpan(bodySizeT, 'regular').bottom;
  }
  var note = s.note || '';
  var noteLines = note ? wrapText(note, 18, 'medium', CR - MX) : [];
  var noteH = 0;
  if (noteLines.length) noteH = (inkSpan(18, 'medium').bottom - inkSpan(18, 'medium').top) + 27 * (noteLines.length - 1);
  var bandH = s.takeaway ? 130 : 0;
  var sizeT = Number(spec.cell_size || 22);
  while (sizeT > 15) {
    var okwT = true;
    for (var r0 = 0; r0 < rows.length && okwT; r0++) {
      for (var j0 = 0; j0 < rows[r0].length; j0++) {
        if (measure(String(rows[r0][j0]).split('\n')[0], sizeT, 'medium') > widths[j0] - 32) { okwT = false; break; }
      }
    }
    if (okwT) break;
    sizeT -= 1;
  }
  var rowMinT = Number(spec.row_min === undefined ? 78 : spec.row_min);
  var rowCapT = Number(spec.row_height === undefined ? 152 : spec.row_height);
  var plan = null, extraT = 0;
  for (extraT = 0; extraT < 4; extraT++) {
    var szT = Math.max(15, sizeT - extraT);
    var leadT2 = Math.round(szT * 1.32);
    var linesMaxT = 1;
    rows.forEach(function (rr) { (rr || []).forEach(function (cc) { linesMaxT = Math.max(linesMaxT, String(cc).split('\n').length); }); });
    var contentHT = (leadT2 - (inkSpan(szT, 'medium').bottom - inkSpan(szT, 'medium').top)) * (linesMaxT - 1) + 32 + 19;
    plan = planWithBelow(prevBottom, CTM, headH, rows.length, noteH, bandH, gap,
                         Math.max(rowMinT, contentHT), rowCapT);
    if (!plan.tight) break;
  }
  sizeT = Math.max(15, sizeT - extraT);
  var top = plan.top, rowH = plan.rowH;
  gap = plan.gap;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, top, CR - MX, headH);
  var fh = Number(spec.head_size || 20), x = MX;
  var headBase = cellBase(fh, 'bold', top, top + headH);
  cols.forEach(function (c, j) {
    drawText(c, x + 20, headBase, fh, 'bold', WHITE, 'ls');
    x += widths[j];
  });
  var listTop = top + headH;
  var size = sizeT;
  var lead = Math.round(size * 1.32);
  for (var i = 0; i < rows.length; i++) {
    var y0 = listTop + rowH * i;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1);
    var x3 = MX;
    for (var j3 = 0; j3 < rows[i].length; j3++) {
      var hot = keyCells[i + ',' + j3];
      var cellLines = String(rows[i][j3]).split('\n');
      var wt2 = (hot || j3 === 0) ? 'bold' : 'medium';
      var base = blockBase(size, wt2, y0, y0 + rowH, cellLines.length, lead, size, wt2);
      for (var k = 0; k < cellLines.length; k++) {
        drawText(cellLines[k], x3 + 20, base + k * lead, size, wt2, hot ? KEY : INK, 'ls');
      }
      x3 += widths[j3];
    }
  }
  var endY = listTop + rowH * rows.length;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, endY, CR - MX, 2);
  if (noteLines.length) {
    var nb = endY + gap - inkSpan(18, 'medium').top;
    for (var k2 = 0; k2 < noteLines.length; k2++) drawText(noteLines[k2], MX, nb + k2 * 27, 18, 'medium', INK, 'ls');
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tCompare(s, headLast) {
  var top = contentTopPoint(s, headLast, 46);
  if (s.body) top = bodyTextTech(s.body, top + 6, s.body_size || 22) + 32;
  var panels = s.panels || [], rows = s.rows || [], note = s.note || '';
  var takeH = s.takeaway ? 120 : 0;
  var noteLines = note ? wrapText(note, 19, 'medium', CR - MX) : [];
  var noteH = noteLines.length ? noteLines.length * 28 + 26 : 0;
  var bottom = CTM - takeH;
  var panelH = bottom - noteH - 24 - top;
  var headH = 96, pad = 26, gap = 24;
  var pw = (CR - MX - gap * (panels.length - 1)) / Math.max(1, panels.length);
  var bodySize = Number(s.value_size || 18);
  panels.forEach(function (p, i) {
    var x = MX + i * (pw + gap);
    var dark = p.tone === 'dark';
    _ctx.fillStyle = dark ? INK : WHITE; _ctx.fillRect(x, top, pw, panelH);
    _ctx.strokeStyle = INK; _ctx.lineWidth = 2; _ctx.strokeRect(x + 1, top + 1, pw - 2, panelH - 2);
    _ctx.fillStyle = dark ? KEY : INK; _ctx.fillRect(x, top, pw, headH);
    drawText(p.title, x + pad, top + 50, 26, 'extrabold', WHITE, 'ls');
    if (p.tag) tracked(p.tag, x + pad, top + 78, 13, 'bold', WHITE, 2);
    var rowH = (panelH - headH) / Math.max(1, rows.length);
    rows.forEach(function (row, j) {
      var y = top + headH + j * rowH;
      if (j) { _ctx.fillStyle = dark ? WHITE : INK; _ctx.fillRect(x + pad, y, pw - pad * 2, 1); }
      tracked(row.label || '', x + pad, y + 24, 14, 'bold', dark ? WHITE : KEY, 2);
      var val = i ? row.right : row.left;
      var lines = wrapText(val || '', bodySize, 'medium', pw - pad * 2);
      for (var k = 0; k < lines.length; k++) drawText(lines[k], x + pad, y + 52 + k * 25, bodySize, 'medium', dark ? WHITE : INK, 'ls');
    });
  });
  var y2 = top + panelH + 26;
  noteLines.forEach(function (ln, k) { drawText(ln, MX, y2 + k * 28, 19, 'medium', INK, 'ls'); });
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tProducts(s, headLast) {
  var top = contentTopPoint(s, headLast, 30);
  var strip = s.strip;
  if (strip) {
    var sh = 72;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, top, CR - MX, sh);
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, top, 8, sh);
    var linesS = wrapText(strip, 19, 'bold', CR - MX - 60);
    var ty = top + sh / 2 - (linesS.length - 1) * 14 + 7;
    linesS.forEach(function (ln, k) { drawText(ln, MX + 30, ty + k * 28, 19, 'bold', WHITE, 'ls'); });
    top += sh + 34;
  }
  var cutout = !!s.cutout;
  var items = s.items || [], gap = Number(s.gap || 40);
  var cw = (CR - MX - gap * (items.length - 1)) / Math.max(1, items.length);
  var ih = Number(s.image_height || 300);
  var limit = CTM - (s.takeaway ? 120 : 0);
  var creditLines = 0;
  items.forEach(function (it) { if (it.credit) creditLines = Math.max(creditLines, wrapText(it.credit, 16, 'medium', cw).length); });
  var creditBase = creditLines ? limit - 20 - 22 * (creditLines - 1) : null;
  items.forEach(function (it, i) {
    var x = MX + i * (cw + gap);
    if (it.tag) {
      if (cutout && (s.tag_style === undefined ? 'text' : s.tag_style) === 'text') {
        // 누끼 위에는 상자 없이 작은 글자만(사각 칩도 '박스'로 읽힌다)
        tracked(it.tag, x + 2, top + 22, 15, 'bold', INK, 2);
      } else {
        var tw = trackedW(it.tag, 15, 'bold', 2);
        _ctx.fillStyle = KEY; _ctx.fillRect(x, top, tw + 28, 32);
        tracked(it.tag, x + 14, top + 21, 15, 'bold', WHITE, 2);
      }
    }
    if (cutout) {
      // 투명 누끼 그대로 — 바탕·구분선 없이 알파만 얹는다
      drawCutout(it.image, x, top + 40, cw, ih);
    } else {
      var im = getImage(it.image);
      if (imgOk(im)) {
        var r = Math.min(cw / im.naturalWidth, ih / im.naturalHeight);
        var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
        _ctx.drawImage(im, x + (cw - nw) / 2, top + 40 + (ih - nh), nw, nh);
      } else placeholder(it.image, x, top + 40, cw, ih);
      _ctx.fillStyle = INK; _ctx.fillRect(x, top + 40 + ih + 2, cw, 1);
    }
    var nameLines = wrapText(it.name || '', 25, 'extrabold', cw);
    var ny = top + 40 + ih + 44;
    nameLines.forEach(function (ln, k) { drawText(ln, x, ny + k * 32, 25, 'extrabold', INK, 'ls'); });
    var sy = ny + 32 * nameLines.length + 8;
    drawText(it.spec, x, sy, 18, 'bold', KEY, 'ls');
    var y = sy + 36;
    (it.lines || []).forEach(function (line) {
      var ls = wrapText(line, 18, 'medium', cw);
      ls.forEach(function (ln, k) { drawText(ln, x, y + k * 27, 18, 'medium', INK, 'ls'); });
      y += 27 * ls.length + 8;
    });
    (it.sections || []).forEach(function (sec) {
      tracked(sec.label || '', x, y + 16, 14, 'bold', KEY, 2);
      var size = Number(sec.size || 17);
      var ls2 = wrapText(sec.text || '', size, 'medium', cw);
      ls2.forEach(function (ln, k) { drawText(ln, x, y + 44 + k * 26, size, 'medium', INK, 'ls'); });
      y += 44 + 26 * (ls2.length - 1) + 12;
    });
    if (it.credit && creditBase !== null) {
      _ctx.fillStyle = KEY; _ctx.fillRect(x, creditBase - 26, 28, 1);
      var cl = wrapText(it.credit, 16, 'medium', cw);
      cl.forEach(function (ln, k) { drawText(ln, x, creditBase + k * 22, 16, 'medium', KEY, 'ls'); });
    }
  });
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tQuad(s, headLast) {
  var top = contentTopPoint(s, headLast, 44);
  if (s.body) top = bodyTextTech(s.body, top + 8, s.body_size || 22) + 40;
  var cards = s.cards || [], gap = 22;
  var cw = (CR - MX - gap) / 2;
  var band = s.takeaway ? 120 : 0;
  var avail = CTM - band - top;
  var ch = Math.round(Number(s.card_height || (avail - gap) / 2));
  var pad = 30;
  cards.forEach(function (card, i) {
    var x = MX + (i % 2) * (cw + gap);
    var y = top + Math.floor(i / 2) * (ch + gap);
    var bg = (card.tone || 'ink') === 'ink' ? INK : KEY;
    _ctx.fillStyle = bg; _ctx.fillRect(x, y, cw, ch);
    tracked(card.eyebrow || '', x + pad, y + 46, 15, 'bold', WHITE, 3);
    if (card.stat) {
      var fs2 = 20, tw2 = measure(card.stat, fs2, 'bold');
      var bx1 = x + cw - pad, bx0 = bx1 - tw2 - 26;
      _ctx.fillStyle = bg === KEY ? WHITE : KEY; _ctx.fillRect(bx0, y + 28, bx1 - bx0, 38);
      drawText(card.stat, (bx0 + bx1) / 2, y + 47, fs2, 'bold', bg === KEY ? KEY : WHITE, 'mm');
    }
    var lines = wrapText(card.text || '', 18, 'medium', cw - pad * 2);
    var blockH = 74 + 28 * (lines.length - 1);
    var areaTop = y + 86, areaBottom = y + ch - 20;
    var start = areaTop + Math.max(0, (areaBottom - areaTop - blockH) / 2);
    drawText(card.title, x + pad, start + 34, 28, 'extrabold', WHITE, 'ls');
    lines.forEach(function (ln, k) { drawText(ln, x + pad, start + 74 + k * 28, 18, 'medium', WHITE, 'ls'); });
  });
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tSteps(s, headLast) {
  var top = contentTopPoint(s, headLast, 52);
  if (s.body) top = bodyTextTech(s.body, top + 8, s.body_size || 22) + 44;
  var items = s.items || [];
  var band = s.takeaway ? 138 : 0;
  var noteBand = s.note_band ? 108 : 0;
  var avail = CTM - band - noteBand - top - 10;
  var step = Math.min(Number(s.step_height || 216), avail / Math.max(1, items.length));
  var lineX = MX + 31;
  if (items.length > 1) { _ctx.fillStyle = KEY; _ctx.fillRect(lineX - 2, top + 66, 3, step * (items.length - 1) + 6); }
  items.forEach(function (it, i) {
    var y = top + step * i;
    numBadge(MX, y + 8, 64, it.num || pad2(i + 1));
    drawText(it.title, MX + 94, y + 50, 34, 'extrabold', INK, 'ls');
    var lines = wrapText(it.text || '', 21, 'medium', CR - MX - 250);
    lines.forEach(function (ln, k) { drawText(ln, MX + 94, y + 94 + k * 32, 21, 'medium', INK, 'ls'); });
    if (it.sub) {
      var tw = measure(it.sub, 18, 'bold');
      _ctx.fillStyle = WHITE; _ctx.fillRect(CR - tw - 26, y + 16, tw + 26, 36);
      _ctx.strokeStyle = KEY; _ctx.lineWidth = 2; _ctx.strokeRect(CR - tw - 26 + 1, y + 17, tw + 24, 34);
      drawText(it.sub, CR - 13, y + 34, 18, 'bold', KEY, 'rm');
    }
    _ctx.fillStyle = i < items.length - 1 ? INK : KEY;
    _ctx.fillRect(MX, y + step - 20, CR - MX, 1);
  });
  if (s.note_band) {
    var ny = CTM - band - 88;
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, ny, CR - MX, 76);
    var lines2 = wrapText(s.note_band, 21, 'bold', CR - MX - 60);
    var ty2 = ny + 38 - (lines2.length - 1) * 15 + 8;
    lines2.forEach(function (ln, k) { drawText(ln, MX + 30, ty2 + k * 30, 21, 'bold', WHITE, 'ls'); });
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tClosing(s, headLast) {
  var top = contentTopPoint(s, headLast, 48);
  var cards = s.cards || [], rows = Math.ceil(cards.length / 2), gap = 20;
  var band = s.takeaway ? 124 : 0;
  var noteH = s.note_band ? Number(s.note_height || 88) : 0;
  var noteGap = noteH ? 22 : 0;
  var avail = CTM - band - noteH - noteGap - top;
  var cw = (CR - MX - gap) / 2;
  var ch = Math.round((avail - gap * (rows - 1)) / Math.max(1, rows));
  var pad = 34, size = Number(s.card_size || 24), lh = Math.round(size * 1.42);
  cards.forEach(function (card, i) {
    var x = MX + (i % 2) * (cw + gap);
    var y = top + Math.floor(i / 2) * (ch + gap);
    var bg = (card.tone || 'ink') === 'ink' ? INK : KEY;
    _ctx.fillStyle = bg; _ctx.fillRect(x, y, cw, ch);
    var lines = wrapText(card.text || '', size, 'bold', cw - pad * 2);
    var block = 64 + lh * (lines.length - 1);
    var start = y + (ch - block) / 2;
    tracked(card.num || '', x + pad, start, 17, 'bold', WHITE, 3);
    lines.forEach(function (ln, k) { drawText(ln, x + pad, start + 46 + k * lh, size, 'bold', WHITE, 'ls'); });
  });
  if (s.note_band) {
    var ny = CTM - band - noteH;
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, ny, CR - MX, noteH);
    var l2 = wrapText(s.note_band, 23, 'bold', CR - MX - 68);
    var ty = ny + noteH / 2 - (l2.length - 1) * 16 + 8;
    l2.forEach(function (ln, k) { drawText(ln, MX + 34, ty + k * 32, 23, 'bold', WHITE, 'ls'); });
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tLineage(s, headLast) {
  var top = contentTopPoint(s, headLast, 46);
  if (s.body) top = bodyTextTech(s.body, top + 16, s.body_size || 23) + 46;
  var rows = s.rows || [], note = s.note || '';
  var noteH = note ? 96 : 0;
  var avail = CTM - noteH - 24 - top;
  var step = avail / Math.max(1, rows.length);
  var barX = CR - 250;
  rows.forEach(function (r, i) {
    var y = top + step * i;
    drawText(r.num || pad2(i + 1), MX, y + 44, 20, 'bold', KEY, 'ls');
    drawText(r.name, MX + 54, y + 40, 33, 'extrabold', INK, 'ls');
    drawText(r.sub, MX + 54, y + 74, 18, 'medium', INK, 'ls');
    var segW = 250 / 4;
    for (var k = 0; k < 4; k++) {
      var x0 = barX + k * (segW + 5);
      _ctx.fillStyle = k <= i ? KEY : WHITE;
      _ctx.fillRect(x0, y + 44, segW, 22);
      _ctx.strokeStyle = INK; _ctx.lineWidth = 1; _ctx.strokeRect(x0 + 0.5, y + 44.5, segW - 1, 21);
    }
    drawText(r.tag, barX, y + 96, 17, 'bold', KEY, 'ls');
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y + step - 18, CR - MX, 1);
  });
  if (note) {
    var ny = CTM - noteH;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, ny, CR - MX, noteH);
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, ny, 8, noteH);
    var lines = wrapText(note, 20, 'bold', CR - MX - 64);
    lines.forEach(function (ln, k) { drawText(ln, MX + 32, ny + 46 + k * 29, 20, 'bold', WHITE, 'ls'); });
  }
  return CTM;
}

/* ---------------------------------------------------------------- 8. 뷰티 브리핑 */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
/* ---------------------------------------------------------------- 8. 뷰티 브리핑
   scripts/cardnews_carousel.py 와 같은 좌표·같은 식을 쓴다.
   2페이지 목차 = C3 인덱스 카드 블록형 · 본문 = B3 캡슐 라벨 · 세로 악센트형
   (2026-11-25 환희 님 확정). */
function frameBrief(page, progress) {
  drawLogo('black', MX, 78, 44);
  if (page) drawText(page, CR, 96, 25, 'medium', GRAY_SOFT, 'rs');
  if (progress) progressBrief(progress[0], progress[1]);
}
/* 하단 가로 진행 바 — 2026-11-24 환희 님 확정: 점(···)·분할 막대를 폐지하고
   뷰티 포인트·테크(progressPoint)와 같은 '한 줄 트랙 + 진행분 채움'으로 통일.
   scripts/cardnews_carousel.py 의 `draw_progress()` 와 같은 규격:
   트랙 y 1332 · 진행분 y 1330 · 왼쪽부터 채운다.
   브리핑은 무채색이라 트랙 #D9D9D9, 진행분 #111111. 표지(1장)에는 그리지 않는다. */
function progressBrief(cur, tot) {
  tot = Math.max(1, Number(tot) || 1);
  cur = Math.min(Math.max(0, Number(cur) || 0), tot);
  _ctx.fillStyle = '#D9D9D9'; _ctx.fillRect(0, 1332, W, 3);
  var w = W * cur / tot;
  if (w > 0) { _ctx.fillStyle = INK; _ctx.fillRect(0, 1330, w, 7); }
}
function indexRows(c) {
  return (c.slides || []).map(function (s, i) {
    var label = String(s.label || ''), k = label.indexOf(' · ');
    var cat = k >= 0 ? label.slice(k + 3).trim() : '';
    var title = s.index_title || headlineText(s.headline || []);
    return {
      num: pad2(i + 1), cat: cat,
      title: String(title).split(/\s+/).filter(Boolean).join(' '),
      figure: String(s.index_figure || '').split(/\s+/).filter(Boolean).join(' ')
    };
  });
}
var IX_RAIL_R = 356, IX_COL_X = 432;
var IX_LIST_TOP = 362, IX_LIST_BOT = 1190, IX_FOOT_Y = 1246;
var IX_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function ixFlat(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }
/* 레일 날짜 — index.date → 표지 킥커 → 발행·결재 시각 → 오늘 */
function ixDate(c) {
  var cfg = c.index || {};
  var raw = ixFlat(cfg.date), m, i;
  if (!raw) {
    m = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(String((c.cover || {}).kicker || ''));
    if (m) raw = m[1] + '.' + pad2(Number(m[2])) + '.' + pad2(Number(m[3]));
  }
  if (!raw) {
    var keys = ['publishedAt', 'approvedAt', 'scheduledUploadAt'];
    for (i = 0; i < keys.length; i++) {
      m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(c[keys[i]] || ''));
      if (m) { raw = m[1] + '.' + m[2] + '.' + m[3]; break; }
    }
  }
  if (!raw) {
    var d = new Date();
    raw = d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }
  return raw;
}
/* 날짜 아래 작은 요일 줄 — 비어 있으면 날짜에서 요일을 계산한다 */
function ixRailSub(c, date) {
  var sub = ixFlat((c.index || {}).rail_sub);
  if (sub) return sub;
  var m = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(String(date));
  if (m) {
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return IX_DAYS[(d.getDay() + 6) % 7] + ' · SEOUL';
  }
  return 'SEOUL';
}
/* 우측 저널 제목 — `오늘의 뷰티`. `{n}`(건수)은 그리지 않는다 */
function ixHead(cfg) {
  var head = ixFlat(String(cfg.headline || '').replace('{n}', ' '));
  return head || '오늘의 뷰티';
}
/* 리드 1줄 — 비어 있으면 분야로 자동 추출 */
function ixLead(cfg, rows, n) {
  var lead = ixFlat(cfg.lead);
  if (lead) return lead;
  var cats = [];
  rows.forEach(function (r) {
    var c = ixFlat(r.cat);
    if (c && cats.indexOf(c) < 0) cats.push(c);
  });
  if (cats.length >= 2) return '오늘 꼭 봐야 할 ' + n + '가지 — ' + cats[0] + '부터 ' + cats[cats.length - 1] + '까지';
  return '오늘의 뷰티 소식 ' + n + '건을 중요한 순서대로 정리했습니다.';
}
/* 레일 키워드 4개 — 비어 있으면 분야 → 제목 첫 마디로 자동 추출 */
function ixKeywords(cfg, rows) {
  var kws = [];
  (cfg.keywords || []).forEach(function (k) {
    var t = ixFlat(k);
    if (t && kws.indexOf(t) < 0) kws.push(t);
  });
  if (kws.length) return kws.slice(0, 4);
  rows.forEach(function (r) {
    var c = ixFlat(r.cat);
    if (c && kws.indexOf(c) < 0) kws.push(c);
  });
  rows.forEach(function (r) {
    if (kws.length >= 4) return;
    var t = ixFlat(String(r.title || '').split(/[,，]/)[0]);
    if (t && kws.indexOf(t) < 0) kws.push(t);
  });
  return kws.slice(0, 4);
}
/* maxW 에 맞는 글자 크기 — 최소 크기에서도 넘치면 말줄임(…) */
function fitText(str, size, weight, maxW, minSize) {
  var s = ixFlat(str), sz = Math.round(size), cut, cand;
  while (sz > minSize && measure(s, sz, weight) > maxW) sz -= 1;
  if (measure(s, sz, weight) > maxW) {
    for (cut = s.length - 1; cut > 0; cut--) {
      cand = s.slice(0, cut).replace(/[ ,·-]+$/, '') + '…';
      if (measure(cand, sz, weight) <= maxW) { s = cand; break; }
    }
  }
  return { text: s, size: sz };
}
/* --- 2페이지 목차 = C3 · 인덱스 카드 블록형 (2026-11-25 확정) ----------------
   좌상단 `b   ut` 로고 · 좌측 레일(150px 건수 + ISSUE · 날짜/요일 · 키워드 태그) ·
   우측은 라운드 카드(#F7F7F8) 10행 안팎 + 수치 우측 정렬. 선분(헤어라인) 없음. */
function renderIndex(c) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  var cfg = c.index || {};
  var rows = indexRows(c), n = rows.length;
  var date = ixDate(c);
  drawLogo('black', MX, 78, 44);

  /* 우측 상단 — 발행일만 */
  drawText(date, CR, 96, 22, 'bold', GRAY_EMPH, 'rs');

  /* 좌측 레일 ① 건수 (150px) */
  var fNum = 150, fIss = 15;
  var numBase = blockBase(fNum, 'extrabold', 196, 470, 2, 66, fIss, 'bold');
  drawText(String(n), MX, numBase, fNum, 'extrabold', INK, 'ls');
  tracked('ISSUE', MX + 2, numBase + 66, fIss, 'bold', '#9A9A9A', 6);

  /* 좌측 레일 ② 날짜 */
  var dateBase = blockBase(26, 'extrabold', 500, 596, 2, 32, 14, 'bold');
  drawText(date, MX, dateBase, 26, 'extrabold', INK, 'ls');
  var railSub = ixRailSub(c, date);
  if (railSub) {
    var rs = fitText(railSub, 14, 'bold', IX_RAIL_R - MX, 11);
    tracked(rs.text, MX, dateBase + 32, rs.size, 'bold', '#A0A0A0', 3);
  }

  /* 좌측 레일 ③ 키워드 — 첫 개만 블랙 솔리드, 나머지 연회색 태그 */
  var kws = ixKeywords(cfg, rows);
  tracked('KEYWORDS', MX, 626, 13, 'bold', '#A0A0A0', 4);
  var ky = 664;
  kws.forEach(function (kw, i) {
    var dark = i === 0;
    var kf = fitText(kw, 19, 'bold', IX_RAIL_R - MX - 34, 13);
    var cw = Math.min(IX_RAIL_R - MX, Math.round(measure(kf.text, kf.size, 'bold') + 34));
    _ctx.fillStyle = dark ? INK : '#F1F1F1';
    _ctx.beginPath(); roundRect(_ctx, MX, ky, cw, 42, 3); _ctx.fill();
    drawText(kf.text, MX + 17, cellBase(kf.size, 'bold', ky, ky + 42), kf.size, 'bold',
      dark ? WHITE : INK, 'ls');
    ky += 42 + 12;
  });

  /* 우측 저널 헤더 */
  tracked("DAILY BRIEFING", IX_COL_X, 210, 19, 'extrabold', '#8A8A8A', 6);
  var hf = fitText(ixHead(cfg), 56, 'extrabold', CR - IX_COL_X, 40);
  drawText(hf.text, IX_COL_X, 276, hf.size, 'extrabold', INK, 'ls');
  var headBot = 276 + inkSpan(56, 'extrabold').bottom;
  var leadFit = fitText(ixLead(cfg, rows, n), 18, 'regular', CR - IX_COL_X, 12);
  drawText(leadFit.text, IX_COL_X, cellBase(18, 'regular', headBot + 4, 344),
    leadFit.size, 'regular', '#5A5A5A', 'ls');

  /* 우측 저널 목차 — 라운드 카드(#F7F7F8), 수치는 우측 정렬.
     기사 수가 10건을 넘으면 카드 높이·간격을 줄이고, 62px 아래면 분야 줄을 뺀
     한 줄 카드로 바꿔 18건까지 푸터를 침범하지 않게 한다(Python과 같은 식). */
  if (!n) return;
  var avail = IX_LIST_BOT - IX_LIST_TOP;
  var gap = n <= 12 ? 8 : 6;
  var cardH = Math.min(74, (avail - gap * Math.max(0, n - 1)) / Math.max(1, n));
  var compact = cardH < 62;
  var tSz = compact ? Math.max(14, Math.min(20, Math.round(cardH * 0.42))) : 22;
  var total = cardH * n + gap * Math.max(0, n - 1);
  var top0 = IX_LIST_TOP + Math.max(0, (avail - total) / 2);
  rows.forEach(function (r, i) {
    var top = top0 + (cardH + gap) * i;
    _ctx.fillStyle = '#F7F7F8';
    _ctx.beginPath(); roundRect(_ctx, IX_COL_X, top, CR - IX_COL_X, cardH, compact ? 6 : 8); _ctx.fill();
    var fig = r.figure ? fitText(r.figure, compact ? 12 : 14, 'bold', 200, 10) : null;
    var figW = fig ? measure(fig.text, fig.size, 'bold') : 0;
    var base = (r.cat && !compact)
      ? blockBase(tSz, 'bold', top + 6, top + cardH - 6, 2, 26, 13, 'medium')
      : cellBase(tSz, 'bold', top + 4, top + cardH - 4);
    drawText(r.num, IX_COL_X + 22, base, compact ? 12 : 14, 'extrabold', '#9E9E9E', 'ls');
    var tf = fitText(r.title, tSz, 'bold', CR - 24 - figW - 18 - (IX_COL_X + 54), 12);
    drawText(tf.text, IX_COL_X + 54, base, tf.size, 'bold', INK, 'ls');
    if (r.cat && !compact) {
      var cf = fitText(r.cat, 13, 'medium', CR - (IX_COL_X + 54) - 22, 10);
      drawText(cf.text, IX_COL_X + 54, base + 26, cf.size, 'medium', '#9E9E9E', 'ls');
    }
    if (fig) drawText(fig.text, CR - 24, base, fig.size, 'bold', '#6F6F6F', 'rs');
  });

  /* 하단 문구 */
  var footer = cfg.footer === undefined ? '원문 출처는 각 페이지 하단 표기' : cfg.footer;
  if (footer) drawText(ixFlat(footer), MX, IX_FOOT_Y, 19, 'regular', '#A8A8A8', 'ls');
}

/* --- 도표 (모두 무채색) ---------------------------------------------------- */
function chartTitle(spec, box) {
  var title = spec.title;
  if (!title) return box.y;
  drawText(title, box.x, box.y - inkSpan(16, 'bold').top, 16, 'bold', '#A0A0A0', 'ls');
  return box.y + 40;
}
function chartBarV(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var top = chartTitle(spec, box);
  var labels = spec.labels || [], values = (spec.values || []).map(Number);
  var disp = spec.display || values.map(function (v) { return v.toLocaleString('en-US'); });
  var hi = spec.highlight === undefined ? values.length - 1 : spec.highlight;
  var lblH = 36, plotBottom = y0 + h - lblH, plotTop = top + 34;
  var maxv = Math.max.apply(null, values.concat([1]));
  var n = values.length, gap = spec.gap === undefined ? 13 : spec.gap;
  var bw = Math.min(spec.max_bar_width || 168, (w - gap * (n - 1)) / Math.max(1, n));
  var totalW = bw * n + gap * (n - 1), xStart = x0 + (w - totalW) / 2;
  for (var i = 0; i < n; i++) {
    var bh = Math.max(4, values[i] / maxv * (plotBottom - plotTop - 8));
    var x = xStart + i * (bw + gap), yTop = plotBottom - bh;
    _ctx.fillStyle = i === hi ? INK : '#C8C8C8';
    _ctx.fillRect(x, yTop, bw, bh);
    drawText(disp[i], x + bw / 2, yTop - 8, spec.value_size || 17, 'medium', i === hi ? INK : '#6A6A6A', 'ms');
    drawText(labels[i], x + bw / 2, plotBottom + 10, 18, 'medium', GRAY_SOFT, 'ma');
  }
  _ctx.fillStyle = '#D8D8D8'; _ctx.fillRect(x0, plotBottom, w, 1);
}
function chartBarH(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var top = chartTitle(spec, box);
  var items = spec.items || [], labW = spec.label_width || 200, valW = spec.value_width || 150;
  var n = items.length, avail = y0 + h - top;
  var rowH = Math.min(spec.row_height || 74, avail / Math.max(1, n));
  top = top + Math.max(0, (avail - rowH * n) / 2);
  var barX0 = x0 + labW, barW = w - labW - valW;
  var maxv = 1;
  items.forEach(function (it) { maxv = Math.max(maxv, Number(it.value) || 0); });
  var bh = Math.min(40, rowH * 0.52), hi = spec.highlight === undefined ? 0 : spec.highlight;
  items.forEach(function (it, i) {
    var cy = top + rowH * i + rowH / 2;
    drawText(it.label, barX0 - 20, cy, 23, 'medium', GRAY_BODY, 'rm');
    var bwid = Math.max(6, (Number(it.value) || 0) / maxv * barW);
    _ctx.fillStyle = i === hi ? INK : '#BFBFBF';
    _ctx.fillRect(barX0, cy - bh / 2, bwid, bh);
    drawText(it.display, x0 + w, cy, 23, 'bold', i === hi ? INK : '#5A5A5A', 'rm');
  });
}
/* --- B3 표 (2026-11-25 확정): 톤다운 헤더 + #F8F8F9 소프트 행 판 ------------ */
var TABLE_BOTTOM = 1163, TABLE_HEAD_H = 40, TABLE_MIN_ROW = 46;
var TABLE_ROW_GAP = 4, TABLE_HEAD_INK = '#6E6E6E';
var BLOCK_PAD = 26, BLOCK_X0 = MX - BLOCK_PAD, BLOCK_X1 = W - MX + BLOCK_PAD;
var BAND_X0 = MX - 16, BAND_X1 = W - MX + 16;
var BODY_CARD = '#F8F8F9', COUNTER_CAP = '#E6E6E8', COUNTER_CAP_INK = '#3F3F3F';

function chartTable(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var cols = spec.columns || [], rows = spec.rows || [];
  var align = spec.align || [];
  var widths = spec.widths;
  if (!widths) widths = new Array(cols.length).fill(w / Math.max(1, cols.length));
  else { var sw = widths.reduce(function (a, b) { return a + Number(b); }, 0) || 1; widths = widths.map(function (ww) { return Number(ww) / sw * w; }); }
  var n = Math.max(1, rows.length);
  var y = y0;
  if (spec.title) {
    drawText(spec.title, x0, y - inkSpan(16, 'bold').top, 16, 'bold', '#A0A0A0', 'ls');
    y += 26;
  }
  var headH = TABLE_HEAD_H, headTop = y, x = x0;
  var headBase = cellBase(Number(spec.head_size || 16), 'medium', headTop, headTop + headH);
  cols.forEach(function (c, j) {
    var right = align[j] === 'r';
    drawText(c, right ? x + widths[j] : x, headBase, Number(spec.head_size || 16), 'medium', TABLE_HEAD_INK, right ? 'rs' : 'ls');
    x += widths[j];
  });
  var rowsTop = headTop + headH;
  var cellSize = Number(spec.cell_size || 23);
  while (cellSize > 16) {
    var okw = true;
    for (var r = 0; r < rows.length && okw; r++) {
      for (var j2 = 0; j2 < rows[r].length; j2++) {
        if (measure(String(rows[r][j2]), cellSize, 'medium') > widths[j2] - 8) { okw = false; break; }
      }
    }
    if (okw) break;
    cellSize -= 1;
  }
  var rowH = Math.max(1, (y0 + h - rowsTop) / n);
  rows.forEach(function (row, i) {
    var rTop = rowsTop + rowH * i + TABLE_ROW_GAP / 2, rBot = rowsTop + rowH * (i + 1) - TABLE_ROW_GAP / 2;
    _ctx.fillStyle = BODY_CARD;
    _ctx.fillRect(BAND_X0, Math.round(rTop), BAND_X1 - BAND_X0, Math.round(rBot) - Math.round(rTop));
    var yb = cellBase(cellSize, 'medium', rTop, rBot), xx = x0;
    for (var j = 0; j < cols.length; j++) {
      var right = align[j] === 'r';
      var wt = (j === 0 && spec.label_bold) ? 'bold' : 'medium';
      drawText(row[j] === undefined ? '' : row[j], right ? xx + widths[j] : xx, yb, cellSize, wt,
        j === 0 ? INK : GRAY_BODY, right ? 'rs' : 'ls');
      xx += widths[j];
    }
  });
  return rowsTop + rowH * n;
}
function chartTimeline(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var top = chartTitle(spec, box);
  var items = spec.items || [], n = items.length;
  var rowH = Math.min(spec.row_height || 108, (y0 + h - top) / Math.max(1, n));
  var lineX = x0 + (spec.date_width || 132);
  items.forEach(function (it, i) {
    var cy = top + rowH * i + rowH / 2;
    drawText(it.date, lineX - 26, cy, 22, 'bold', INK, 'rm');
    _ctx.fillStyle = INK; _ctx.fillRect(lineX - 5, cy - 5, 10, 10);
    if (i < n - 1) { _ctx.fillStyle = '#D6D6D6'; _ctx.fillRect(lineX - 1, cy + 7, 2, rowH - 14); }
    drawText(it.text, lineX + 28, cy, spec.text_size || 25, 'medium', GRAY_BODY, 'lm');
  });
}
/* --- 무채색 선형 그래프 (2026-11-25 확정) ----------------------------------
   옅은 회색 가로 가이드선(#EFEFEF) + 3px 검정 꺾은선 + 원형 마커
   (강조·마지막 지점은 검정 솔리드, 나머지는 흰 바탕 검정 테두리).
   각 포인트 위 수치(`display`), 아래 x축 라벨(`labels`). 수치는 선을 피해 붙인다. */
function chartLine(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var top = chartTitle(spec, box);
  var values = (spec.values || []).map(Number), n = values.length;
  if (!n) return;
  var labels = spec.labels || [], disp = spec.display || values.map(function (v) { return v.toLocaleString('en-US'); });
  var hi = spec.highlight === undefined ? n - 1 : spec.highlight;
  var hiSet = Array.isArray(hi) ? hi.slice() : [hi];
  var fLab = 18, fVal = spec.value_size || 17;
  var lblH = 34, plotBottom = y0 + h - lblH, plotTop = top + 34;
  var hasNeg = values.some(function (v) { return v < 0; });
  var vmax = Math.max.apply(null, values), vmin = Math.min.apply(null, values);
  if (hasNeg) vmax = Math.max(vmax, 0);
  var span = vmax !== vmin ? (vmax - vmin) : Math.max(1, Math.abs(vmax) || 1);
  function ypos(v) { return plotBottom - (v - vmin) / span * (plotBottom - plotTop - 26) - 2; }
  var k, gy;
  for (k = 0; k < 5; k++) {
    gy = Math.round(plotBottom - (plotBottom - plotTop) * k / 4);
    _ctx.fillStyle = '#EFEFEF'; _ctx.fillRect(x0, gy, w, 1);
  }
  var padMax = 40;
  for (k = 0; k < n; k++) padMax = Math.max(padMax, measure(String(disp[k]), fVal, 'medium') / 2 + 12);
  var padX = Math.min(w * 0.14, Math.max(76, padMax));
  var plotW = w - padX * 2;
  var xs = values.map(function (v, i) { return x0 + padX + (n > 1 ? plotW * i / (n - 1) : plotW / 2); });
  var pts = values.map(function (v, i) { return [xs[i], ypos(v)]; });
  var infRaw = spec.inflection === undefined ? spec.slowdown_from : spec.inflection;
  var infNum = Number(infRaw);
  var inf = (infRaw !== null && infRaw !== '' && infRaw !== undefined && isFinite(infNum) && infNum >= 0 && infNum < n)
    ? Math.floor(infNum) : null;

  /* 0 기준선 — 음수가 있을 때만 실선(#B0B0B0 2px) + 좌측 `0` 라벨 (점선·세로선 없음) */
  if (hasNeg) {
    var zy = Math.round(ypos(0));
    _ctx.fillStyle = '#B0B0B0';
    _ctx.fillRect(x0, zy, w, 2);
    drawText('0', x0 + 2, zy - 7, 14, 'bold', '#9A9A9A', 'ls');
  }

  if (n > 1) {
    _ctx.lineJoin = 'round'; _ctx.lineCap = 'round'; _ctx.lineWidth = 3;
    /* 꺾임 이후 구간은 회색으로 — 흐름이 꺾이는 모습이 한눈에 보이게 */
    for (k = 0; k < n - 1; k++) {
      _ctx.strokeStyle = (inf !== null && k >= inf) ? '#9A9A9A' : INK;
      _ctx.beginPath(); _ctx.moveTo(pts[k][0], pts[k][1]); _ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
      _ctx.stroke();
    }
    /* 양수 ↔ 음수로 넘는 지점 — 빈 원 #555555 */
    for (k = 0; k < n - 1; k++) {
      var av = values[k], bv = values[k + 1];
      if (av === 0 || bv === 0 || (av > 0) === (bv > 0)) continue;
      var t = av / (av - bv);
      var cx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t;
      var cy = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
      _ctx.beginPath(); _ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      _ctx.fillStyle = WHITE; _ctx.fill();
      _ctx.strokeStyle = '#555555'; _ctx.lineWidth = 2; _ctx.stroke();
    }
  }
  var samples = [];
  for (k = 0; k < n - 1; k++) {
    var ax = pts[k][0], ay = pts[k][1], bx = pts[k + 1][0], by = pts[k + 1][1];
    var steps = Math.max(8, Math.round(Math.abs(bx - ax) / 4));
    for (var st = 0; st <= steps; st++) samples.push([ax + (bx - ax) * st / steps, ay + (by - ay) * st / steps]);
  }
  if (n === 1) samples = [pts[0]];
  var vs = inkSpan(fVal, 'medium');
  var placed = [];
  function labelBox(str, lx, ly, anc) {
    var tw = measure(str, fVal, 'medium');
    var xl = anc.charAt(0) === 'm' ? lx - tw / 2 : (anc.charAt(0) === 'l' ? lx : lx - tw);
    return [xl, ly + vs.top, xl + tw, ly + vs.bottom];
  }
  function hitsLine(bx) {
    for (var q = 0; q < samples.length; q++) {
      var sx = samples[q][0], sy = samples[q][1];
      if (bx[0] - 3 <= sx && sx <= bx[2] + 3 && bx[1] - 3 <= sy && sy <= bx[3] + 3) return true;
    }
    return false;
  }
  function overlaps(bx) {
    for (var q = 0; q < placed.length; q++) {
      var b = placed[q];
      if (!(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3])) return true;
    }
    return false;
  }
  pts.forEach(function (pt, i) {
    var px = pt[0], py = pt[1], neg = values[i] < 0;
    var after = inf !== null && i > inf;
    var solid = !neg && !after && (hiSet.indexOf(i) >= 0 || i === n - 1 || i === inf);
    _ctx.beginPath(); _ctx.arc(px, py, i === inf ? 7 : 6, 0, Math.PI * 2);
    if (neg) {
      _ctx.fillStyle = WHITE; _ctx.fill();
      _ctx.strokeStyle = '#555555';
      _ctx.lineWidth = (hiSet.indexOf(i) >= 0 || i === n - 1) ? 3 : 2;
      _ctx.stroke();
    } else if (solid) { _ctx.fillStyle = INK; _ctx.fill(); }
    else if (after) {
      _ctx.fillStyle = WHITE; _ctx.fill();
      _ctx.strokeStyle = '#888888'; _ctx.lineWidth = 2; _ctx.stroke();
    }
    else { _ctx.fillStyle = WHITE; _ctx.fill(); _ctx.strokeStyle = INK; _ctx.lineWidth = 2; _ctx.stroke(); }
    var s = String(disp[i]);
    var color = INK;
    if (neg) color = '#4A4A4A';
    else if (after) color = '#888888';
    else if (hiSet.indexOf(i) < 0 && i !== n - 1) color = '#6A6A6A';
    var below = [px, py + 14 - vs.top, 'ms'];
    var cand = neg ? [below, [px, py - 16, 'ms']]
      : [[px, py - 16, 'ms'], [px, py + 18 + vs.bottom, 'ms']];
    cand = cand.concat([[px + 12, py - 8, 'ls'], [px - 12, py - 8, 'rs'],
      [px + 12, py + 16, 'ls'], [px - 12, py + 16, 'rs']]);
    var chosen = null;
    for (var c = 0; c < cand.length; c++) {
      var bx = labelBox(s, cand[c][0], cand[c][1], cand[c][2]);
      if (bx[0] < x0 || bx[2] > x0 + w || bx[1] < top || bx[3] > plotBottom + 2) continue;
      if (hitsLine(bx) || overlaps(bx)) continue;
      chosen = [cand[c][0], cand[c][1], cand[c][2], bx]; break;
    }
    if (!chosen) chosen = [px, py - 16, 'ms', labelBox(s, px, py - 16, 'ms')];
    placed.push(chosen[3]);
    drawText(s, chosen[0], chosen[1], fVal, 'medium', color, chosen[2]);
    if (labels[i]) {
      var tw = measure(String(labels[i]), fLab, 'medium');
      var lx = Math.min(Math.max(px, x0 + tw / 2), x0 + w - tw / 2);
      drawText(String(labels[i]), lx, plotBottom + 10, fLab, 'medium', GRAY_SOFT, 'ma');
    }
  });
}
var CHARTS = { bar_v: chartBarV, bar_h: chartBarH, line: chartLine, table: chartTable, timeline: chartTimeline };

/* --- 본문 B3 · 캡슐 라벨 · 세로 악센트형 (2026-11-25 확정) ------------------
   블랙 `본문` 캡슐 + `덧붙이는 말 · {유형}` 연회색 캡슐 + 좌측 4px 세로 바
   (#F8F8F9 블록) + #F8F8F9 소프트 행 판 표. 헤어라인 구분선은 쓰지 않는다.
   유형은 반론·후속·보완·유의·용어 5가지(정정은 후속으로 통일). */
var MOD_LABEL_SIZE = 13, MOD_LABEL_TRACK = 3, MOD_LABEL_COLOR = '#A0A0A0';
var MOD_TAIL_COLOR = '#9A9A9A';
var COUNTER_LEAD = 28, COUNTER_SIZE = 20;
var COUNTER_LABEL_BASE = '덧붙이는 말';
var COUNTER_TYPES = ['반론', '후속', '보완', '유의', '용어'];
var LEGACY_TYPE = {
  '반론': '반론', '유보': '반론', '전망': '반론',
  '후속': '후속', '원 보도': '후속', '정정': '후속',
  '보완': '보완', '해명': '보완', '유의': '유의', '용어': '용어'
};
var BODY_TOP_GAP = 50, BODY_BLOCK_GAP = 30, CTR_BLOCK_PAD_TOP = 24, CTR_BLOCK_PAD_BOT = 22;
var TABLE_GAP = 30, CAPSULE_H = 30, CAPSULE_PAD = 18;
var BODY_CANDS = [[29, 45], [28, 43], [27, 41], [26, 40], [25, 38], [24, 36], [23, 34], [22, 32]];
var BODY_LEAD = { 29: 45, 28: 43, 27: 41, 26: 40, 25: 38, 24: 36, 23: 34, 22: 32 };

function counterLabel(s) {
  var raw = String((s.counter_type || s.counter_label || '')).trim();
  ['·', '/', '|'].forEach(function (sep) {
    if (raw.indexOf(sep) >= 0) raw = raw.split(sep)[0].trim();
  });
  var t = LEGACY_TYPE[raw];
  if (!t) {
    for (var i = 0; i < COUNTER_TYPES.length; i++) {
      if (raw.indexOf(COUNTER_TYPES[i]) === 0) { t = COUNTER_TYPES[i]; break; }
    }
  }
  if (!t) t = '반론';
  return COUNTER_LABEL_BASE + ' · ' + t;
}
function modOutlets(source) {
  var s = String(source || '').trim();
  if (!s) return '';
  var keep = [];
  s.split('·').forEach(function (part) {
    var t = part.trim();
    if (!t) return;
    if (/^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(t)) return;
    if (/^\d{4}년/.test(t) && t.length <= 16) return;
    keep.push(t);
  });
  return keep.join(' · ');
}
function tailRight(text, yBase, size, color) {
  if (!text) return;
  var sz = size || 14, maxW = (CR - MX) * 0.66, t = String(text);
  while (sz > 11 && measure(t, sz, 'medium') > maxW) sz -= 1;
  if (measure(t, sz, 'medium') > maxW) {
    while (t.length > 1 && measure(t + '…', sz, 'medium') > maxW) t = t.slice(0, -1);
    t = t.replace(/[\s·]+$/, '') + '…';
  }
  drawText(t, CR, yBase, sz, 'medium', color || MOD_TAIL_COLOR, 'rs');
}
function tailOffset(bodySize, bodyWt, lead) {
  var lt = inkSpan(MOD_LABEL_SIZE, 'bold'), bt = inkSpan(bodySize, bodyWt);
  return (lt.bottom - lt.top) + labelBodyGap(bodySize, bodyWt, lead) - bt.top;
}
/* 작은 라운드 배지(캡슐) — 기준선에 놓이는 글자의 잉크를 세로 가운데에 앉힌다 */
function briefCapsule(x, baseline, text, size, weight, opts) {
  var o = opts || {}, padX = o.pad === undefined ? CAPSULE_PAD : o.pad;
  var h = o.h === undefined ? CAPSULE_H : o.h;
  var track = o.track === undefined ? MOD_LABEL_TRACK : o.track;
  var w = trackedW(text, size, weight, track) + padX * 2;
  var sp = inkSpan(size, weight);
  var center = baseline + (sp.top + sp.bottom) / 2, top = center - h / 2;
  _ctx.fillStyle = o.fill || INK;
  _ctx.beginPath(); roundRect(_ctx, x, top, w, h, h / 2); _ctx.fill();
  tracked(text, x + padX, baseline, size, weight, o.color || WHITE, track);
  return w;
}
/* 본문 장표 세로 배치 — bodySize를 주면 덱 전체 공통 크기로 고정한다. */
function briefLayout(s, bodySize) {
  var lines = s.headline || [];
  var media = null;
  if (s.media) {
    var mw = Number(s.media.width || 316), mh = Number(s.media.height || 376);
    media = { w: mw, h: mh, x: CR - mw, y: 246, spec: s.media };
  }
  var maxW = media ? media.x - 40 - MX : W - MX * 2 - 4;
  var minHead = media ? 40 : 46;
  var hsize = Number(s.head_size || 72);
  while (headlineWidth(lines.map(segments), hsize, 'extrabold') > maxW && hsize > minHead) hsize -= 2;
  var hgap = Math.round(hsize * 1.24);
  var hFirst = 206 + 96, hLast = hFirst + hgap * (lines.length - 1);
  var hInkBottom = hLast + inkSpan(hsize, 'extrabold').bottom;

  var bodyText = s.body || '', chart = s.chart;
  var nRows = (chart && chart.type === 'table') ? (chart.rows || []).length : 0;
  var reserve = nRows ? (26 + TABLE_HEAD_H + TABLE_MIN_ROW * nRows + 8) : (chart ? 200 : 0);
  var topY = hInkBottom + BODY_TOP_GAP;
  if (media) topY = Math.max(topY, media.y + media.h + 46);

  var counterText = s.counter_note || '';
  var ctrSize = Number(s.counter_size || COUNTER_SIZE);
  var ctrLines = counterText ? wrapText(counterText, ctrSize, 'regular', W - MX * 2) : [];
  var ctrOff = tailOffset(ctrSize, 'regular', COUNTER_LEAD);
  var ctrInk = inkSpan(ctrSize, 'regular');

  var cands = bodySize ? [[bodySize, BODY_LEAD[bodySize] || Math.round(bodySize * 1.55)]] : BODY_CANDS;
  var L = null;
  for (var ci = 0; ci < cands.length; ci++) {
    var bs = cands[ci][0], bgap = cands[ci][1];
    var bLines = bodyText ? wrapText(bodyText, bs, 'regular', W - MX * 2 - 4) : [];
    var bFirst = bLines.length ? topY + tailOffset(bs, 'regular', bgap) : topY;
    var bBottom = bLines.length ? bFirst + bgap * (bLines.length - 1) + inkSpan(bs, 'regular').bottom : topY;
    var ctrBlockTop = null, ctrTop = null, ctrBlockBottom = null, chartTop;
    if (counterText) {
      ctrBlockTop = bBottom + BODY_BLOCK_GAP;
      ctrTop = ctrBlockTop + CTR_BLOCK_PAD_TOP;
      var ctrLast = ctrTop + ctrOff + COUNTER_LEAD * (ctrLines.length - 1);
      ctrBlockBottom = ctrLast + ctrInk.bottom + CTR_BLOCK_PAD_BOT;
      chartTop = ctrBlockBottom + TABLE_GAP;
    } else {
      chartTop = bBottom + BODY_TOP_GAP;
    }
    var chartH = TABLE_BOTTOM - chartTop;
    L = { hsize: hsize, hgap: hgap, hFirst: hFirst, hInkBottom: hInkBottom, media: media,
      maxW: maxW, bs: bs, bgap: bgap, lines: bLines, bFirst: bFirst, bBottom: bBottom,
      labelTop: topY, ctrLines: ctrLines, ctrSize: ctrSize, ctrOff: ctrOff,
      ctrBlockTop: ctrBlockTop, ctrTop: ctrTop, ctrBlockBottom: ctrBlockBottom,
      chartTop: chartTop, chartH: chartH };
    if ((!chart || chartH >= reserve) && chartH > 120) break;
  }
  return L;
}
/* 덱 전체 공통 본문 크기 — 각 장표의 필요 크기 중 가장 작은 값(2026-11-25 확정) */
function briefUniformBody() {
  if (!D || !(D.slides || []).length) return BODY_CANDS[0][0];
  if (D.__briefBody) return D.__briefBody;
  var need = null;
  (D.slides || []).forEach(function (s) {
    var bs = briefLayout(s, null).bs;
    need = need === null ? bs : Math.min(need, bs);
  });
  D.__briefBody = need === null ? BODY_CANDS[0][0] : need;
  return D.__briefBody;
}
function briefSlide(s, idx, total) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  var lines = s.headline || [];
  var L = briefLayout(s, briefUniformBody());
  if (s.brand_logo) {
    var bl = s.brand_logo, im = getImage(bl.image);
    if (imgOk(im)) {
      var lh = Number(bl.height || 24), lw = im.naturalWidth * lh / im.naturalHeight;
      _ctx.drawImage(im, CR - lw, 206 + 4, lw, lh);
    }
  }
  if (L.media) {
    drawRoundedPhoto(L.media.spec.image, L.media.x, L.media.y, L.media.w, L.media.h,
      Number(L.media.spec.focus || 0.5), 6);
  }
  var label = s.label || '';
  if (label) {
    var fL = 22, k = label.indexOf(' · ');
    var x = MX;
    var headPart = k >= 0 ? label.slice(0, k) : label;
    x += tracked(headPart, x, 206, fL, 'bold', INK, 2) + 12;
    if (k >= 0) {
      x += tracked('·', x, 206, fL, 'bold', '#C0C0C0', 2) + 12;
      tracked(label.slice(k + 3), x, 206, fL, 'bold', GRAY_SOFT, 2);
    }
  }
  drawHeadlines(lines.map(segments), MX, L.hFirst, L.hgap, L.hsize, { ink: INK, gray: GRAY_EMPH });

  /* 본문 모듈 — 블랙 `본문` 캡슐 + 발간지(우) */
  if (L.lines.length) {
    var labBase = L.labelTop - inkSpan(MOD_LABEL_SIZE, 'bold').top;
    briefCapsule(MX, labBase, '본문', MOD_LABEL_SIZE, 'bold', { pad: CAPSULE_PAD, h: CAPSULE_H, fill: INK, color: WHITE });
    tailRight(modOutlets(s.source), labBase, 14);
    for (var j = 0; j < L.lines.length; j++) {
      drawText(L.lines[j], MX, L.bFirst + j * L.bgap, L.bs, 'regular', GRAY_BODY, 'ls');
    }
  }
  /* 덧붙이는 말 모듈 — #F8F8F9 블록 + 좌측 4px 세로 바 + 연회색 캡슐 */
  if (L.ctrLines.length) {
    var bt = Math.round(L.ctrBlockTop), bb = Math.round(L.ctrBlockBottom);
    _ctx.fillStyle = BODY_CARD; _ctx.fillRect(BLOCK_X0, bt, BLOCK_X1 - BLOCK_X0, bb - bt);
    _ctx.fillStyle = INK; _ctx.fillRect(BLOCK_X0, bt, 4, bb - bt);
    var yC = Math.round(L.ctrTop) - inkSpan(MOD_LABEL_SIZE, 'bold').top;
    briefCapsule(MX, yC, counterLabel(s), MOD_LABEL_SIZE, 'bold',
      { pad: CAPSULE_PAD, h: CAPSULE_H, fill: COUNTER_CAP, color: COUNTER_CAP_INK });
    tailRight(s.counter_source || '', yC, 14);
    for (var q = 0; q < L.ctrLines.length; q++) {
      drawText(L.ctrLines[q], MX, Math.round(L.ctrTop) + L.ctrOff + q * COUNTER_LEAD,
        L.ctrSize, 'regular', GRAY_BODY, 'ls');
    }
  }
  if (s.chart) {
    var fn = CHARTS[s.chart.type || 'table'];
    if (fn) fn(s.chart, { x: MX, y: L.chartTop, w: W - MX * 2, h: L.chartH });
  }
  if (s.source) drawText(s.source, MX, 1222, 22, 'regular', '#A8A8A8', 'ls');
  frameBrief(idx + '/' + total, [idx, total]);
}

function drawRoundedPhoto(path, x, y, w, h, focus, radius) {
  _ctx.save();
  _ctx.beginPath();
  roundRect(_ctx, x, y, w, h, radius || 0);
  _ctx.clip();
  drawCoverCrop(path, x, y, w, h, focus, 0.5, 1);
  _ctx.restore();
  _ctx.strokeStyle = '#E2E2E2'; _ctx.lineWidth = 1;
  _ctx.beginPath(); roundRect(_ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius || 0); _ctx.stroke();
}
function roundRect(ctx2, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx2.moveTo(x + r, y);
  ctx2.lineTo(x + w - r, y); ctx2.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx2.lineTo(x + w, y + h - r); ctx2.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx2.lineTo(x + r, y + h); ctx2.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx2.lineTo(x, y + r); ctx2.quadraticCurveTo(x, y, x + r, y);
  ctx2.closePath();
}

/* ---------------------------------------------------------------- 8b. 뷰티 픽 (BEAUTY PICK)
   scripts/beauty_pick_carousel.py 의 레이아웃을 캔버스로 옮긴 것.
   PAPER #F4F1EB · AZURINE #0A64C8 · 풀블리드 사진 표지 · 도트 인디케이터 ·
   하단 `BEAUTY PICK · YYYY.MM.DD` / `n / NN` 푸터. */
var P_MX = 88, P_RIGHT = 992, P_CW = P_RIGHT - P_MX, P_INK = '#131313';
function pKey() { return (D && D.key_color) || '#0A64C8'; }
function pDeep() { return (D && D.deep_color) || '#002A7E'; }
function pPaper() { return (D && D.paper) || '#F4F1EB'; }
function pRGB(hex) {
  var c = String(hex || '#000000').replace('#', '');
  if (c.length === 3) c = c.charAt(0) + c.charAt(0) + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2);
  return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)];
}
function pA(hex, a) { var r = pRGB(hex); return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')'; }
function pMix(a, b, t) {
  var x = pRGB(a), y = pRGB(b);
  return 'rgb(' + Math.round(x[0] * (1 - t) + y[0] * t) + ',' +
    Math.round(x[1] * (1 - t) + y[1] * t) + ',' + Math.round(x[2] * (1 - t) + y[2] * t) + ')';
}
function pSmooth(t) { return t * t * (3 - 2 * t); }
/* 구간별 알파가 있는 세로 스크림. stops 는 [[dy, alpha(0~255)], …] */
function pStops(x, y, w, h, rgb, stops) {
  var g = _ctx.createLinearGradient(0, y, 0, y + h);
  for (var i = 0; i <= 64; i++) {
    var t = i / 64, yy = t * h, a = 0;
    for (var k = 0; k < stops.length - 1; k++) {
      var y0 = stops[k][0], a0 = stops[k][1], y1 = stops[k + 1][0], a1 = stops[k + 1][1];
      if (yy >= y0 && yy <= y1) { a = a0 + (a1 - a0) * pSmooth((yy - y0) / (y1 - y0 || 1)); break; }
      if (yy > y1) a = a1;
    }
    g.addColorStop(t, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a / 255).toFixed(3) + ')');
  }
  _ctx.fillStyle = g; _ctx.fillRect(x, y, w, h);
}
function pRound(x, y, w, h, r) {
  _ctx.beginPath();
  _ctx.moveTo(x + r, y);
  _ctx.arcTo(x + w, y, x + w, y + h, r);
  _ctx.arcTo(x + w, y + h, x, y + h, r);
  _ctx.arcTo(x, y + h, x, y, r);
  _ctx.arcTo(x, y, x + w, y, r);
  _ctx.closePath();
}
function pHLine(x0, y0, x1, y1, color, lw) {
  _ctx.strokeStyle = color; _ctx.lineWidth = lw || 1;
  _ctx.beginPath(); _ctx.moveTo(x0, y0); _ctx.lineTo(x1, y1); _ctx.stroke();
}
function pImgFilter(f, fn) {
  var had = false;
  try { _ctx.filter = f; had = true; } catch (e) { }
  fn();
  if (had) { try { _ctx.filter = 'none'; } catch (e) { } }
}
function pLogoW(h) {
  var im = getImage('__logo_black__');
  if (imgOk(im)) return im.naturalWidth * h / im.naturalHeight;
  return h * 1.7;
}
function pHead(page, label, dark) {
  drawText(page, P_MX, 118, 26, 'extrabold', dark ? WHITE : P_INK, 'ls');
  pHLine(P_MX, 136, P_MX + 34, 136, dark ? 'rgba(255,255,255,0.40)' : pA(P_INK, 0.45), 2);
  tracked(String(label || '').toUpperCase(), P_MX, 170, 20, 'medium',
    dark ? 'rgba(255,255,255,0.62)' : pA(P_INK, 0.62), 6);
  drawLogo(dark ? 'white' : 'black', P_RIGHT - pLogoW(28), 100, 28);
}
/* 하단 가로 진행 바 — 2026-11-24 환희 님 확정: 점(···)·분할 막대 폐지.
   scripts/beauty_pick_carousel.py 의 `progress()` · 뷰티 포인트 `progressPoint()` 와 같은 규격:
   트랙 y 1332 (3px) · 진행분 y 1330 (7px) · 왼쪽부터 채운다. 진행분은 키 컬러,
   사진이 바닥까지 깔린 장표에서는 화이트. 표지(1장)에는 그리지 않는다. */
function pProgress(total, cur, dark) {
  total = Math.max(1, Number(total) || 1);
  cur = Math.min(Math.max(0, Number(cur) || 0), total);
  _ctx.fillStyle = dark ? 'rgba(255,255,255,0.25)' : P_INK;
  _ctx.fillRect(0, 1332, W, 3);
  var w = W * cur / total;
  if (w > 0) { _ctx.fillStyle = dark ? '#FFFFFF' : pKey(); _ctx.fillRect(0, 1330, w, 7); }
}
function pFooter(page, total, source, dark) {
  var muted = dark ? 'rgba(255,255,255,0.55)' : pA(P_INK, 0.5);
  if (source) {
    var lines = wrapText(source, 17, 'regular', P_CW - 60);
    if (lines.length) drawText(lines[0], P_MX, 1204, 17, 'regular', dark ? 'rgba(255,255,255,0.47)' : pA(P_INK, 0.42), 'ls');
    pHLine(P_MX, 1222, P_RIGHT, 1222, dark ? 'rgba(255,255,255,0.16)' : pA(P_INK, 0.12), 1);
  }
  var s = String((D && D.series) || 'BEAUTY PICK') + ' · ' + String((D && D.date) || '');
  tracked(s, P_MX, 1252, 17, 'medium', muted, 2);
  var t = page + ' / ' + pad2(total);
  tracked(t, P_RIGHT - trackedW(t, 17, 'medium', 2), 1252, 17, 'medium', muted, 2);
}
var _pHeadInk = 0;
function pHeadText(lines, top, size, fill, maxW) {
  var arr = (lines || []).map(function (l) { return Array.isArray(l) ? l.join('') : String(l); });
  var mw = maxW || P_CW, over = true, guard = 0;
  while (over && size > 46 && guard++ < 60) {
    over = false;
    for (var i = 0; i < arr.length; i++) if (measure(arr[i], size, 'extrabold') > mw) { over = true; break; }
    if (over) size -= 2;
  }
  var lh = Math.round(size * 1.16);
  var lastBase = top;
  for (var j = 0; j < arr.length; j++) {
    lastBase = top + j * lh + size * 0.82;
    drawText(arr[j], P_MX, lastBase, size, 'extrabold', fill, 'ls');
  }
  /* 마지막 줄 잉크의 아래 끝 — 표·박스가 여기서 28~56px를 잰다 (2026-11-24) */
  _pHeadInk = arr.length ? lastBase + inkSpan(size, 'extrabold').bottom : top;
  return top + lh * arr.length;
}
function pHeadInkBottom() { return _pHeadInk; }
function pLead(text, top, maxW, dark, size) {
  size = size || 27;
  var lines = wrapText(text || '', size, 'bold', (maxW || P_CW) - 28);
  var lh = Math.round(size * 1.38), h = lh * lines.length;
  pHLine(P_MX + 2, top + 4, P_MX + 2, top + h - 6, dark ? 'rgba(255,255,255,0.35)' : pA(P_INK, 0.22), 2);
  for (var i = 0; i < lines.length; i++) {
    drawText(lines[i], P_MX + 28, top + i * lh + size * 0.8, size, 'bold', dark ? WHITE : P_INK, 'ls');
  }
  return top + h;
}
function pPara(text, x, top, size, lineH, maxW, color) {
  var lines = wrapText(text || '', size, 'regular', maxW);
  for (var i = 0; i < lines.length; i++) {
    drawText(lines[i], x, top + i * lineH + lineH * 0.72, size, 'regular', color, 'ls');
  }
  return top + lineH * lines.length;
}
function pTags(tags, y, dark) {
  // 둥근 알약 대신 얇은 테두리의 네모 라벨 박스(영한 매거진 톤) — 파이썬 렌더러와 동일 규격
  var x = P_MX;
  (tags || []).forEach(function (t) {
    var s = String(t).toUpperCase(), tw = trackedW(s, 17, 'bold', 2.2);
    _ctx.strokeStyle = dark ? 'rgba(255,255,255,0.65)' : pA(P_INK, 0.38);
    _ctx.lineWidth = 1;
    _ctx.strokeRect(x + 0.5, y + 0.5, tw + 33, 39);
    tracked(s, x + 17, y + 27, 17, 'bold', dark ? WHITE : pA(P_INK, 0.82), 2.2);
    x += tw + 34 + 8;
  });
}

function pCallout(text, x, y, fill, size, tilt, padX, padY, shadow) {
  // 사진·종이 위에 살짝 기울여 붙인 스티커형 네모 박스.
  // 위치·크기·기울기는 편집 화면에서 글자로 들어올 수 있으므로 숫자로 맞춰 읽는다.
  padX = padX === undefined ? 30 : padX;
  padY = padY === undefined ? 19 : padY;
  x = Number(x) || 0; y = Number(y) || 0;
  size = Number(size) || 32;
  tilt = Number(tilt) || 0;
  text = text === undefined || text === null ? '' : String(text);
  var tw = measure(text, size, 'bold');
  // 문구가 길어져 캔버스 밖으로 넘치면 글자 크기를 줄여 오른쪽 여백 안에 넣는다.
  while (size > 15 && x + tw + padX * 2 > W - 24) { size -= 1; tw = measure(text, size, 'bold'); }
  var bw = tw + padX * 2, bh = size + padY * 2;
  _ctx.save();
  _ctx.translate(x + bw / 2, y + bh / 2);
  _ctx.rotate((tilt || 0) * Math.PI / 180);
  if (shadow) {
    _ctx.shadowColor = 'rgba(12,8,14,0.34)';
    _ctx.shadowBlur = shadow * 0.8;
    _ctx.shadowOffsetY = shadow;
  }
  _ctx.fillStyle = fill || '#FFFFFF';
  _ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  _ctx.shadowColor = 'transparent'; _ctx.shadowBlur = 0; _ctx.shadowOffsetY = 0;
  _ctx.strokeStyle = P_INK; _ctx.lineWidth = size >= 26 ? 3 : 2;
  _ctx.strokeRect(-bw / 2 + 1, -bh / 2 + 1, bw - 2, bh - 2);
  drawText(text, 0, 1, size, 'bold', P_INK, 'mm');
  _ctx.restore();
}
function pTakeaway(text, top, dark, width, size) {
  if (!text) return top;
  size = size || 24;
  var w = width || P_CW;
  var lines = wrapText(text, size, 'bold', w - 34);
  var lh = Math.round(size * 1.5);
  _ctx.fillStyle = pKey(); _ctx.fillRect(P_MX, top + 2, 4, lh * lines.length - 8);
  for (var i = 0; i < lines.length; i++) {
    drawText(lines[i], P_MX + 22, top + i * lh + lh * 0.72, size, 'bold',
      dark ? 'rgba(255,255,255,0.92)' : pMix(P_INK, pKey(), 0.35), 'ls');
  }
  return top + lh * lines.length;
}

function pickCover() {
  var c = (D && D.cover) || {};
  _ctx.fillStyle = '#EFEDE8'; _ctx.fillRect(0, 0, W, H);
  if (c.image) {
    pImgFilter('contrast(1.05) saturate(0.93)', function () {
      drawCoverCrop(c.image, 0, 0, W, H, 0.5, c.focus_y === undefined ? 0.5 : c.focus_y, 1);
    });
  }
  pStops(0, 0, W, H, [8, 10, 14], [[380, 0], [660, 150], [860, 220], [1040, 245], [H, 252]]);
  pHead(c.page || '01', c.label || 'PICK', false);

  var total = 1 + ((D.slides || []).length);
  var tagsY = 1168;
  var bodyLines = wrapText(c.body || '', 25, 'regular', 800);
  var bodyLh = 41, bodyH = bodyLines.length * bodyLh;
  var bodyTop = tagsY - 44 - bodyH;
  var leadTop = bodyTop - 54;
  var hl = (c.headline || []).map(function (l) { return Array.isArray(l) ? l.join('') : String(l); });
  var headSize = 84, over = true, guard = 0;
  while (over && headSize > 46 && guard++ < 40) {
    over = false;
    for (var i = 0; i < hl.length; i++) if (measure(hl[i], headSize, 'extrabold') > 890) { over = true; break; }
    if (over) headSize -= 2;
  }
  var headLh = Math.round(headSize * 1.14);
  var headTop = leadTop - 30 - headLh * hl.length;
  for (var j = 0; j < hl.length; j++) {
    drawText(hl[j], P_MX, headTop + j * headLh + headSize * 0.82, headSize, 'extrabold', WHITE, 'ls');
  }
  // 리드는 한 줄 고정 — 길어지면 글자 크기만 줄여 890px 안에 맞춘다.
  var leadSize = 26;
  while (leadSize > 17 && trackedW(c.lead || '', leadSize, 'bold', 1.6) > 890) leadSize -= 1;
  tracked(c.lead || '', P_MX + 30, leadTop + 26, leadSize, 'bold', 'rgba(255,255,255,0.91)', 1.6);
  pHLine(P_MX + 3, bodyTop - 2, P_MX + 3, tagsY - 50, 'rgba(255,255,255,0.27)', 2);
  for (var k = 0; k < bodyLines.length; k++) {
    drawText(bodyLines[k], P_MX + 30, bodyTop + k * bodyLh + 30, 25, 'regular', 'rgba(255,255,255,0.85)', 'ls');
  }
  pTags(c.tags || [], tagsY, true);
  if (c.photo_source) tracked(c.photo_source, P_MX, 1252, 15, 'medium', 'rgba(255,255,255,0.50)', 1);
  // 표지에는 인디케이터를 넣지 않는다(2026-11-24 확정).
}

function pickSlide(s, idx, total) {
  _ctx.fillStyle = pPaper(); _ctx.fillRect(0, 0, W, H);
  var page = s.page || pad2(idx);
  var kind = s.kind || 'story';
  var fn = pickStory;
  if (kind === 'stats') fn = pickStats;
  else if (kind === 'diagram') fn = pickDiagram;
  else if (kind === 'table') fn = pickTable;
  else if (kind === 'checks') fn = pickChecks;
  else if (kind === 'notes') fn = pickNotes;
  else if (kind === 'how') fn = pickHow;
  else if (kind === 'spot') fn = pickSpot;
  else if (kind === 'floor') fn = pickFloor;
  else if (kind === 'scale') fn = pickScale;
  else if (kind === 'age') fn = pickAge;
  else if (kind === 'check') fn = pickCheck;
  else if (kind === 'closing') fn = pickClosing;
  var out = fn(s, page, total);
  // 방송 캡처·보도 사진 네모 스티커 — scripts/beauty_pick_carousel.py photo_sticker() 와 같은 규격
  pPickStickers(s);
  return out;
}

function pPickStickers(s) {
  (s.stickers || []).forEach(function (st) {
    if (!st || !st.image) return;
    var w = Number(st.w) || 300, h = Number(st.h) || 170;
    var matte = 7, creditH = 26;
    var lw = w + matte * 2, lh = h + matte * 2 + creditH;
    var x = Number(st.x) || 0, y = Number(st.y) || 0;
    var tilt = st.tilt === undefined ? -1.6 : Number(st.tilt) || 0;
    _ctx.save();
    _ctx.translate(x + lw / 2, y + lh / 2);
    _ctx.rotate(tilt * Math.PI / 180);
    _ctx.shadowColor = 'rgba(12,8,14,0.30)';
    _ctx.shadowBlur = 5;
    _ctx.shadowOffsetX = 3;
    _ctx.shadowOffsetY = 8;
    _ctx.fillStyle = '#FFFFFF';
    _ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
    _ctx.shadowColor = 'transparent'; _ctx.shadowBlur = 0;
    _ctx.shadowOffsetX = 0; _ctx.shadowOffsetY = 0;
    drawCoverCrop(st.image, -lw / 2 + matte, -lh / 2 + matte, w, h,
      st.focus_x === undefined ? 0.5 : Number(st.focus_x),
      st.focus_y === undefined ? 0.5 : Number(st.focus_y), 1);
    _ctx.strokeStyle = pA(P_INK, 0.55); _ctx.lineWidth = 1;
    _ctx.strokeRect(-lw / 2 + 0.5, -lh / 2 + 0.5, lw - 1, lh - 1);
    var credit = (st.credit === undefined ? 'KBS 1TV' : String(st.credit)).toUpperCase();
    if (credit) tracked(credit, -lw / 2 + matte, -lh / 2 + matte + h + 18, 11, 'medium', pA(P_INK, 0.45), 1.6);
    _ctx.restore();
  });
}

function pickNotes(s, page, total) {
  // 사진 한 장으로 캔버스를 가득 채우고 큰 네모 스티커를 엇갈려 붙인다 — scripts/beauty_pick_carousel.py 와 동일 규격
  if (s.image) {
    pImgFilter('contrast(1.03) saturate(1.0) brightness(1.05)', function () {
      drawCoverCrop(s.image, 0, 0, W, H,
        s.focus_x === undefined ? 0.5 : s.focus_x,
        s.focus_y === undefined ? 0.5 : s.focus_y, 1);
    });
  }
  pStops(0, 0, W, H, [8, 10, 14], [[0, 196], [280, 152], [480, 62], [620, 0], [880, 0], [1110, 132], [H, 234]]);
  pHead(page, s.label, true);
  pHeadText(s.headline || [], 246, 72, WHITE, P_CW);
  (s.callouts || []).forEach(function (c) {
    pCallout(c.text, c.x, c.y, c.fill || '#FFFFFF', c.size || 32,
      c.tilt === undefined ? -1.6 : c.tilt, 30, 19, 8);
  });
  if (s.takeaway) pTakeaway(s.takeaway, 1136, true, 900, 28);
  pFooter(page, total, s.source, true);
  pProgress(total, Number(page) || 6, true);
}

function pickStory(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 258, 72, P_INK);
  y = Math.max(y + 24, 462);
  y = pLead(s.body, y, 900, false, 27);
  var factsTop = y + 52;
  pHLine(P_MX, factsTop, P_RIGHT, factsTop, pA(P_INK, 0.16), 1);
  var colW = P_CW / 3;
  (s.facts || []).forEach(function (f, i) {
    var x = P_MX + i * colW;
    drawText(f[0], x, factsTop + 66, 42, 'extrabold', P_INK, 'ls');
    drawText(f[1], x, factsTop + 103, 20, 'regular', pA(P_INK, 0.62), 'ls');
  });
  var tk = pTakeaway(s.takeaway, factsTop + 146, false);
  if (s.source) drawText(s.source, P_MX, Math.min(tk + 34, 842), 17, 'regular', pA(P_INK, 0.42), 'ls');
  var bandTop = 872, bandH = H - bandTop;
  if (s.image) {
    pImgFilter('contrast(1.05) saturate(0.9)', function () {
      drawCoverCrop(s.image, 0, bandTop, W, bandH, 0.5, s.band_focus === undefined ? 0.34 : s.band_focus, 1);
    });
  }
  pStops(0, bandTop, W, bandH, [8, 10, 14], [[0, 0], [150, 60], [bandH, 236]]);
  pFooter(page, total, null, true);
  pProgress(total, Number(page) || (Number(total) - 1), true);
}

function pickStats(s, page, total) {
  pHead(page, s.label, false);
  var side = s.side_image;
  var textW = P_CW;
  if (side) {
    var colX = 664;
    textW = colX - P_MX - 56;
    if (side.image) {
      pImgFilter('contrast(1.04) saturate(0.9)', function () {
        drawCoverCrop(side.image, colX, 176, W - colX, 1034, 0.5, 0.34, 1);
      });
    }
    pHLine(colX - 30, 176, colX - 30, 1210, pA(P_INK, 0.12), 1);
  }
  var y = pHeadText(s.headline || [], 258, side ? 66 : 72, P_INK, textW);
  var top = Math.max(y + 34, 470);
  if (side) {
    (s.stats || []).forEach(function (st) {
      drawText(st.value, P_MX, top + 96, 104, 'extrabold', pMix(P_INK, pKey(), 0.55), 'ls');
      drawText(st.unit, P_MX + 4, top + 140, 27, 'bold', P_INK, 'ls');
      drawText(st.note, P_MX + 4, top + 178, 21, 'regular', pA(P_INK, 0.6), 'ls');
      top += 214;
    });
    pHLine(P_MX, top - 8, P_MX + textW, top - 8, pA(P_INK, 0.14), 1);
    var y2 = pPara(s.body, P_MX, top + 22, 23, 38, textW, pA(P_INK, 0.84));
    pTakeaway(s.takeaway, y2 + 26, false, textW);
    if (s.source) drawText(s.source, P_MX, 1204, 17, 'regular', pA(P_INK, 0.42), 'ls');
    pHLine(P_MX, 1222, P_RIGHT, 1222, pA(P_INK, 0.12), 1);
    var s1 = String((D && D.series) || 'BEAUTY PICK') + ' · ' + String((D && D.date) || '');
    tracked(s1, P_MX, 1252, 17, 'medium', pA(P_INK, 0.5), 2);
    var t1 = page + ' / ' + pad2(total);
    tracked(t1, P_RIGHT - trackedW(t1, 17, 'medium', 2), 1252, 17, 'medium', pA(P_INK, 0.5), 2);
    pProgress(total, Number(page) || 3, false);
    return;
  }
  var colW = (P_CW - 60) / 2;
  (s.stats || []).forEach(function (st, i) {
    var x = P_MX + i * (colW + 60);
    drawText(st.value, x, top + 120, 126, 'extrabold', pMix(P_INK, pKey(), 0.55), 'ls');
    drawText(st.unit, x, top + 172, 28, 'bold', P_INK, 'ls');
    drawText(st.note, x, top + 212, 21, 'regular', pA(P_INK, 0.6), 'ls');
  });
  pHLine(P_MX + colW + 30, top + 10, P_MX + colW + 30, top + 236, pA(P_INK, 0.14), 1);
  var bodyTop = top + 300;
  pHLine(P_MX, bodyTop - 34, P_RIGHT, bodyTop - 34, pA(P_INK, 0.14), 1);
  var y3 = pPara(s.body, P_MX, bodyTop, 26, 44, 900, pA(P_INK, 0.84));
  pTakeaway(s.takeaway, y3 + 30, false);
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 3, false);
}

function pickDiagram(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 258, 72, P_INK);
  var top = Math.max(y + 40, 486);
  if (s.banner) {
    var bw = trackedW(s.banner, 18, 'medium', 3);
    pRound(P_RIGHT - bw - 56, top - 64, bw + 56, 46, 23);
    _ctx.fillStyle = pMix(P_INK, pKey(), 0.85); _ctx.fill();
    tracked(s.banner, P_RIGHT - bw - 28, top - 33, 18, 'medium', WHITE, 3);
  }
  var barTop = top;
  (s.rows || []).forEach(function (row) {
    var w = Math.round((P_CW - 60) * (row.ratio === undefined ? 1 : Number(row.ratio))) + 60;
    pRound(P_MX, barTop, w, 128, 6);
    _ctx.fillStyle = row.tone === 'key' ? pMix(P_INK, pKey(), 0.85) : P_INK; _ctx.fill();
    drawText(row.title, P_MX + 40, barTop + 56, 38, 'extrabold', WHITE, 'ls');
    tracked(row.sub || '', P_MX + 40, barTop + 96, 18, 'medium', 'rgba(255,255,255,0.75)', 3);
    drawText(row.text || '', P_MX, barTop + 178, 23, 'regular', pA(P_INK, 0.72), 'ls');
    barTop += 236;
  });
  var y2 = pPara(s.body, P_MX, barTop + 26, 26, 44, 900, pA(P_INK, 0.84));
  pTakeaway(s.takeaway, y2 + 30, false);
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 4, false);
}

function pickTable(s, page, total) {
  /* 2026-11-26 환희 님 지시로 `안 되면` 열을 빼고 3열(확인할 것 | 이렇게 확인 |
     막아야 할 것)로 정리했다. 열 수에 상관없이 그리고, 아래 각주·강조 줄·자료 줄을
     **아래에서 위로** 먼저 앉힌 뒤 남는 높이를 행에 나눈다 — scripts/beauty_pick_carousel.py
     의 make_table 과 같은 식이라 미리보기에서 문구가 푸터와 겹치지 않는다. */
  pHead(page, s.label, false);
  pHeadText(s.headline, 258, 72, P_INK);
  /* 표 위 여백은 28~56px 범위 고정 — 헤드라인 잉크 아래 끝에서 (2026-11-24) */
  var top = pHeadInkBottom(s) + GAP_DEFAULT;
  var cols = s.columns || [];
  var n = cols.length || 3;
  var widths = (s.widths || []).map(function (w2) { return Number(w2) || 0; });
  if (widths.length !== n) widths = [26, 46, 28].slice(0, n);
  var xs = [P_MX];
  for (var i = 0; i < widths.length - 1; i++) xs.push(xs[xs.length - 1] + P_CW * widths[i] / 100);
  var colW = widths.map(function (w2) { return P_CW * w2 / 100; });
  var HEAD_H = 66, ROW_CAP = 132;

  /* 열별 글꼴 — 첫 열은 확인할 것(굵게), 마지막 열은 막아야 할 것(키 컬러), 가운데는 설명 */
  var styles = [];
  for (var si = 0; si < n; si++) {
    if (si === 0) styles.push({ size: 23, weight: 'bold', ink: P_INK, lead: 32 });
    else if (si === n - 1 && n > 2) styles.push({ size: 27, weight: 'extrabold', ink: pMix(P_INK, pKey(), 0.5), lead: 34 });
    else styles.push({ size: 24, weight: 'regular', ink: pA(P_INK, 0.7), lead: 32 });
  }
  var rows = s.rows || [];
  var cellLines = rows.map(function (row) {
    return styles.map(function (st, i) {
      return wrapText(String(row[i] === undefined ? '' : row[i]), st.size, st.weight, colW[i] - 14);
    });
  });

  /* --- 하단 세 블록을 아래에서 위로 앉힌다 (파이썬과 같은 식) --- */
  var nl = s.note ? wrapText(s.note, 19, 'regular', P_CW) : [];
  var tk = s.takeaway ? wrapText(s.takeaway, 24, 'bold', P_CW - 34) : [];
  var SRC_INK_TOP = 1190, GAP_TK_SRC = 36, GAP_NOTE_TK = 44, TK_LH = 36;
  var tkSpan = inkSpan(24, 'bold');
  var tkInkTopOff = TK_LH * 0.72 + tkSpan.top;
  var tkInkBotOff = TK_LH * 0.72 + (tk.length - 1) * TK_LH + tkSpan.bottom;
  var tkInkBottom = SRC_INK_TOP - GAP_TK_SRC;
  var tkTop = tk.length ? tkInkBottom - tkInkBotOff : tkInkBottom;
  var noteInkBottom = tk.length ? (tkTop + tkInkTopOff - GAP_NOTE_TK) : tkInkBottom;
  var noteY, tableBottom;
  if (nl.length) {
    noteY = noteInkBottom - ((nl.length - 1) * 28 + 16 + inkSpan(19, 'regular').bottom);
    tableBottom = noteY - GAP_DEFAULT;
  } else {
    noteY = noteInkBottom;
    tableBottom = noteInkBottom - GAP_DEFAULT;
  }

  var nRows = Math.max(1, rows.length);
  var tInk = Math.min.apply(null, styles.map(function (st) { return inkSpan(st.size, st.weight).top; }));
  var rowInk = cellLines.map(function (lines) {
    return Math.max.apply(null, lines.map(function (ls, i) {
      return (ls.length - 1) * styles[i].lead + inkSpan(styles[i].size, styles[i].weight).bottom;
    })) - tInk;
  });
  var rowH = (tableBottom - top - HEAD_H) / nRows;
  rowH = Math.max(Math.max.apply(null, rowInk) + 40, Math.min(rowH, ROW_CAP));

  pHLine(P_MX, top, P_RIGHT, top, pA(P_INK, 0.75), 2);
  /* 열 이름 행 — 괘선과 첫 행 사이에 위·아래 같은 여백 (파이썬 make_table 과 같은 식) */
  var colBase = cellBase(18, 'medium', top, top + HEAD_H);
  cols.forEach(function (col, j) {
    tracked(col, xs[j], colBase, 18, 'medium', pA(P_INK, 0.55), 3);
  });
  var rowTop = top + HEAD_H;

  /* 한 행의 글자(여러 열·여러 줄)를 한 덩이로 보고 잉크의 위·아래 여백이 같아지게 앉힌다 */
  rows.forEach(function (row, r) {
    pHLine(P_MX, rowTop, P_RIGHT, rowTop, pA(P_INK, 0.18), 1);
    var bInk = Math.max.apply(null, cellLines[r].map(function (ls, i) {
      return (ls.length - 1) * styles[i].lead + inkSpan(styles[i].size, styles[i].weight).bottom;
    }));
    var base = rowTop + (rowH - (bInk - tInk)) / 2 - tInk;
    for (var i = 0; i < n; i++) {
      var st = styles[i], ls = cellLines[r][i];
      for (var k = 0; k < ls.length; k++) {
        drawText(ls[k], xs[i], base + k * st.lead, st.size, st.weight, st.ink, 'ls');
      }
    }
    rowTop += rowH;
  });
  pHLine(P_MX, rowTop, P_RIGHT, rowTop, pA(P_INK, 0.18), 1);

  for (var j = 0; j < nl.length; j++) drawText(nl[j], P_MX, noteY + j * 28 + 16, 19, 'regular', pA(P_INK, 0.52), 'ls');
  pTakeaway(s.takeaway, tkTop, false);
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 5, false);
}

function pickChecks(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 252, 72, P_INK);
  // 하단에 사진 두 장이 들어가는 장표는 목록 줄 간격을 조금 조인다(2026-11-26)
  var pair = s.photo_pair || {};
  var tight = !!(pair.images && pair.images.length);
  var cy;
  if (s.lead) {   // 앞 장과 이어 주는 설명 한 줄 (scripts/beauty_pick_carousel.make_checks 와 동일)
    y = pLead(s.lead, Math.max(y + 14, 424), 900, false, 26);
    cy = Math.max(y + (tight ? 18 : 30), 452);
  } else {
    cy = Math.max(y + 26, 452);
  }
  var rowIn = tight ? 88 : 98, rowTail = tight ? 22 : 30;
  var ruleR = s.rule_right ? Number(s.rule_right) : P_RIGHT;   // 사진이 붙는 오른쪽 열을 비울 때
  (s.items || []).forEach(function (item, idx) {
    pHLine(P_MX, cy, ruleR, cy, pA(P_INK, 0.18), 1);
    drawText(pad2(idx + 1), P_MX, cy + 50, 20, 'extrabold', pMix(P_INK, pKey(), 0.6), 'ls');
    drawText(item.title, P_MX + 56, cy + 52, 29, 'extrabold', P_INK, 'ls');
    var lines = wrapText(item.body, 23, 'regular', P_CW - 56);
    for (var j = 0; j < lines.length; j++) drawText(lines[j], P_MX + 56, cy + 98 + j * 34, 23, 'regular', pA(P_INK, 0.74), 'ls');
    cy += rowIn + lines.length * 34 + rowTail;
  });
  pHLine(P_MX, cy, ruleR, cy, pA(P_INK, 0.18), 1);
  var y2 = pPara(s.body, P_MX, cy + 26, 21, 32, 906, pA(P_INK, 0.62));
  if (tight) pPickPhotoPair(s, y2 + (pair.gap_above === undefined ? 20 : Number(pair.gap_above)));
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 6, false);
}

/* ---- 뷰티 픽: 하단 방송 스틸컷 2장 (scripts/beauty_pick_carousel.photo_pair 와 같은 규격) ----
   2026-11-26: 제목 옆 좁은 틈·항목 사이에 끼던 사진을 걷어 내고, 목록·문장 아래 남는
   여백에 두 장을 **같은 크기로 좌우 정렬**해 앉힌다(기본은 매트·기울기 없이 사진만). */
function pPickPhotoPair(s, top) {
  var pp = s.photo_pair || {};
  var items = pp.images || [];
  if (!items.length) return;
  var frame = pp.frame === undefined ? true : !!pp.frame;
  var matte = frame ? 7 : 0, creditH = frame ? 26 : 0;
  var tilts = pp.tilts || [-1.2, 1.2];
  var t = Math.max(Math.abs(tilts[0] || 0), Math.abs(tilts[1] || 0)) * Math.PI / 180;
  var cosT = Math.cos(t), sinT = Math.sin(t);
  var bottom = pp.bottom === undefined ? 1176 : Number(pp.bottom);
  var gap = pp.gap === undefined ? 44 : Number(pp.gap);
  var availH = bottom - top;
  if (availH < 70) return;
  var lwMax = items.length > 1 ? (P_CW - gap) / 2 : P_CW;
  function foot(w, h) {
    var lw = w + matte * 2, lh = h + matte * 2 + creditH;
    return [lw * cosT + lh * sinT, lw * sinT + lh * cosT];
  }
  var pick = null;
  if (pp.size && pp.size.length === 2) {   // 페이지마다 같은 크기로 맞출 때
    var f0 = foot(Number(pp.size[0]), Number(pp.size[1]));
    if (f0[0] <= lwMax && f0[1] <= availH) pick = [Number(pp.size[1]), Number(pp.size[0]), f0[0], f0[1]];
  }
  if (!pick) {
    var ideal = (lwMax - matte * 2) / Math.max(1, availH - creditH - matte * 2);
    var aspect = Math.min(Math.max(ideal, 1.45), 2.30);
    for (var hh = Math.floor(availH); hh > 79; hh--) {
      var f1 = foot(hh * aspect, hh);
      if (f1[0] <= lwMax && f1[1] <= availH) { pick = [hh, hh * aspect, f1[0], f1[1]]; break; }
    }
  }
  if (!pick) return;
  var h = pick[0], w = pick[1], rw = pick[2], rh = pick[3];
  var xs = [];
  if (items.length === 1) { xs = [P_MX + (P_CW - rw) / 2]; tilts = [0]; }
  else {
    var total = rw * items.length + gap * (items.length - 1), x0 = P_MX + (P_CW - total) / 2;
    for (var i = 0; i < items.length; i++) xs.push(x0 + i * (rw + gap));
  }
  var y = Math.round(bottom - rh);
  items.forEach(function (st, i) {
    if (!st || !st.image) return;
    var tilt = tilts[i] || 0;
    if (!frame) {
      drawCoverCrop(st.image, Math.round(xs[i]), y, Math.round(w), Math.round(h),
        st.focus_x === undefined ? 0.5 : Number(st.focus_x),
        st.focus_y === undefined ? 0.5 : Number(st.focus_y), 1);
      return;
    }
    var lw = w + matte * 2, lh = h + matte * 2 + creditH;
    _ctx.save();
    _ctx.translate(xs[i] + lw / 2, y + lh / 2);
    _ctx.rotate(tilt * Math.PI / 180);
    _ctx.fillStyle = '#FFFFFF';
    _ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
    drawCoverCrop(st.image, -lw / 2 + matte, -lh / 2 + matte, w, h,
      st.focus_x === undefined ? 0.5 : Number(st.focus_x),
      st.focus_y === undefined ? 0.5 : Number(st.focus_y), 1);
    _ctx.strokeStyle = pA(P_INK, 0.55); _ctx.lineWidth = 1;
    _ctx.strokeRect(-lw / 2 + 0.5, -lh / 2 + 0.5, lw - 1, lh - 1);
    tracked((st.credit === undefined ? 'KBS 1TV' : String(st.credit)).toUpperCase(),
      -lw / 2 + matte, -lh / 2 + matte + h + 18, 11, 'medium', pA(P_INK, 0.45), 1.6);
    _ctx.restore();
  });
}

/* ---- 뷰티 픽: 매대 비교 도해(02 HOW) ---- */
function pProductShape(x, y, w, h, fill) {
  pRound(x, y, w, h, Math.max(2, Math.round(w * 0.16)));
  _ctx.fillStyle = fill; _ctx.fill();
  _ctx.strokeStyle = pA(P_INK, 0.20); _ctx.lineWidth = 1; _ctx.stroke();
  var cw = Math.max(4, w * 0.42), chh = Math.max(3, h * 0.14);
  _ctx.fillStyle = pMix(fill, P_INK, 0.28);
  _ctx.fillRect(x + (w - cw) / 2, y - chh, cw, chh + 2);
}
function pBrandWall(x, y, w, h, names) {
  // 이름표는 panel.names 로 고칠 수 있다. 비어 있으면 기본 브랜드 A~C.
  names = (names && names.length) ? names : ['브랜드 A', '브랜드 B', '브랜드 C'];
  var tones = [['#F5D2E2', '#EBB6CD', '#FBE3EE'],
               ['#E2D8F1', '#CDBCE6', '#EFE8F8'],
               ['#DDEBDE', '#C1D9C4', '#EBF4EC']];
  var n = names.length, gap = 12, cw = (w - gap * (n - 1)) / n;
  for (var i = 0; i < n; i++) {
    var cx = x + i * (cw + gap), tone = tones[i % tones.length];
    pRound(cx, y, cw, h, 6); _ctx.fillStyle = '#FBF8F5'; _ctx.fill();
    _ctx.strokeStyle = pA(P_INK, 0.16); _ctx.lineWidth = 1; _ctx.stroke();
    var nm = String(names[i] === undefined || names[i] === null ? '' : names[i]);
    var fs = 15;
    while (fs > 9 && measure(nm, fs, 'bold') > cw - 12) fs -= 1;
    drawText(nm, cx + cw / 2, y + 26, fs, 'bold', pA(P_INK, 0.62), 'mm');
    var sh = (h - 58) / 4, top = y + 44;
    for (var k = 0; k < 4; k++) {
      var baseY = top + (k + 1) * sh - 10;
      pHLine(cx + 8, baseY, cx + cw - 8, baseY, pA(P_INK, 0.16), 1);
      for (var j = 0; j < 3; j++) {
        var pw = (cw - 36) / 3, ph = 30 + (k + j) % 3 * 7;
        pProductShape(cx + 12 + j * (pw + 6), baseY - ph, pw, ph, tone[j % 3]);
      }
    }
  }
}
function pTypeWall(x, y, w, h, labels) {
  // 종류 이름표는 panel.labels 로 고칠 수 있다. 비어 있으면 기본 네 가지.
  labels = (labels && labels.length) ? labels : ['베이스·쿠션', '립', '아이', '블러셔'];
  var palette = ['#F5D2E2', '#E2D8F1', '#DDEBDE', '#FBEFD2', '#D8E5F2', '#F6E2D6'];
  var n = labels.length, gap = 10, rh = (h - gap * (n - 1)) / n;
  for (var i = 0; i < n; i++) {
    var ry = y + i * (rh + gap);
    pRound(x, ry, w, rh, 6); _ctx.fillStyle = '#FBF8F5'; _ctx.fill();
    _ctx.strokeStyle = pA(P_INK, 0.16); _ctx.lineWidth = 1; _ctx.stroke();
    var lab = String(labels[i] === undefined || labels[i] === null ? '' : labels[i]);
    var fs = 15;
    while (fs > 9 && measure(lab, fs, 'bold') > 126) fs -= 1;
    drawText(lab, x + 14, ry + rh / 2 + 1, fs, 'bold', pA(P_INK, 0.66), 'lm');
    var px0 = x + 148, pw = (w - 166) / 5, baseY = ry + rh - 14;
    for (var j = 0; j < 5; j++) {
      var ph = 30 + (i + j) % 3 * 8;
      pProductShape(px0 + j * (pw + 4), baseY - ph, pw - 4, ph, palette[(i * 2 + j) % 6]);
    }
  }
}
function pComparePanel(panel, x, y, w, h) {
  pRound(x, y, w, h, 8); _ctx.fillStyle = WHITE; _ctx.fill();
  _ctx.strokeStyle = pA(P_INK, 0.13); _ctx.lineWidth = 1; _ctx.stroke();
  drawText(panel.title, x + 26, y + 44, 28, 'extrabold', P_INK, 'ls');
  tracked(panel.sub || '', x + 26, y + 72, 15, 'medium', pA(P_INK, 0.45), 4);
  var ax = x + 26, ay = y + 96, aw = w - 52, ah = h - 96 - 62;
  if (panel.type === 'brand') pBrandWall(ax, ay, aw, ah, panel.names);
  else pTypeWall(ax, ay, aw, ah, panel.labels);
  drawText(panel.caption || '', x + 26, y + h - 20, 18, 'regular', pA(P_INK, 0.6), 'ls');
}
function pickHow(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 258, 72, P_INK);
  var top = Math.max(y + 26, 438);
  var lines = wrapText(s.intro || '', 24, 'regular', 900);
  for (var i = 0; i < lines.length; i++) {
    drawText(lines[i], P_MX, top + i * 38 + 38 * 0.72, 24, 'regular', pA(P_INK, 0.82), 'ls');
  }
  var introBottom = top + lines.length * 38;
  if (s.banner) {
    var bw = trackedW(s.banner, 18, 'medium', 3);
    _ctx.fillStyle = pMix(P_INK, pKey(), 0.85);
    _ctx.fillRect(P_RIGHT - bw - 48, 300, bw + 48, 46);
    tracked(s.banner, P_RIGHT - bw - 24, 329, 18, 'medium', WHITE, 3);
  }
  var panelsTop = Math.max(introBottom + 40, 520), panelH = 468, gap = 40;
  var pw = (P_CW - gap) / 2;
  (s.panels || []).forEach(function (panel, idx) {
    pComparePanel(panel, P_MX + idx * (pw + gap), panelsTop, pw, panelH);
  });
  pTakeaway(s.takeaway, panelsTop + panelH + 52, false);
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 2, false);
}

/* ---- 뷰티 픽: 현장 사진 + 스티커(03 SPOT) ---- */
function pickSpot(s, page, total) {
  var photoH = 1000;
  _ctx.fillStyle = pPaper(); _ctx.fillRect(0, 0, W, H);
  if (s.image) {
    pImgFilter('contrast(1.04) saturate(1.0) brightness(1.01)', function () {
      drawCoverCrop(s.image, 0, 0, W, photoH,
        s.focus_x === undefined ? 0.5 : s.focus_x,
        s.focus_y === undefined ? 0.5 : s.focus_y, 1);
    });
  }
  pStops(0, 0, W, photoH, [8, 10, 14], [[0, 220], [300, 198], [540, 0], [photoH, 0]]);
  pHead(page, s.label, true);
  _ctx.save();
  _ctx.shadowColor = 'rgba(10,4,10,0.62)';
  _ctx.shadowBlur = 22;
  _ctx.shadowOffsetY = 2;
  pHeadText(s.headline || [], 246, 72, WHITE);
  _ctx.restore();
  (s.callouts || []).forEach(function (c) {
    pCallout(c.text, c.x, c.y, c.fill || '#FFFFFF', c.size || 32,
      c.tilt === undefined ? -1.6 : c.tilt, 30, 19, 8);
  });
  pTakeaway(s.takeaway, photoH + 54, false, undefined, 27);
  if (s.note) drawText(s.note, P_MX, photoH + 132, 18, 'regular', pA(P_INK, 0.5), 'ls');
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 3, false);
}

/* ---- 뷰티 픽: 층별 안내(04 FLOOR) ---- */
function pickFloor(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 258, 72, P_INK);
  var ansTop = Math.max(y + 27, 452);
  var lead = wrapText(s.answer || '', 27, 'bold', 872), lh = Math.round(27 * 1.38);
  pHLine(P_MX + 2, ansTop + 4, P_MX + 2, ansTop + lh * lead.length - 6, pA(P_INK, 0.22), 2);
  for (var i = 0; i < lead.length; i++) {
    drawText(lead[i], P_MX + 28, ansTop + i * lh + 27 * 0.8, 27, 'bold', P_INK, 'ls');
  }
  /* 표 위 여백과 표 아래(각주) 여백을 같은 값으로 (파이썬 make_floor 와 같은 식) */
  var gap = clampGap(s.table_gap === undefined ? GAP_DEFAULT : s.table_gap);
  var ansBottom = ansTop + lh * (lead.length - 1) + 27 * 0.8 + inkSpan(27, 'bold').bottom;
  var top = ansBottom + gap;
  // 표는 3열 고정(층 · 무엇이 있나 · 대표 체험·공간). 폭 배열이나 열 이름이 어긋나도 기본값으로 그린다.
  var widths = s.widths || [11, 34, 55];
  if (widths.length !== 3) widths = [11, 34, 55];
  widths = widths.map(function (w2) { return Number(w2) || 0; });
  var xs = [P_MX], colW = [];
  for (var q = 0; q < widths.length; q++) colW.push(P_CW * widths[q] / 100);
  for (var k = 0; k < widths.length - 1; k++) xs.push(xs[xs.length - 1] + colW[k]);
  pHLine(P_MX, top, P_RIGHT, top, pA(P_INK, 0.75), 2);
  var colBase = cellBase(17, 'medium', top, top + 58);
  (s.columns || []).forEach(function (col, j) {
    if (xs[j] === undefined) return;
    tracked(col, xs[j], colBase, 17, 'medium', pA(P_INK, 0.55), 3);
  });
  var rowTop = top + 58;
  var numOff = 10, descOff = 28, descLead = 24, whatLead = 28;
  var tInk = Math.min(inkSpan(21, 'extrabold').top, numOff + inkSpan(30, 'extrabold').top,
                      inkSpan(20, 'regular').top);
  (s.rows || []).forEach(function (row) {
    var what = wrapText(row.what || '', 20, 'regular', colW[1] - 34);
    var desc = wrapText(row.desc || '', 18, 'regular', colW[2] - 24);
    var rowH = 34 + 26 + desc.length * descLead + 22;
    pHLine(P_MX, rowTop, P_RIGHT, rowTop, pA(P_INK, 0.18), 1);
    var bInk = descOff + descLead * (desc.length - 1) + inkSpan(18, 'regular').bottom;
    var base = rowTop + (rowH - (bInk - tInk)) / 2 - tInk;      /* 제목 기준선 */
    drawText(row.floor, xs[0], base + numOff, 30, 'extrabold', pMix(P_INK, pKey(), 0.55), 'ls');
    for (var m = 0; m < what.length; m++) {
      drawText(what[m], xs[1], base + m * whatLead, 20, 'regular', pA(P_INK, 0.78), 'ls');
    }
    drawText(row.title, xs[2], base, 21, 'extrabold', P_INK, 'ls');
    if (row.tag) {
      tracked(row.tag, P_RIGHT - trackedW(row.tag, 15, 'medium', 1), base, 15, 'medium', pA(P_INK, 0.45), 1);
    }
    for (var n = 0; n < desc.length; n++) {
      drawText(desc[n], xs[2], base + descOff + n * descLead, 18, 'regular', pA(P_INK, 0.66), 'ls');
    }
    rowTop += rowH;
  });
  pHLine(P_MX, rowTop, P_RIGHT, rowTop, pA(P_INK, 0.18), 1);
  var note = wrapText(s.note || '', 18, 'regular', P_CW);
  for (var r = 0; r < note.length; r++) {
    drawText(note[r], P_MX, rowTop + gap + r * 26 + 14, 18, 'regular', pA(P_INK, 0.5), 'ls');
  }
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 4, false);
}

/* ---- 뷰티 픽: 배경·규모 합본(05 SCALE) ---- */
function pickScale(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 258, 72, P_INK);
  var top = Math.max(y + 26, 442);
  var stats = s.stats || [], gap = 14;
  var cw = (P_CW - gap * (stats.length - 1)) / stats.length;
  stats.forEach(function (st, i) {
    var cx = P_MX + i * (cw + gap);
    _ctx.fillStyle = pMix(pPaper(), P_INK, 0.055);
    _ctx.fillRect(cx, top, cw, 116);
    var size = 31;
    while (measure(st.value, size, 'extrabold') > cw - 26 && size > 20) size -= 1;
    drawText(st.value, cx + 14, top + 48, size, 'extrabold', pMix(P_INK, pKey(), 0.55), 'ls');
    var nl = wrapText(st.note || '', 15, 'regular', cw - 26);
    for (var j = 0; j < nl.length; j++) {
      drawText(nl[j], cx + 14, top + 74 + j * 19, 15, 'regular', pA(P_INK, 0.58), 'ls');
    }
  });
  var y2 = pPara(s.body, P_MX, top + 152, 25, 40, 900, pA(P_INK, 0.84));
  pTakeaway(s.takeaway, y2 + 26, false);
  if (s.image) {
    pImgFilter('contrast(1.04) saturate(1.0) brightness(1.02)', function () {
      drawCoverCrop(s.image, 0, 856, W, 314, 0.5,
        s.band_focus === undefined ? 0.5 : s.band_focus, 1);
    });
  }
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 5, false);
}

/* ---- 뷰티 픽: 연령 경쟁(06 AGE) ---- */
function pickAge(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 250, 70, P_INK);
  if (s.lead) y = pLead(s.lead, Math.max(y + 16, 418), 900, false, 26);
  var top = Math.max(s.lead ? y + 34 : y + 40, 452), colGap = 56, cw = (P_CW - colGap) / 2;
  (s.stats || []).forEach(function (st, i) {
    var cx = P_MX + i * (cw + colGap), size = i === 0 ? 108 : 74;
    while (measure(st.value, size, 'extrabold') > cw - 6 && size > 34) size -= 2;
    drawText(st.value, cx, top + size * 0.92, size, 'extrabold', pMix(P_INK, pKey(), 0.55), 'ls');
    drawText(st.note || '', cx + 2, top + size * 0.92 + 40, 20, 'regular', pA(P_INK, 0.62), 'ls');
  });
  pHLine(P_MX + cw + colGap / 2, top + 16, P_MX + cw + colGap / 2, top + 168, pA(P_INK, 0.14), 1);
  var bodyTop = top + 210;
  pHLine(P_MX, bodyTop - 40, P_RIGHT, bodyTop - 40, pA(P_INK, 0.14), 1);
  var y2 = pPara(s.body, P_MX, bodyTop, 25, 40, 900, pA(P_INK, 0.84));
  y2 = pTakeaway(s.takeaway, y2 + 28, false);
  var pair = s.photo_pair || {};
  if (pair.images && pair.images.length) {
    // 강조 문구 아래 남는 여백에 방송 스틸컷 두 장을 같은 크기로 나란히 (2026-11-26)
    pPickPhotoPair(s, y2 + (pair.gap_above === undefined ? 24 : Number(pair.gap_above)));
  }
  var mini = s.mini;
  if (mini) {
    var ty = y2 + 48;
    pHLine(P_MX, ty, P_RIGHT, ty, pA(P_INK, 0.22), 2);
    /* 작은 표도 머리글·행 모두 잉크 위·아래 여백을 같게 (2026-11-24) */
    var mb0 = blockBase(16, 'medium', ty, ty + 84, 2, 34);
    var mBase = [mb0, mb0 + 34];   /* blockBase 는 첫 기준선 하나를 돌려준다 */
    tracked(mini.head || '', P_MX, mBase[0], 16, 'medium', pA(P_INK, 0.55), 2);
    var colx = [];
    var mcols = mini.cols || [];
    // 첫 열은 항목 이름, 나머지는 오른쪽으로 펼친다(3열일 때는 기존 자리 그대로).
    for (var ci = 0; ci < mcols.length; ci++) {
      colx.push(ci === 0 ? P_MX : ci === 1 ? P_MX + 380 : P_MX + 640 + (ci - 2) * 140);
    }
    mcols.forEach(function (c, i) {
      if (colx[i] === undefined) return;
      tracked(c, colx[i], mBase[1], 16, 'medium', pA(P_INK, 0.5), 2);
    });
    var ry = ty + 84;
    (mini.rows || []).forEach(function (row) {
      pHLine(P_MX, ry, P_RIGHT, ry, pA(P_INK, 0.14), 1);
      var base = cellBase(21, 'bold', ry, ry + 58);
      for (var cj = 0; cj < mcols.length; cj++) {
        var cell = row[cj] === undefined || row[cj] === null ? '' : String(row[cj]);
        if (!cell || colx[cj] === undefined) continue;
        if (cj === 0) drawText(cell, colx[cj], base, 19, 'regular', pA(P_INK, 0.66), 'ls');
        else drawText(cell, colx[cj], base, 21, 'bold', P_INK, 'ls');
      }
      ry += 58;
    });
    pHLine(P_MX, ry, P_RIGHT, ry, pA(P_INK, 0.14), 1);
  }
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 6, false);
}

/* ---- 뷰티 픽: 방문 전 확인(07 CHECK) ---- */
function pPinIcon(x, y, sz, color) {
  _ctx.fillStyle = color;
  _ctx.beginPath(); _ctx.ellipse(x, y - sz * 0.10, sz * 0.30, sz * 0.30, 0, 0, Math.PI * 2); _ctx.fill();
  _ctx.beginPath();
  _ctx.moveTo(x - sz * 0.21, y + sz * 0.04);
  _ctx.lineTo(x + sz * 0.21, y + sz * 0.04);
  _ctx.lineTo(x, y + sz * 0.60);
  _ctx.closePath(); _ctx.fill();
  _ctx.fillStyle = WHITE;
  _ctx.beginPath(); _ctx.arc(x, y - sz * 0.08, sz * 0.11, 0, Math.PI * 2); _ctx.fill();
}
function pClockIcon(x, y, sz, color) {
  _ctx.strokeStyle = color; _ctx.lineWidth = Math.max(2, sz * 0.1);
  _ctx.beginPath(); _ctx.arc(x, y, sz * 0.46, 0, Math.PI * 2); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(x, y); _ctx.lineTo(x, y - sz * 0.28); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(x, y); _ctx.lineTo(x + sz * 0.2, y + sz * 0.1); _ctx.stroke();
}
function pArrowIcon(x0, x1, y, color) {
  pHLine(x0, y, x1, y, color, 2);
  _ctx.fillStyle = color;
  _ctx.beginPath(); _ctx.moveTo(x1, y); _ctx.lineTo(x1 - 9, y - 5); _ctx.lineTo(x1 - 9, y + 5);
  _ctx.closePath(); _ctx.fill();
}
function pickCheck(s, page, total) {
  pHead(page, s.label, false);
  var y = pHeadText(s.headline, 252, 72, P_INK);
  var cy = Math.max(y + 30, 456);
  (s.items || []).forEach(function (item, idx) {
    pHLine(P_MX, cy, P_RIGHT, cy, pA(P_INK, 0.18), 1);
    drawText(pad2(idx + 1), P_MX, cy + 48, 20, 'extrabold', pMix(P_INK, pKey(), 0.6), 'ls');
    drawText(item.title, P_MX + 56, cy + 50, 29, 'extrabold', P_INK, 'ls');
    var yy = cy + 94, route = item.route, lines;
    // 동선 줄은 출발지·도착지·운영 시간 중 하나라도 적혀 있을 때만 그린다.
    if (route && !(route.from || route.to || route.hours || route.walk)) route = null;
    if (route) {
      pPinIcon(P_MX + 74, yy + 8, 30, pKey());
      drawText(route.from, P_MX + 96, yy + 20, 24, 'bold', P_INK, 'ls');
      var wFrom = measure(route.from, 24, 'bold');
      var ax0 = P_MX + 96 + wFrom + 20;
      pArrowIcon(ax0, ax0 + 54, yy + 10, pA(P_INK, 0.45));
      drawText(route.walk, ax0, yy + 44, 16, 'regular', pA(P_INK, 0.55), 'ls');
      var bx = ax0 + 70;
      pPinIcon(bx + 10, yy + 8, 30, pKey());
      drawText(route.to, bx + 32, yy + 20, 24, 'bold', P_INK, 'ls');
      yy += 54;
      pClockIcon(P_MX + 78, yy + 10, 26, pA(P_INK, 0.55));
      tracked(route.hours, P_MX + 100, yy + 19, 21, 'bold', pA(P_INK, 0.8), 1);
      yy += 62;
      lines = wrapText(item.body, 21, 'regular', P_CW - 60);
    } else {
      lines = wrapText(item.body, 23, 'regular', P_CW - 56);
    }
    for (var j = 0; j < lines.length; j++) {
      drawText(lines[j], P_MX + 56, yy + j * 34, 23, 'regular', pA(P_INK, 0.74), 'ls');
    }
    cy = yy + lines.length * 34 + 26;
  });
  pHLine(P_MX, cy, P_RIGHT, cy, pA(P_INK, 0.18), 1);
  pPara(s.body, P_MX, cy + 26, 21, 32, 906, pA(P_INK, 0.62));
  pFooter(page, total, s.source, false);
  pProgress(total, Number(page) || 7, false);
}

function pickClosing(s, page, total) {
  var bg = s.bg_image, bandH = 470;
  _ctx.fillStyle = pDeep(); _ctx.fillRect(0, 0, W, H);
  if (bg) {
    pImgFilter('contrast(1.05) saturate(0.98) brightness(0.98)', function () {
      drawCoverCrop(bg, 0, 0, W, bandH, 0.5, s.bg_focus === undefined ? 0.42 : s.bg_focus, 1);
    });
    pStops(0, 0, W, bandH, [8, 10, 14], [[0, 130], [200, 60], [bandH, 20]]);
  } else {
    var g = _ctx.createLinearGradient(0, 0, 0, H);
    for (var i = 0; i <= 24; i++) {
      var t = i / 24;
      g.addColorStop(t, 'rgba(255,255,255,' + (0.2 * Math.pow(1 - t, 1.4)).toFixed(3) + ')');
    }
    _ctx.fillStyle = g; _ctx.fillRect(0, 0, W, H);
  }
  pHead(page, s.label, true);
  var y = pHeadText(s.headline, 572, 76, WHITE);
  y = Math.max(y + 30, 772);
  y = pPara(s.body, P_MX, y, 24, 39, 906, 'rgba(255,255,255,0.82)');
  if (s.cta) {
    _ctx.fillStyle = pKey(); _ctx.fillRect(P_MX, y + 34, 4, 26);
    // 유도 문구는 한 줄이다. 길어지면 글자만 줄여 오른쪽 여백 안에 넣는다.
    var ctaSize = 22;
    while (ctaSize > 15 && measure(s.cta, ctaSize, 'bold') > P_CW - 30) ctaSize -= 1;
    drawText(s.cta, P_MX + 22, y + 58, ctaSize, 'bold', 'rgba(255,255,255,0.93)', 'ls');
    y += 82;
  }
  /* 아래 블록은 아래에서 위로 앉힌다 (2026-11-24) — 다른 페이지 footer()와 같은
     기준선(y=1252)을 쓰되, 출처·면책 문구가 길어 그 위 28px 여유가 안 나오면
     `BEAUTY PICK · 날짜 / 장수` 줄은 생략하고 진행 바 자리 위 28px만 지킨다. */
  var FOOT_BASE = 1252, BAR_TOP = 1330, GAP_MIN_C = 28;
  var topRef = Math.max(y + 26, 896);
  var discC = (D && D.disclaimer) || '';
  var candP = [[15, 20, 16, 20], [14, 19, 15, 19], [13, 18, 14, 18], [13, 17, 14, 17], [12, 16, 13, 16]];
  function tryClosing(withFoot, cand) {
    var ss = cand[0], sp = cand[1], ds = cand[2], dp = cand[3];
    var dl = discC ? wrapText(discC, ds, 'regular', P_CW) : [];
    var discBottom = withFoot ? (FOOT_BASE - 40) : (BAR_TOP - GAP_MIN_C);
    var discFirst = discBottom - inkSpan(ds, 'regular').bottom - dp * Math.max(0, dl.length - 1);
    var limitB = dl.length ? (discFirst + inkSpan(ds, 'regular').top - GAP_MIN_C) : discBottom;
    var sl = [];
    (s.sources || []).forEach(function (src) {
      wrapText('· ' + src, ss, 'regular', P_CW - 10).forEach(function (ln) { sl.push(ln); });
    });
    var srcH = 38 + sp * Math.max(0, sl.length - 1) + inkSpan(ss, 'regular').bottom;
    var syB = limitB - srcH;
    return { ok: syB >= topRef, sy: Math.max(syB, topRef), ss: ss, sp: sp, ds: ds, dp: dp,
             dl: dl, discFirst: discFirst, sl: sl };
  }
  var withFoot = true, planC = tryClosing(true, candP[0]);
  if (!planC.ok) {
    withFoot = false;
    planC = tryClosing(false, candP[0]);
    for (var ci = 1; ci < candP.length && !planC.ok; ci++) planC = tryClosing(false, candP[ci]);
  }
  var sy = planC.sy;
  tracked(s.sources_label || 'SOURCES', P_MX, sy, 14, 'medium', 'rgba(255,255,255,0.43)', 4);
  pHLine(P_MX, sy + 11, P_MX + 38, sy + 11, 'rgba(255,255,255,0.31)', 1);
  var yy = sy + 26;
  for (var q0 = 0; q0 < planC.sl.length; q0++) {
    drawText(planC.sl[q0], P_MX, yy + 12, planC.ss, 'regular', 'rgba(255,255,255,0.56)', 'ls');
    yy += planC.sp;
  }
  for (var k = 0; k < planC.dl.length; k++) {
    drawText(planC.dl[k], P_MX, planC.discFirst + k * planC.dp, planC.ds, 'regular', 'rgba(255,255,255,0.41)', 'ls');
  }
  if (withFoot) {
    var f2 = String((D && D.series) || 'BEAUTY PICK') + ' · ' + String((D && D.date) || '');
    tracked(f2, P_MX, FOOT_BASE, 17, 'medium', 'rgba(255,255,255,0.55)', 2);
    var t2 = page + ' / ' + pad2(total);
    tracked(t2, P_RIGHT - trackedW(t2, 17, 'medium', 2), FOOT_BASE, 17, 'medium', 'rgba(255,255,255,0.55)', 2);
  }
  /* 뷰티 픽 마지막 장에는 진행 바를 넣지 않는다 (2026-11-24 환희 님 지시) */
}

/* ---------------------------------------------------------------- 9. 장표 렌더 */
var POINT_KINDS = { table: pTable, cards: pCards, brand_pair: pBrandPair, brand_wide: pBrandWide, list: pList, reasons: pReasons, bars: pBars, lineup: pLineup, figure: pFigure };
var TECH_KINDS = { points: tPoints, band: tBand, split: tSplit, table: tTable, compare: tCompare, products: tProducts, quad: tQuad, steps: tSteps, lineage: tLineage, closing: tClosing, duo: tDuo };

function renderSlidePage(s, idx, total, family) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  if (family === 'brief') return briefSlide(s, idx, total);
  if (family === 'pick') return pickSlide(s, idx, total + 1);
  var v = family === 'tech' ? null : (s.visual || null);
  var mode = v && v.mode;
  var panelMode = mode === 'panel';
  var topMode = mode === 'topband';
  var newMode = !!(v && POINT_VIS_MODES[mode]) || panelMode;
  s.__visFloor = 0;
  s.__visRect = null;
  s.__limit = 0;
  s.__bodyRight = 0;
  _frameAuto = false;
  var vRight = visTextRight(s);
  var head;
  if (topMode) {
    var tb = drawTopBandPoint(s);
    s.__visRect = tb;
    _frameAuto = true;
    var hl = drawHeadOnPhoto(s, tb);
    s.__visFloor = tb.y + tb.h + Number(v.gap_after === undefined ? 46 : v.gap_after);
    head = { last: hl.last, size: hl.size };
  } else {
    if (v && !newMode) { drawVisualPoint(s); s.__visFloor = VIS_BOTTOM + 30; }
    head = family === 'tech' ? headBlockTech(s) : headBlock(s, undefined, vRight);
    if (newMode) {
      var gap = (mode === 'side' || panelMode) ? 0 : Number(v.gap === undefined ? 54 : v.gap);
      var r = (mode === 'side' || panelMode) ? drawSidePoint(s) : POINT_VIS_MODES[mode](s, head.last + gap);
      s.__visRect = r;
      s.__visFloor = r.y + r.h + Number(v.gap_after === undefined ? (mode === 'side' ? 34 : 36) : v.gap_after);
      if (panelMode) s.__bodyRight = r.x - 34;
    }
  }
  s.__headSize = head.size || 62;
  var kind = s.kind || 'table';
  var fn = family === 'tech' ? TECH_KINDS[kind] : POINT_KINDS[kind];
  if (!fn) fn = family === 'tech' ? TECH_KINDS.table : POINT_KINDS.table;
  var bodyFirst = panelMode ? head.last + 56 : Math.max(head.last + 56, s.__visFloor || 0);
  if (s.body && kind !== 'bars' && !(family === 'tech' && ['points', 'table', 'compare', 'quad', 'steps', 'lineage'].indexOf(kind) >= 0)) {
    var bodyW = panelMode && s.__bodyRight ? (s.__bodyRight - MX)
      : ((v && !newMode && bodyFirst < VIS_BOTTOM) ? (vRight - MX) : undefined);
    head.last = bodyBlock(s, bodyFirst, s.body_size || 24, bodyW);
  }
  fn(s, head.last);
  drawSource(s.source || '');
  drawDisclaimer(s.disclaimer || '');
  progressPoint(idx, total);
  framePoint(idx + '/' + total);
}

function renderPage(page) {
  if (!D) return;   // 카드뉴스를 아직 불러오지 않은 상태(갤러리 화면)에서의 호출 방지
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, W, H);
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  KEY = (D && D.key_color) || '#1E4ED8';
  KEY_TEXT = shadeHex(KEY, 0.22);
  try {
    if (page.type === 'cover') renderCover(D, state.family);
    else if (page.type === 'index') renderIndex(D);
    else {
      var s = (D.slides || [])[page.i];
      if (!s) return;
      renderSlidePage(s, page.i + 1, (D.slides || []).length, state.family);
    }
  } catch (err) {
    _ctx.fillStyle = '#FFF'; _ctx.fillRect(0, 0, W, H);
    drawText('이 장표를 그리지 못했습니다', MX, 300, 40, 'extrabold', '#C0392B', 'ls');
    drawText(String(err && err.message || err), MX, 360, 20, 'medium', '#777', 'ls');
    if (window.console) console.error(err);
  }
}

/* ---------------------------------------------------------------- 10. 상태 · 파일 */
var state = { family: 'point', presetId: null, page: 0, pages: [], savedKey: null, dirty: false };
var D = null;
var _raf = 0, _saveT = 0;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function familyOf(d) {
  if (d && d.family === 'pick') return 'pick';
  if (d && (d.series === 'BEAUTY PICK' || d.series === 'pick')) return 'pick';
  if (d && d.index) return 'brief';
  var tech = ['points', 'band', 'split', 'compare', 'quad', 'products', 'steps', 'lineage', 'closing'];
  var kinds = ((d && d.slides) || []).map(function (s) { return s.kind; });
  for (var i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'story' || kinds[i] === 'stats' || kinds[i] === 'diagram' || kinds[i] === 'checks' || kinds[i] === 'notes') return 'pick';
    if (tech.indexOf(kinds[i]) >= 0) return 'tech';
  }
  return 'point';
}
function buildPages() {
  var pages = [{ type: 'cover' }];
  if (D.index) pages.push({ type: 'index' });
  (D.slides || []).forEach(function (s, i) { pages.push({ type: 'slide', i: i }); });
  state.pages = pages;
  if (state.page >= pages.length) state.page = pages.length - 1;
}
function pageName(p, i) {
  if (p.type === 'cover') return '표지';
  if (p.type === 'index') return '요약';
  var s = (D.slides || [])[p.i] || {};
  var lab = String(s.label || '').replace(/^\d+\s*·\s*/, '');
  var head = (state.family === 'pick' && s.page)
    ? String(s.page) + '/' + pad2((D.slides || []).length + 1)
    : (p.i + 1) + '/' + (D.slides || []).length;
  return head + (lab ? ' · ' + lab : '');
}
function requestRender() {
  if (_raf) return;
  _raf = requestAnimationFrame(function () { _raf = 0; renderPage(state.pages[state.page] || { type: 'cover' }); });
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove('on'); }, 2200);
}

/* ---------------------------------------------------------------- 10b. 저장소 · 카드뉴스 불러오기 */
var REPO = 'konghwanhee/but';
var BRANCH = 'main';
var MANIFEST = { decks: [] };
var DECK = {};
var LS_PAT = 'but:pat';
var CHAPTERS = [
  { series: 'point', label: '뷰티 포인트', short: '포인트', badge: 'POINT', desc: '주목할 만한 트렌드와 핵심 이슈' },
  { series: 'tech', label: '뷰티 테크', short: '테크', badge: 'TECH', desc: '성분부터 작용기전, 신기술까지 뷰티 과학' },
  { series: 'briefing', label: '뷰티 브리핑', short: '브리프', badge: 'BRIEF', desc: '최신 뉴스, 보도자료 및 공시 정보' },
  { series: 'pick', label: '뷰티 픽', short: '픽', badge: 'PICK', desc: '한 편으로 읽는 제품·트렌드 큐레이션' }
];
var filterSeries = 'all';
/* ☰ 메뉴의 결재 · 발행 상태 필터 — 챕터 필터와 함께 걸린다. */
var filterStatus = 'all';
var STATUS_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '결재 대기' },     /* !approved && !uploaded */
  { key: 'ready', label: '업로드 대기' },     /* approved && !uploaded */
  { key: 'done', label: '업로드 완료' }       /* uploaded */
];
var currentDeck = null;

function indexDecks() {
  DECK = {};
  (MANIFEST.decks || []).forEach(function (d) { if (d && d.id) DECK[d.id] = d; });
}
function decksOf(series) {
  return (MANIFEST.decks || []).filter(function (d) { return d.series === series; });
}
function chapterOf(series) {
  for (var i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].series === series) return CHAPTERS[i];
  return { series: series, label: series, short: String(series || ''), badge: String(series || '').toUpperCase(), desc: '' };
}
/* 테스트 항목 — manifest/data 의 isTest:true (또는 issueNo:"TEST") 로 구분한다.
   호 번호를 받지 않고, 결재·업로드 대상에서 빠지며, 갤러리에서 `픽 TEST` 처럼 표시된다. */
function deckIsTest(d) {
  if (!d) return false;
  if (d.isTest === true) return true;
  return String(d.issueNo || '').toUpperCase() === 'TEST';
}
/* 갤러리 배지·상세 헤더에 쓰는 표기.
   · 뷰티 브리핑은 호수를 쓰지 않고 발행일로만 부른다 — 배지는 `11/30`, 전체 표기는 `2026.11.30`.
   · 나머지 챕터는 영문 코드 + 0 없는 호수: POINT 7 / TECH 2 / PICK 1 / BRIEF TEST / PICK TEST */
function isBriefSeries(d) { return !!(d && d.series === 'briefing'); }
function briefDateShort(d) {
  var m = String((d && d.date) || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[2] + '/' + m[3] : (fmtDate(d && d.date) || 'BRIEF');
}
function briefDateFull(d) { return fmtDate(d && d.date); }
function issueLabel(d) {
  var ch = chapterOf(d && d.series);
  var tag = ch.badge || ch.short;
  if (deckIsTest(d)) return tag + ' TEST';
  if (isBriefSeries(d)) return briefDateShort(d);
  var raw = (d && d.issueNo !== undefined && d.issueNo !== null) ? String(d.issueNo).trim() : '';
  if (!raw) return tag;
  var n = Number(raw);
  return tag + ' ' + (isNaN(n) ? raw : n);
}
function fmtDate(d) {
  var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : String(d || '');
}
function dateRange(list) {
  var ds = list.map(function (d) { return d.date || ''; }).filter(Boolean).sort();
  if (!ds.length) return '';
  return ds[0] === ds[ds.length - 1] ? fmtDate(ds[0]) : fmtDate(ds[0]) + '–' + fmtDate(ds[ds.length - 1]);
}

function markDirty(on) {
  var b = document.getElementById('btnGhSave');
  if (!b) return;
  b.textContent = on ? 'GitHub에 저장 •' : 'GitHub에 저장';
  b.classList.toggle('dirty', !!on);
}

/* 카드뉴스 JSON 한 종 불러오기 (data/{id}.json) */
function loadDeck(id, opts) {
  opts = opts || {};
  var meta = DECK[id];
  if (!meta) return Promise.resolve(false);
  var url = meta.jsonPath || ('data/' + id + '.json');
  return fetch(url, { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + url);
      return r.json();
    })
    .then(function (data) {
      if (!data || !Array.isArray(data.slides)) throw new Error('slides 배열이 없는 JSON입니다');
      D = clone(data);
      migrateCaption(D);
      // 목록(manifest)에 아직 없는 결재 기록이 카드뉴스 JSON 에 있으면 같이 맞춰 둔다.
      if (DECK[id] && typeof data.approved === 'boolean') {
        DECK[id].approved = data.approved;
        if (data.approved && data.approvedAt) DECK[id].approvedAt = data.approvedAt;
        else delete DECK[id].approvedAt;
      }
      if (DECK[id] && typeof data.isTest === 'boolean') DECK[id].isTest = data.isTest;
      state.family = familyOf(D);
      state.presetId = id;
      state.savedKey = 'butEditor:' + id;
      state.page = 0;
      state.dirty = false;
      _mc.clear();
      var restored = false;
      var saved = opts.fresh ? null : lsGet(state.savedKey);
      if (saved) {
        try {
          var sd = JSON.parse(saved);
          if (sd && (sd.cover || sd.slides)) { D = sd; migrateCaption(D); state.family = familyOf(D); restored = true; state.dirty = true; }
        } catch (e) { }
      }
      buildPages();
      buildTabs();
      buildPanel();
      requestRender();
      updateStageHead();
      markDirty(state.dirty);
      updateApproveBtn();
      if (restored) toast('이전에 수정하던 내용을 불러왔습니다 · 원본은 [원본으로 되돌리기]');
      return true;
    })
    .catch(function (err) {
      toast('카드뉴스를 읽지 못했습니다 · ' + err.message);
      return false;
    });
}

/* ---------------------------------------------------------------- 10c. GitHub 저장 (PAT) */
function apiHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}
function b64utf8(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '', CH = 0x8000;
  for (var i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}
function ghFileUrl(path) {
  return 'https://api.github.com/repos/' + REPO + '/contents/' + encodeURI(path);
}
function ghErrText(status, msg) {
  if (status === 401) return '토큰이 올바르지 않습니다 (401) · GitHub 연결을 다시 해주세요';
  if (status === 403) return '이 저장소에 쓸 권한이 없습니다 (403) · Contents: Read and write 권한이 필요합니다';
  if (status === 404) return '저장소나 파일을 찾지 못했습니다 (404) · 토큰의 저장소 접근 범위를 확인해 주세요';
  if (status === 409) return '다른 곳에서 먼저 저장했습니다 (409) · 다시 시도해 주세요';
  return msg || ('HTTP ' + status);
}
function ghRead(path, token) {
  return fetch(ghFileUrl(path) + '?ref=' + encodeURIComponent(BRANCH), {
    headers: apiHeaders(token), cache: 'no-store'
  }).then(function (r) {
    if (r.status === 404) return null;
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(ghErrText(r.status, j && j.message));
      return j;
    });
  });
}
function ghWrite(path, text, message, token, sha) {
  var body = { message: message, content: b64utf8(text), branch: BRANCH };
  if (sha) body.sha = sha;
  return fetch(ghFileUrl(path), {
    method: 'PUT',
    headers: apiHeaders(token),
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok) throw new Error(ghErrText(r.status, j && j.message));
      return j;
    });
  });
}
/* 표지 헤드라인(줄바꿈 포함)을 목록 제목 한 줄로 만든다.
   네 챕터(포인트·테크·브리프·픽) 모두 cover.headline = [[줄], [줄]] 구조를 쓴다. */
function coverTitle(cov) {
  var t = headlineText((cov && cov.headline) || []);
  return String(t || '').replace(/\s+/g, ' ').trim();
}
/* 저장할 때 함께 넘길 목록(manifest) 필드 — 표지 헤드라인이 바뀌면 제목도 같이 맞춘다. */
function manifestFieldsFromDeck(deckJson, meta) {
  var fields = {};
  var title = coverTitle((deckJson && deckJson.cover) || (D && D.cover));
  if (title && title !== ((meta && meta.title) || '')) fields.title = title;
  return fields;
}
/* 저장한 제목을 목록·상세 화면에 바로 반영한다(새로고침 없이). */
function applyDeckMetaLocal(id, fields) {
  var meta = DECK[id];
  if (!meta || !fields) return;
  Object.keys(fields).forEach(function (k) {
    if (fields[k] !== undefined && fields[k] !== null) meta[k] = fields[k];
  });
  (MANIFEST.decks || []).forEach(function (d) {
    if (d.id !== id) return;
    Object.keys(fields).forEach(function (k) {
      if (fields[k] !== undefined && fields[k] !== null) d[k] = fields[k];
    });
  });
  if (state.presetId === id) {
    var h = document.getElementById('deckTitle');
    if (h) h.textContent = meta.title || meta.id;
    document.title = (meta.title || meta.id) + ' · 카드뉴스 허브';
  }
  renderGallery();
}
function ghSave() {
  var token = lsGet(LS_PAT);
  if (!token) { openPat('GitHub에 저장하려면 먼저 토큰을 연결해 주세요.'); return; }
  if (!D || !state.presetId) return;
  var id = state.presetId;
  var btn = document.getElementById('btnGhSave');
  btn.disabled = true;
  toast('GitHub에 저장하는 중…');
  var path = 'data/' + id + '.json';
  var fields = manifestFieldsFromDeck(D, DECK[id]);
  var title = fields.title || (DECK[id] && DECK[id].title) || id;
  var text = JSON.stringify(D, null, 2) + '\n';
  ghRead(path, token)
    .then(function (cur) {
      return ghWrite(path, text, '카드뉴스 수정: ' + title + ' (' + id + ')', token, cur && cur.sha);
    })
    .then(function (res) {
      clearTimeout(_saveT);
      lsDel(state.savedKey);
      state.dirty = false;
      markDirty(false);
      var sha = res && res.commit && res.commit.sha ? String(res.commit.sha).slice(0, 7) : '';
      toast('GitHub에 저장했습니다\n' + path + (sha ? ' · 커밋 ' + sha : ''));
      return touchManifest(id, token, fields).catch(function () { return null; });
    })
    .catch(function (err) {
      toast('GitHub 저장 실패 · ' + err.message);
    })
    .then(function () { btn.disabled = false; });
}
/* 목록(manifest.json)의 해당 항목을 갱신한다.
   fields 를 넘기면 표지 헤드라인에서 뽑은 제목(title) 등도 함께 커밋한다. */
function touchManifest(id, token, fields) {
  return ghRead('data/manifest.json', token).then(function (cur) {
    if (!cur) return null;
    var json;
    try {
      var raw = cur.content ? atob(cur.content.replace(/\s/g, '')) : '';
      json = JSON.parse(decodeURIComponent(escape(raw)));
    } catch (e) { return null; }
    var stamp = new Date().toISOString();
    (json.decks || []).forEach(function (d) {
      if (d.id !== id) return;
      if (fields) Object.keys(fields).forEach(function (k) {
        if (fields[k] !== undefined && fields[k] !== null) d[k] = fields[k];
      });
      d.updatedAt = stamp;
    });
    json.generatedAt = stamp;
    if (DECK[id]) { DECK[id].updatedAt = stamp; (MANIFEST.decks || []).forEach(function (d) { if (d.id === id) d.updatedAt = stamp; }); }
    var msg = '카드뉴스 목록 갱신: ' + id + (fields && fields.title ? ' · 제목 동기화' : '');
    return ghWrite('data/manifest.json', JSON.stringify(json, null, 2) + '\n', msg, token, cur.sha)
      .then(function (res) {
        applyDeckMetaLocal(id, fields);   // 목록·상세 제목을 새로고침 없이 바로 반영
        return res;
      });
  });
}

/* ---------------------------------------------------------------- 10d. 결재(승인) */
/* 결재 상태는 data/{id}.json 과 data/manifest.json 양쪽에 같이 기록된다.
   approved(결재 여부) · approvedAt(결재 시각) · scheduledUploadAt(업로드 예정) · publishedAt(업로드 완료) */
var APPROVAL_KEYS = ['approved', 'approvedAt', 'scheduledUploadAt', 'publishedAt'];

function approvalOf(id) {
  var m = DECK[id];
  if (m && typeof m.approved === 'boolean') return m.approved;
  if (id === state.presetId && D && typeof D.approved === 'boolean') return D.approved;
  return false;
}
function approveLabel(on) { return on ? '결재됨 ✓' : '결재'; }

function p2n(n) { return (n < 10 ? '0' : '') + n; }
/* 한국 시간 벽시계 값(UTC 필드에 KST 값을 담아 돌려준다) */
function kstWall(now) {
  var t = new Date(now.getTime() + 9 * 3600 * 1000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours() };
}
/* ---------------------------------------------------------------- 10d-1. 업로드 순번과 예정 시각 */
/* 같은 챕터의 미업로드 정식 호는 호수(issueNo) 오름차순으로 한 슬롯에 한 편씩 올라간다(앞 회차 먼저).
   그래서 뒤 회차의 예정 시각은 앞 회차들이 차지한 슬롯의 다음 칸이다.
     · 포인트: 월·수·금 08:00. 4부작 주차의 4번째 호는 그 주 토요일 08:00.
     · 테크: 토요일 08:00. 포인트 4부작 주차가 가져간 토요일은 건너뛴다(그 주 테크는 쉼).
     · 브리프: 매일 18:00. · 픽: 결재한 시각의 다음 정각.
   새 4부작 주차가 생기면 POINT_4PART_GROUPS 에 [시작호, 끝호] 한 줄을 더한다. */
var POINT_4PART_GROUPS = [[4, 7]];      /* 제조 모델 1~4편 = 04~07호 (11/30주: 월·수·금·토) */

function kstDay(now) {                 /* 오늘(KST) 00:00 을 UTC 필드에 담아 돌려준다 */
  var k = kstWall(now || new Date());
  return new Date(Date.UTC(k.y, k.m - 1, k.d));
}
function addDays(day, n) {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + n));
}
function dayKeyOf(day) {
  return day.getUTCFullYear() + '-' + p2n(day.getUTCMonth() + 1) + '-' + p2n(day.getUTCDate());
}
function slotIso(day, hour) {
  return dayKeyOf(day) + 'T' + p2n(hour) + ':00:00+09:00';
}
function slotMs(day, hour) {           /* 슬롯(KST)의 실제 UTC 밀리초 */
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 9);
}
function isMWF(day) { var w = day.getUTCDay(); return w === 1 || w === 3 || w === 5; }
function mondayOf(day) { return addDays(day, -((day.getUTCDay() + 6) % 7)); }
function numIssue(d) {
  var n = Number(d && d.issueNo);
  return (d && d.issueNo !== null && d.issueNo !== undefined && d.issueNo !== '' && !isNaN(n)) ? n : 9999;
}
/* 아직 업로드되지 않은 정식 호를 호수 오름차순으로 (테스트 항목 제외) */
function uploadQueueOf(series) {
  return (MANIFEST.decks || []).filter(function (d) {
    return d && d.series === series && !deckIsTest(d) && !d.publishedAt;
  }).sort(function (a, b) { return numIssue(a) - numIssue(b); });
}
/* 이 호가 속한 4부작 주차의 첫 호수 (4부작이 아니면 null) */
function fourPartGroupStart(issueNo) {
  var n = Number(issueNo);
  if (isNaN(n)) return null;
  for (var i = 0; i < POINT_4PART_GROUPS.length; i++) {
    var g = POINT_4PART_GROUPS[i];
    if (g.length === 2 && g[1] - g[0] === 3 && n >= g[0] && n <= g[1]) return g[0];
  }
  return null;
}
/* 포인트 발행 슬롯(월·수·금 + 각 주 토요일 후보)을 시간순으로. 지난 슬롯은 뺀다.
   토요일은 후보로만 넣고, 실제 배정은 assignPointQueue 가 4부작 주차일 때만 한다. */
function pointSlotPlan(now, count) {
  var t = now || new Date();
  var today = kstDay(t);
  var startDay = today;
  if (slotMs(today, 8) <= t.getTime()) startDay = addDays(today, 1);      /* 오늘 08:00 이 이미 지났으면 내일부터 */
  var mon = mondayOf(startDay);
  var out = [];
  for (var w = 0; w < 80 && out.length < count; w++) {
    var m = addDays(mon, 7 * w);
    var days = [addDays(m, 0), addDays(m, 2), addDays(m, 4), addDays(m, 5)];   /* 월·수·금·토 */
    for (var i = 0; i < days.length; i++) {
      if (slotMs(days[i], 8) < slotMs(startDay, 8)) continue;
      out.push({ iso: slotIso(days[i], 8), key: dayKeyOf(days[i]), day: days[i], sat: i === 3 });
    }
  }
  return out;
}
/* 4부작 그룹의 마지막 호 차례인데 앞 3편이 이미 업로드됐다면, 그 3편이 올라간 주의 월요일 key 를 돌려준다.
   (그 주 토요일이 이 4부작 주차의 마지막 자리다) */
function pointTailWeekKey(queue, i) {
  var gs = fourPartGroupStart(queue[i].issueNo);
  if (gs === null || numIssue(queue[i]) !== gs + 3) return null;
  for (var j = 0; j < queue.length; j++) {
    var n = numIssue(queue[j]);
    if (n >= gs && n < gs + 3) return null;         /* 앞 3편이 아직 대기 중 */
  }
  var last = null;
  (MANIFEST.decks || []).forEach(function (d) {
    if (d.series !== 'point' || deckIsTest(d)) return;
    if (numIssue(d) === gs + 2 && d.publishedAt) last = d.publishedAt;
  });
  if (!last) return null;
  var s = String(last);
  var p = new Date(s.length <= 10 ? s + 'T00:00:00+09:00' : s);
  if (isNaN(p.getTime())) return null;
  return dayKeyOf(mondayOf(kstDay(p)));
}
/* 포인트 대기열을 슬롯에 차례로 배정. 토요일은 그 주에 4부작 앞 3편이 들어가고 마지막 호가 다음 차례일 때만 쓴다. */
function assignPointQueue(now, queue) {
  var plan = pointSlotPlan(now, queue.length + 9);
  var slots = {}, claimedSat = [];
  var i = 0, weekKey = '', weekIds = [];
  for (var pi = 0; pi < plan.length && i < queue.length; pi++) {
    var s = plan[pi];
    var wk = dayKeyOf(mondayOf(s.day));
    if (s.sat) {
      var gs = fourPartGroupStart(queue[i].issueNo);
      var take = false;
      if (gs !== null && numIssue(queue[i]) === gs + 3) {
        take = weekIds.length === 3 && weekIds.every(function (d) {
          var n = numIssue(d); return n >= gs && n < gs + 3;
        });
        if (!take) take = (pointTailWeekKey(queue, i) === wk);
      }
      if (take) {
        slots[queue[i].id] = s.iso;
        claimedSat.push(s.key);
        weekIds.push(queue[i]);
        i++;
      }
      continue;
    }
    if (wk !== weekKey) { weekKey = wk; weekIds = []; }
    slots[queue[i].id] = s.iso;
    weekIds.push(queue[i]);
    i++;
  }
  return { slots: slots, claimedSat: claimedSat };
}
/* 포인트 4부작 주차가 가져간 토요일 (테크는 이 주 쉰다) */
function pointClaimedSaturdays(now) {
  var res = assignPointQueue(now, uploadQueueOf('point'));
  var map = {};
  res.claimedSat.forEach(function (k) { map[k] = true; });
  return map;
}
/* 테크: 토요일 08:00 슬롯을 차례로, 포인트가 차지한 토요일은 건너뛴다. */
function assignTechQueue(now, queue) {
  var t = now || new Date();
  var today = kstDay(t);
  var day = today;
  if (slotMs(today, 8) <= t.getTime()) day = addDays(today, 1);
  while (day.getUTCDay() !== 6) day = addDays(day, 1);
  var claimed = pointClaimedSaturdays(t);
  var slots = {};
  for (var n = 0, i = 0; n < 80 && i < queue.length; n++) {
    if (!claimed[dayKeyOf(day)]) { slots[queue[i].id] = slotIso(day, 8); i++; }
    day = addDays(day, 7);
  }
  return slots;
}
/* 브리프: 매일 18:00 (하루 한 편) */
function assignBriefQueue(now, queue) {
  var t = now || new Date();
  var day = kstDay(t);
  if (slotMs(day, 18) <= t.getTime()) day = addDays(day, 1);
  var slots = {};
  for (var i = 0; i < queue.length; i++) {
    slots[queue[i].id] = slotIso(day, 18);
    day = addDays(day, 1);
  }
  return slots;
}
/* 챕터별 id→예정 시각 표 (1분 단위로만 다시 계산) */
var _slotCache = { key: '', map: {} };
function queuedSlotMap(series) {
  var bucket = String(Math.floor(Date.now() / 60000));
  if (_slotCache.key !== bucket) _slotCache = { key: bucket, map: {} };
  if (!_slotCache.map[series]) {
    var q = uploadQueueOf(series);
    var m2 = {};
    if (series === 'point') m2 = assignPointQueue(new Date(), q).slots;
    else if (series === 'tech') m2 = assignTechQueue(new Date(), q);
    else if (series === 'briefing') m2 = assignBriefQueue(new Date(), q);
    _slotCache.map[series] = m2;
  }
  return _slotCache.map[series];
}
/* 이 호가 실제로 올라갈 예정 시각. 픽은 결재 시각 기준 정각이라 저장값을 그대로 쓴다. */
function slotForDeck(d, now) {
  if (!d || !APPROVE_SERIES[d.series]) return null;
  if (deckIsTest(d) || d.publishedAt) return null;
  if (d.series === 'pick') return d.scheduledUploadAt || null;
  var map = queuedSlotMap(d.series);
  var iso = map[d.id];
  if (iso) return iso;
  return d.scheduledUploadAt || null;
}
/* 결재 시점 기준 업로드 예정 시각(KST). id 를 주면 그 호의 대기열 순번으로 계산한다.
   브리프 18:00 · 포인트/테크 08:00 · 픽은 결재한 순간(비정기, 당일 업로드). */
function nextUploadSlot(now, series, id) {
  var when = now || new Date();
  var k = kstWall(when);
  var y = k.y, m = k.m, d = k.d;
  if (series === 'pick') {
    var t = new Date(when.getTime() + 9 * 3600 * 1000);
    return y + '-' + p2n(m) + '-' + p2n(d) + 'T' + p2n(k.h) + ':' + p2n(t.getUTCMinutes()) + ':00+09:00';
  }
  if (id && DECK[id]) {
    var iso = slotForDeck(DECK[id], when);
    if (iso) return iso;
  }
  /* 대체값: 같은 챕터의 대기열을 못 읽었을 때 쓰는 바로 다음 슬롯 */
  var hour = series === 'briefing' ? 18 : 8;
  var day = kstDay(when);
  if (slotMs(day, hour) <= when.getTime()) day = addDays(day, 1);
  if (series === 'point' || series === 'tech') {
    while (series === 'tech' ? day.getUTCDay() !== 6 : !isMWF(day)) day = addDays(day, 1);
  }
  return slotIso(day, hour);
}
/* ISO 시각(UTC 'Z' 포함)은 KST 로 바꾸고, 'YYYY-MM-DD 18:00' 같은 표기는 그대로 읽는다. */
function fmtUploadAt(v, full) {
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  var y = +m[1], mo = +m[2], d = +m[3];
  var hh = m[4] ? +m[4] : null, mi = m[5] ? +m[5] : null;
  if (hh !== null && /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var t = new Date(s);
    if (!isNaN(t.getTime())) {
      var k = new Date(t.getTime() + 9 * 3600 * 1000);
      y = k.getUTCFullYear(); mo = k.getUTCMonth() + 1; d = k.getUTCDate();
      hh = k.getUTCHours(); mi = k.getUTCMinutes();
    }
  }
  var date = full ? y + '.' + p2n(mo) + '.' + p2n(d) : p2n(mo) + '.' + p2n(d);
  return (hh !== null) ? date + ' ' + p2n(hh) + ':' + p2n(mi) : date;
}
/* 카드·편집 화면에 보일 결재 상태 문구 */
/* 결재는 네 챕터(포인트 · 테크 · 브리프 · 픽) 모두에서 쓴다. */
var APPROVE_SERIES = { point: 1, tech: 1, briefing: 1, pick: 1 };
function approveAllowed(id) {
  var m = id ? DECK[id] : null;
  return !!(m && APPROVE_SERIES[m.series] && !deckIsTest(m));
}
function isoToDotted(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
}
function deckStatus(d) {
  if (!d) return null;
  if (deckIsTest(d)) return { kind: 'test', text: '테스트 전용 · 결재·업로드 제외' };
  if (!APPROVE_SERIES[d.series]) return null;
  if (d.publishedAt) return { kind: 'done', text: '업로드 완료 · ' + fmtUploadAt(d.publishedAt, true).split(' ')[0] };
  if (d.approved) {
    var iso = slotForDeck(d) || d.scheduledUploadAt || '';
    var when = iso ? fmtUploadAt(iso) : '';
    var tail = d.series === 'pick'
      ? (when ? ' · ' + when + ' 업로드' : ' · 업로드 예정')
      : (when ? ' · 예정 ' + when : ' · 업로드 예정');
    return { kind: 'scheduled', text: '결재됨' + tail };
  }
  return null;
}
function statusTip(d) {
  if (!d) return '';
  var bits = [];
  if (d.approvedAt) bits.push('결재 ' + fmtUploadAt(d.approvedAt, true));
  var iso = slotForDeck(d) || d.scheduledUploadAt;
  if (iso) bits.push('업로드 예정 ' + fmtUploadAt(iso, true));
  if (d.publishedAt) bits.push('업로드 완료 ' + fmtUploadAt(d.publishedAt, true));
  return bits.join(' · ');
}

function updateApproveBtn() {
  var id = state.presetId;
  var allowed = approveAllowed(id);
  var on = (allowed && id) ? approvalOf(id) : false;
  var b = document.getElementById('btnApprove');
  if (b) {
    b.hidden = !allowed;
    b.textContent = approveLabel(on);
    b.classList.toggle('approved', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('title', on
      ? '결재를 취소하면 이 호가 미결재 상태로 돌아가고 GitHub에 기록됩니다'
      : '이 호를 결재하고 GitHub에 기록합니다');
  }
  var st = document.getElementById('deckStatus');
  if (st) {
    var s = deckStatus(id ? DECK[id] : null);
    st.hidden = !s;
    st.className = 'apStatus' + (s ? ' ' + s.kind : '');
    st.textContent = s ? s.text : '';
    st.setAttribute('title', deckIsTest(id ? DECK[id] : null)
      ? '실제 발행 전 테스트용 항목입니다 · 결재·업로드 대상에서 제외됩니다'
      : (id ? statusTip(DECK[id]) : ''));
  }
}

function applyApprovalLocal(id, fields) {
  var list = [];
  if (DECK[id]) list.push(DECK[id]);
  (MANIFEST.decks || []).forEach(function (d) { if (d.id === id) list.push(d); });
  list.forEach(function (d) {
    Object.keys(fields).forEach(function (k) { d[k] = fields[k]; });
  });
}

function setManifestFields(id, fields, token, message) {
  return ghRead('data/manifest.json', token).then(function (cur) {
    if (!cur) return null;
    var json;
    try {
      var raw = cur.content ? atob(cur.content.replace(/\s/g, '')) : '';
      json = JSON.parse(decodeURIComponent(escape(raw)));
    } catch (e) { return null; }
    var stamp = new Date().toISOString();
    (json.decks || []).forEach(function (d) {
      if (d.id !== id) return;
      Object.keys(fields).forEach(function (k) { d[k] = fields[k]; });
      d.updatedAt = stamp;
    });
    json.generatedAt = stamp;
    return ghWrite('data/manifest.json', JSON.stringify(json, null, 2) + '\n', message, token, cur.sha);
  });
}

/* 결재 상태를 GitHub(data/{id}.json + manifest.json)에 커밋 */
function commitApproval(next, token) {
  var id = state.presetId;
  if (!id || !D || !approveAllowed(id) || deckIsTest(DECK[id])) return;
  var m = DECK[id] || {};
  var series = m.series || 'point';
  var prev = {
    approved: (typeof m.approved === 'boolean') ? m.approved : (typeof D.approved === 'boolean' ? D.approved : false),
    approvedAt: m.approvedAt || D.approvedAt || null,
    scheduledUploadAt: m.scheduledUploadAt || D.scheduledUploadAt || null,
    publishedAt: m.publishedAt || D.publishedAt || null
  };
  var fields, manFields, dataFields;
  var prevDate = D.date;
  if (next) {
    var sched = nextUploadSlot(new Date(), series, id);
    fields = {
      approved: true,
      approvedAt: new Date().toISOString(),
      scheduledUploadAt: sched,
      publishedAt: prev.publishedAt || null
    };
    dataFields = clone(fields);
    manFields = clone(fields);
    if (series === 'pick') {
      // 뷰티 픽: 하단 `BEAUTY PICK · YYYY.MM.DD` 날짜를 결재일(업로드일)로 바꿔 함께 커밋
      dataFields.date = isoToDotted(sched);
      manFields.date = sched.slice(0, 10);
    }
  } else {
    fields = { approved: false, approvedAt: null, scheduledUploadAt: null, publishedAt: prev.publishedAt || null };
    dataFields = fields;
    manFields = fields;
  }

  var btn = document.getElementById('btnApprove');
  btn.disabled = true;
  toast(next ? '결재를 기록하는 중…' : '결재를 취소하는 중…');

  Object.keys(dataFields).forEach(function (k) { D[k] = dataFields[k]; });

  var path = 'data/' + id + '.json';
  var title = m.title || id;
  var text = JSON.stringify(D, null, 2) + '\n';
  var msg = (next ? '결재: ' : '결재 취소: ') + title + ' (' + id + ')' +
    (next && series === 'pick' ? ' · 날짜 ' + dataFields.date : '');

  ghRead(path, token)
    .then(function (cur) { return ghWrite(path, text, msg, token, cur && cur.sha); })
    .then(function () {
      return setManifestFields(id, manFields, token, msg)
        .catch(function () { return setManifestFields(id, manFields, token, msg); });
    })
    .then(function () {
      applyApprovalLocal(id, manFields);
      clearTimeout(_saveT);
      lsDel(state.savedKey);
      state.dirty = false;
      markDirty(false);
      updateApproveBtn();
      requestRender();          // 뷰티 픽은 하단 날짜가 결재일로 바뀐 캔버스를 바로 다시 그린다
      renderGallery();
      if (next) {
        toast('결재했습니다\n업로드 예정 ' + fmtUploadAt(manFields.scheduledUploadAt, true) + ' · ' + path);
      } else {
        toast('결재를 취소했습니다 · ' + path);
      }
    })
    .catch(function (err) {
      Object.keys(prev).forEach(function (k) { D[k] = prev[k]; });
      D.date = prevDate;
      updateApproveBtn();
      toast('결재 상태를 저장하지 못했습니다 · ' + err.message + '\n잠시 뒤 [결재]를 다시 눌러 주세요');
    })
    .then(function () { btn.disabled = false; });
}

/* 2차 확인 모달 */
var cfm = { open: false, resolve: null };
function askConfirm(opts) {
  return new Promise(function (resolve) {
    var modal = document.getElementById('cfmModal');
    document.getElementById('cfmTitle').textContent = opts.title || '확인';
    document.getElementById('cfmBody').textContent = opts.body || '';
    var ok = document.getElementById('cfmOk');
    ok.textContent = opts.ok || '확인';
    ok.className = 'solid' + (opts.danger ? ' danger' : '');
    cfm.resolve = resolve;
    cfm.open = true;
    modal.hidden = false;
    setTimeout(function () { try { ok.focus(); } catch (e) { } }, 30);
  });
}
function closeConfirm(answer) {
  if (!cfm.open) return;
  cfm.open = false;
  document.getElementById('cfmModal').hidden = true;
  var r = cfm.resolve;
  cfm.resolve = null;
  if (r) r(!!answer);
}

function approveToggle() {
  var token = lsGet(LS_PAT);
  if (!token) {
    toast('GitHub 연결 후 결재 상태를 저장할 수 있습니다');
    openPat('결재 상태는 GitHub에 기록됩니다 · 토큰을 연결해 주세요.');
    return;
  }
  if (!D || !state.presetId) return;
  if (deckIsTest(DECK[state.presetId])) {
    toast('테스트 항목은 결재할 수 없습니다 · 정식 호에서 결재해 주세요');
    return;
  }
  if (!approveAllowed(state.presetId)) {
    toast('결재는 POINT · TECH · BRIEF · PICK 정식 호에서만 사용할 수 있습니다');
    return;
  }
  var before = approvalOf(state.presetId);
  var next = !before;
  var series = (DECK[state.presetId] || {}).series || 'point';
  var schedule = fmtUploadAt(nextUploadSlot(new Date(), series, state.presetId), true);
  askConfirm(next ? {
    title: '결재',
    body: series === 'pick'
      ? '이 카드뉴스를 결재할까요? 결재하면 GitHub에 저장되고, 하단 날짜가 결재일(' + isoToDotted(nextUploadSlot(new Date(), 'pick').slice(0, 10)) + ')로 바뀌어 함께 커밋됩니다.'
      : '이 카드뉴스를 결재할까요? 결재하면 GitHub에 저장되고, 업로드 예정 시각은 ' + schedule + '입니다.',
    ok: '결재 확정'
  } : {
    title: '결재 취소',
    body: '이 호의 결재를 취소할까요? 취소하면 갤러리의 결재됨·업로드 예정 표시가 사라집니다.',
    ok: '결재 취소',
    danger: true
  }).then(function (yes) { if (yes) commitApproval(next, token); });
}

/* 토큰 모달 */
function openPat(msg) {
  var modal = document.getElementById('patModal');
  var input = document.getElementById('patInput');
  var stateEl = document.getElementById('patState');
  modal.hidden = false;
  input.value = '';
  input.placeholder = lsGet(LS_PAT) ? '저장된 토큰이 있습니다 · 새 토큰을 넣으면 교체됩니다' : 'github_pat_…';
  stateEl.className = 'patState';
  stateEl.textContent = msg || '';
  setTimeout(function () { try { input.focus(); } catch (e) { } }, 40);
}
function closePat() { document.getElementById('patModal').hidden = true; }
function verifyToken(token) {
  return fetch('https://api.github.com/user', { headers: apiHeaders(token), cache: 'no-store' })
    .then(function (r) {
      if (r.status === 401) throw new Error('토큰이 올바르지 않습니다 (401)');
      if (!r.ok) throw new Error('확인하지 못했습니다 (HTTP ' + r.status + ')');
      return r.json();
    })
    .then(function (u) {
      return fetch('https://api.github.com/repos/' + REPO, { headers: apiHeaders(token), cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (repo) {
          var canWrite = !!(repo && repo.permissions && repo.permissions.push);
          return { login: u.login, canWrite: canWrite };
        });
    });
}
function updateGhChip() {
  // 토큰이 연결된 뒤에는 헤더의 'GitHub 연결' 버튼·안내문을 감춘다.
  // 재설정이 필요할 때만 하단 푸터(갤러리)와 편집 화면 하단의 작은 텍스트 링크로 연다.
  var connected = !!lsGet(LS_PAT);
  var chip = document.getElementById('ghChipHome');
  if (chip) chip.hidden = true;
  ['btnPat', 'btnPatHome'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.hidden = connected;
  });
  ['btnPatFoot', 'btnPatLink'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.hidden = !connected;
  });
}

/* ---------------------------------------------------------------- 11. 탭 */
function buildTabs() {
  var nav = document.getElementById('tabs');
  nav.innerHTML = '';
  state.pages.forEach(function (p, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === state.page ? ' on' : '');
    var num = p.type === 'cover' ? '표지' : p.type === 'index' ? '요약'
      : (state.family === 'pick' && (D.slides[p.i] || {}).page) ? String((D.slides[p.i] || {}).page) : pad2(p.i + 1);
    var nm = p.type === 'slide'
      ? ((D.slides || [])[p.i] || {}).label || ''
      : (p.type === 'cover' ? '첫 장' : '오늘의 뷰티');
    b.innerHTML = '<span class="num">' + esc(num) + '</span><span class="nm">' + esc(String(nm).replace(/^\d+\s*·\s*/, '')) + '</span>';
    b.addEventListener('click', function () { goPage(i); });
    nav.appendChild(b);
  });
}
function goPage(i) {
  if (i < 0 || i >= state.pages.length) return;
  state.page = i;
  var nav = document.getElementById('tabs');
  var tabs = nav.querySelectorAll('.tab');
  for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('on', k === i);
  if (tabs[i] && nav.scrollWidth > nav.clientWidth && nav.scrollWidth > 0) {
    try { tabs[i].scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { }
  }
  buildPanel();
  updateStageHead();
  renderPage(state.pages[i]);
}
function updateStageHead() {
  var p = state.pages[state.page];
  document.getElementById('stageTitle').textContent = pageName(p);
  document.getElementById('pageInfo').textContent = (state.page + 1) + ' / ' + state.pages.length;
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
function getPath(path) {
  var o = D;
  for (var i = 0; i < path.length; i++) { if (o === null || o === undefined) return undefined; o = o[path[i]]; }
  return o;
}
function setPath(path, v) {
  var o = D;
  for (var i = 0; i < path.length - 1; i++) {
    if (o[path[i]] === undefined || o[path[i]] === null) o[path[i]] = (typeof path[i + 1] === 'number') ? [] : {};
    o = o[path[i]];
  }
  o[path[path.length - 1]] = v;
}
function commit() {
  state.dirty = true;
  requestRender();
  clearTimeout(_saveT);
  _saveT = setTimeout(function () {
    if (state.savedKey && D) lsSet(state.savedKey, JSON.stringify(D));
  }, 800);
}

/* ---------------------------------------------------------------- 12. 필드 패널 */
function el(tag, cls, txt) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.max(t.classList.contains('tall') ? 64 : t.classList.contains('mid') ? 48 : 34, t.scrollHeight) + 'px';
}
function textField(path, label, rows, hint, rebuild) {
  var wrap = el('div', 'fld');
  var lb = el('label');
  lb.appendChild(document.createTextNode(label));
  if (hint) { var n = el('span', 'n', hint); lb.appendChild(n); }
  wrap.appendChild(lb);
  var ta = document.createElement('textarea');
  ta.rows = 1; ta.spellcheck = false;
  if (rows === 2) ta.className = 'mid'; if (rows >= 3) ta.className = 'tall';
  var v = getPath(path);
  ta.value = v === undefined || v === null ? '' : String(v);
  ta.addEventListener('input', function () {
    setPath(path, ta.value); autoGrow(ta); commit();
    // 값에 따라 아래 칸 구성이 바뀌는 입력(예: 도해 종류)만 폼을 다시 그린다.
    if (rebuild) buildPanel();
  });
  wrap.appendChild(ta);
  setTimeout(function () { autoGrow(ta); }, 0);
  return wrap;
}
function headlineField(path, label) {
  var grp = el('div', 'fld');
  var lb = el('label'); lb.appendChild(document.createTextNode(label || '헤드라인'));
  var n = el('span', 'n', 'Enter로 줄 나눔'); lb.appendChild(n);
  grp.appendChild(lb);
  var listBox = el('div');
  grp.appendChild(listBox);
  var btnRow = el('div', 'rowBtns');
  var add = el('button', 'mini', '+ 한 줄 추가');
  add.type = 'button';
  btnRow.appendChild(add);
  grp.appendChild(btnRow);
  add.addEventListener('click', function () {
    var arr = getPath(path) || [];
    arr.push(['새 줄']);
    setPath(path, arr);
    drawLines(); commit();
  });

  function drawLines() {
    listBox.innerHTML = '';
    var arr = getPath(path) || [];
    arr.forEach(function (line, i) {
      var segs = segments(line);
      var text = segs.map(function (s) { return s.text; }).join('');
      var tone = segs.length > 1 ? segs[segs.length - 1].tone : 'ink';
      if (tone !== 'key' && tone !== 'gray') tone = 'ink';
      var row = el('div', 'hlRow');
      var ta = document.createElement('textarea');
      ta.rows = 1; ta.value = text; ta.spellcheck = false;
      ta.addEventListener('input', function () {
        var a = getPath(path) || [];
        a[i] = tone === 'ink' ? [ta.value] : [ta.value, tone];
        setPath(path, a); autoGrow(ta); commit();
      });
      var sel = document.createElement('select');
      [['ink', '기본'], ['key', '키컬러'], ['gray', '회색']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      sel.value = tone;
      sel.addEventListener('change', function () {
        var a = getPath(path) || [];
        a[i] = sel.value === 'ink' ? [ta.value] : [ta.value, sel.value];
        setPath(path, a); commit();
      });
      var del = el('button', 'mini', '×'); del.type = 'button'; del.title = '이 줄 삭제';
      del.addEventListener('click', function () {
        var a = getPath(path) || [];
        if (a.length <= 1) { toast('마지막 줄은 지울 수 없습니다'); return; }
        a.splice(i, 1); setPath(path, a); drawLines(); commit();
      });
      row.appendChild(ta); row.appendChild(sel); row.appendChild(del);
      listBox.appendChild(row);
      setTimeout(function () { autoGrow(ta); }, 0);
    });
  }
  drawLines();
  return grp;
}
function strArrField(path, label, hint) {
  var grp = el('div', 'fld');
  var lb = el('label'); lb.appendChild(document.createTextNode(label));
  if (hint) lb.appendChild(el('span', 'n', hint));
  grp.appendChild(lb);
  var box = el('div'); grp.appendChild(box);
  function draw() {
    box.innerHTML = '';
    var arr = getPath(path) || [];
    arr.forEach(function (s, i) {
      var row = el('div', 'hlRow');
      var ta = document.createElement('textarea');
      ta.rows = 1; ta.value = s === undefined || s === null ? '' : String(s); ta.spellcheck = false;
      ta.addEventListener('input', function () {
        var a = getPath(path) || []; a[i] = ta.value; setPath(path, a); autoGrow(ta); commit();
      });
      var del = el('button', 'mini', '×'); del.type = 'button';
      del.addEventListener('click', function () {
        var a = getPath(path) || []; a.splice(i, 1); setPath(path, a); draw(); commit();
      });
      row.appendChild(ta); row.appendChild(del);
      box.appendChild(row);
      setTimeout(function () { autoGrow(ta); }, 0);
    });
    var add = el('button', 'mini', '+ 항목 추가'); add.type = 'button';
    add.addEventListener('click', function () {
      var a = getPath(path) || []; a.push(''); setPath(path, a); draw(); commit();
    });
    box.appendChild(add);
  }
  draw();
  return grp;
}
function selectField(path, label, options, hint, placeholder) {
  var grp = el('div', 'fld');
  var lb = el('label'); lb.appendChild(document.createTextNode(label));
  if (hint) lb.appendChild(el('span', 'n', hint));
  grp.appendChild(lb);
  var sel = document.createElement('select');
  if (placeholder) {
    var op0 = document.createElement('option');
    op0.value = ''; op0.textContent = placeholder; sel.appendChild(op0);
  }
  (options || []).forEach(function (o) {
    var op = document.createElement('option');
    op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
  });
  var cur = getPath(path);
  sel.value = cur === undefined || cur === null ? '' : String(cur);
  sel.addEventListener('change', function () { setPath(path, sel.value); commit(); });
  grp.appendChild(sel);
  return grp;
}
function tableField(colsPath, rowsPath, label, hint) {
  var grp = el('div', 'fld');
  var lb = el('label'); lb.appendChild(document.createTextNode(label || '표'));
  if (hint) lb.appendChild(el('span', 'n', hint));
  grp.appendChild(lb);
  var wrap = el('div', 'tblWrap');
  var tbl = el('table', 'grid');
  wrap.appendChild(tbl); grp.appendChild(wrap);
  function draw() {
    tbl.innerHTML = '';
    var cols = getPath(colsPath) || [], rows = getPath(rowsPath) || [];
    var thead = el('tr', 'headRow');
    cols.forEach(function (c, j) {
      var th = document.createElement('th');
      var inp = document.createElement('textarea');
      inp.rows = 1; inp.value = c === undefined || c === null ? '' : String(c);
      inp.addEventListener('input', function () {
        inp.style.height = 'auto';
        inp.style.height = (inp.scrollHeight) + 'px';
        var a = getPath(colsPath) || []; a[j] = inp.value; setPath(colsPath, a); commit();
      });
      th.appendChild(inp); thead.appendChild(th);
    });
    tbl.appendChild(thead);
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      cols.forEach(function (c, j) {
        var td = document.createElement('td');
        var inp = document.createElement('textarea');
        inp.rows = 1; inp.value = row[j] === undefined || row[j] === null ? '' : String(row[j]);
        inp.addEventListener('input', function () {
          inp.style.height = 'auto';
          inp.style.height = (inp.scrollHeight) + 'px';
          var rs = getPath(rowsPath) || [];
          if (!rs[i]) return;
          rs[i][j] = inp.value; setPath(rowsPath, rs); commit();
        });
        td.appendChild(inp); tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
  }
  draw();
  return grp;
}
/* ---------------------------------------------------------------- 11b. 인스타 캡션
   다섯 챕터 모두 최상위 `caption` 한 벌만 쓴다(1장~마지막 장 공통 · 표지·2장·3장~ 어느 화면에서 고쳐도 같은 칸).
   예전 뷰티 브리핑 덱처럼 `caption` 없이 `openingCaption` 만 있는 JSON 은 migrateCaption 이
   읽을 때 `caption` 으로 옮겨 두고, 저장은 `caption` 에 한다. */
/* 예전 브리핑 덱(caption 비어 있고 openingCaption 만 있음) → 단일 caption 으로 안전하게 읽기. */
function migrateCaption(d) {
  if (!d) return d;
  if (typeof d.caption !== 'string') d.caption = d.caption === undefined || d.caption === null ? '' : String(d.caption);
  if (!d.caption.trim() && d.openingCaption && String(d.openingCaption).trim()) d.caption = String(d.openingCaption);
  return d;
}
function isBrief() { return state.family === 'brief'; }
function itemBox(title, kicker) {
  var box = el('div', 'item');
  var h = el('h4');
  if (kicker) h.appendChild(el('span', 'k', kicker));
  h.appendChild(document.createTextNode(title));
  box.appendChild(h);
  return box;
}

function nodePath(nd, basePath, sub) {
  if (nd.abs) return (nd.path || []).concat(sub || []);
  return basePath.concat(nd.path || [], sub || []);
}
function seedIfEmpty(nd, basePath) {
  var p = nodePath(nd, basePath), cur = getPath(p);
  var empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length);
  if (empty) setPath(p, clone(nd.seed));
}
function renderNodes(nodes, basePath, container) {
  nodes.forEach(function (nd) {
    // 기본값 폴백으로만 그려지던 칸(예: 도해 이름표)은 폼을 열 때 기본값을 데이터에 심어
    // 화면과 편집칸이 같은 값을 보게 한다.
    if (nd.seed !== undefined) seedIfEmpty(nd, basePath);
    if (nd.t === 'text') container.appendChild(textField(nodePath(nd, basePath), nd.label, nd.rows, nd.hint, nd.rebuild));
    else if (nd.t === 'lines') container.appendChild(headlineField(nodePath(nd, basePath), nd.label));
    else if (nd.t === 'strarr') container.appendChild(strArrField(nodePath(nd, basePath), nd.label, nd.hint));
    else if (nd.t === 'select') container.appendChild(selectField(nodePath(nd, basePath), nd.label, nd.options, nd.hint, nd.placeholder));
    else if (nd.t === 'note') container.appendChild(el('p', 'subnote', nd.text || ''));
    else if (nd.t === 'table') container.appendChild(tableField(nodePath({ path: nd.colsPath, abs: nd.abs }, basePath), nodePath({ path: nd.rowsPath, abs: nd.abs }, basePath), nd.label, nd.hint));
    else if (nd.t === 'obj') {
      var box = el('div', 'item');
      if (nd.title) box.appendChild(el('h4', null, nd.title));
      renderNodes(nd.nodes, nodePath(nd, basePath), box);
      container.appendChild(box);
    } else if (nd.t === 'arr') {
      var arrPath = nodePath(nd, basePath);
      var arr = getPath(arrPath) || [];
      if (nd.hint) container.appendChild(el('p', 'subnote', nd.hint));
      arr.forEach(function (item, i) {
        var box2 = itemBox(nd.titleFn ? nd.titleFn(item || {}, i) : (i + 1) + '번', nd.kicker);
        // nodes 를 함수로 주면 항목(매대 종류 등)마다 다른 칸을 보여줄 수 있다.
        var subNodes = typeof nd.nodes === 'function' ? nd.nodes(item || {}, i) : (nd.nodes || []);
        renderNodes(subNodes, arrPath.concat([i]), box2);
        container.appendChild(box2);
      });
      if (nd.addable) {
        var add = el('button', 'mini', '+ 항목 추가'); add.type = 'button';
        add.addEventListener('click', function () {
          var a = getPath(arrPath) || [];
          a.push(clone(nd.template || {})); setPath(arrPath, a);
          buildPanel(); commit();
        });
        container.appendChild(add);
      }
    }
  });
}

function group(title, nodes, cnt, open) {
  return { title: title, nodes: nodes, cnt: cnt, open: open };
}

function coverSpec() {
  var g = [];
  var cov = D.cover || {};
  if (state.family === 'pick') {
    g.push(group('표지 문구 (뷰티 픽)', [
      { t: 'lines', path: ['headline'], label: '표지 헤드라인' },
      { t: 'text', path: ['lead'], label: '리드 (굵은 한 줄)', rows: 1 },
      { t: 'text', path: ['body'], label: '본문', rows: 3 },
      { t: 'strarr', path: ['tags'], label: '태그 (네모 박스)' },
      { t: 'text', path: ['page'], label: '좌상단 쪽 번호', rows: 1, seed: '01' },
      { t: 'text', path: ['label'], label: '좌상단 라벨', rows: 1, seed: 'PICK' },
      { t: 'text', path: ['photo_source'], label: '사진 출처 크레딧', rows: 1 }
    ]));
    return g;
  }
  var layout = coverLayout(cov, state.family);
  var nodes = [{ t: 'lines', path: ['headline'], label: '표지 헤드라인' }];
  if (layout === 'block') {
    if (cov.series_name !== undefined) nodes.push({ t: 'text', path: ['series_name'], label: '시리즈명 (우상단)', rows: 1 });
    if (cov.num !== undefined) nodes.push({ t: 'text', path: ['num'], label: '이슈 번호', rows: 1 });
    nodes.push({ t: 'text', path: ['sub'], label: '서브 문구', rows: 2 });
    g.push(group('표지 문구 (2분할 블록)', nodes));
    return g;
  }
  nodes.push({ t: 'text', path: ['kicker'], label: '킥커 (작은 라벨)', rows: 1 });
  nodes.push({ t: 'text', path: ['sub'], label: '서브 문구', rows: 2 });
  if (cov.badge !== undefined) nodes.push({ t: 'text', path: ['badge'], label: '배지', rows: 1 });
  g.push(group('표지 문구', nodes));
  return g;
}
function indexSpec() {
  var g = [];
  var n = (D.slides || []).length;
  g.push(group('요약 장표', [
    { t: 'text', path: ['headline'], label: '제목 (오른쪽 저널)', rows: 1, hint: '건수 숫자는 그리지 않음' },
    { t: 'text', path: ['lead'], label: '리드 1줄', rows: 2, hint: '비우면 분야로 자동' },
    { t: 'strarr', path: ['keywords'], label: '왼쪽 레일 키워드 (최대 4개)', hint: '비우면 자동' },
    { t: 'text', path: ['footer'], label: '하단 문구', rows: 1 }
  ]));
  g.push(group('요약 행 (기사별)', [
    {
      t: 'arr', path: ['slides'], abs: true, kicker: '행',
      titleFn: function (it, i) { return pad2(i + 1) + ' · ' + String(it.label || '').replace(/^\d+\s*·\s*/, ''); },
      nodes: [
        { t: 'text', path: ['index_title'], label: '제목', rows: 1 },
        { t: 'text', path: ['index_figure'], label: '핵심 수치', rows: 1 }
      ]
    }
  ], n + '행'));
  return g;
}
function slideSpec(s, i) {
  var fam = state.family;
  var kind = s.kind || (fam === 'brief' ? 'brief' : 'table');
  var base = [], mid = [], tail = [];
  base.push({ t: 'text', path: ['label'], label: '라벨 (예: 01 · 기준)', rows: 1 });
  base.push({ t: 'lines', path: ['headline'], label: '헤드라인' });
  // 확인(check) 장표의 body 는 장표 맨 아래 안내 줄이라, 제목·본문이 아니라 확인 항목 칸 끝에서 고친다.
  var checkBodyInGroup = fam === 'pick' && kind === 'check';
  if (s.body !== undefined && !checkBodyInGroup) base.push({ t: 'text', path: ['body'], label: '본문', rows: 3 });

  function push(o) { mid.push(o); }
  if (fam === 'brief') {
    push({ t: 'text', path: ['index_title'], label: '요약 장표 제목', rows: 1 });
    push({ t: 'text', path: ['index_figure'], label: '요약 장표 핵심 수치', rows: 1 });
    push({ t: 'select', path: ['counter_type'], label: '덧붙이는 말 유형',
      hint: '반론·후속·보완·유의·용어 · 정정은 후속으로 통일', placeholder: '— 유형 선택 —',
      options: [['반론', '반론'], ['후속', '후속'], ['보완', '보완'], ['유의', '유의'], ['용어', '용어']] });
    var ch = s.chart || {};
    if (ch.type === 'table' || !ch.type) {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'table', colsPath: ['chart', 'columns'], rowsPath: ['chart', 'rows'], label: '칸 고치기', hint: '칸을 누르면 바로 반영' });
    } else if (ch.type === 'bar_v') {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'strarr', path: ['chart', 'labels'], label: '항목 이름' });
      push({ t: 'strarr', path: ['chart', 'display'], label: '표시 값' });
    } else if (ch.type === 'line') {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'strarr', path: ['chart', 'labels'], label: 'x축 항목 이름' });
      push({ t: 'strarr', path: ['chart', 'display'], label: '표시 값 (예: +12.4%)' });
      push({ t: 'text', path: ['chart', 'inflection'], label: '꺾임(둔화) 시작 인덱스', rows: 1, hint: '0부터 · 비우면 없음' });
    } else if (ch.type === 'bar_h') {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'arr', path: ['chart', 'items'], titleFn: function (it, k) { return (it.label || '') + ' · ' + (it.display || ''); }, kicker: '막대', nodes: [{ t: 'text', path: ['label'], label: '이름', rows: 1 }, { t: 'text', path: ['display'], label: '표시 값', rows: 1 }] });
    } else if (ch.type === 'timeline') {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'arr', path: ['chart', 'items'], titleFn: function (it) { return it.date || ''; }, kicker: '일자', nodes: [{ t: 'text', path: ['date'], label: '날짜', rows: 1 }, { t: 'text', path: ['text'], label: '내용', rows: 2 }] });
    }
  } else if (fam === 'tech') {
    if (kind === 'points') push({ t: 'arr', path: ['points'], kicker: '번호', titleFn: function (it) { return (it.num ? it.num + ' ' : '') + (it.title || ''); }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['text'], label: '설명', rows: 3 }] });
    else if (kind === 'band') {
      if (s.lead !== undefined) push({ t: 'text', path: ['lead'], label: '리드 문구', rows: 2 });
      push({ t: 'arr', path: ['legend'], kicker: '범례', titleFn: function (it) { return (it.num ? it.num + ' ' : '') + (it.title || ''); }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['desc'], label: '설명', rows: 3 }] });
    } else if (kind === 'split') {
      if (s.lead !== undefined) push({ t: 'text', path: ['lead'], label: '리드 문구', rows: 2 });
      push({ t: 'arr', path: ['blocks'], kicker: '블록', titleFn: function (it) { return it.label || '블록'; }, nodes: [{ t: 'text', path: ['label'], label: '소제목', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 3 }] });
      if (s.image_caption !== undefined) push({ t: 'text', path: ['image_caption'], label: '사진 캡션', rows: 1 });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '노트', rows: 2 });
    } else if (kind === 'duo') {
      if (s.lead !== undefined) push({ t: 'text', path: ['lead'], label: '리드 문구', rows: 2 });
      push({ t: 'arr', path: ['panels'], kicker: '패널', titleFn: function (it) { return it.title || ''; }, nodes: [{ t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['tag'], label: '작은 태그', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 3 }] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '노트', rows: 2 });
    } else if (kind === 'table') {
      push({ t: 'table', colsPath: ['table', 'columns'], rowsPath: ['table', 'rows'], label: '칸 고치기' });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '표 아래 노트', rows: 2 });
    } else if (kind === 'compare') {
      push({ t: 'arr', path: ['panels'], kicker: '패널', titleFn: function (it) { return it.title || ''; }, nodes: [{ t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['tag'], label: '작은 태그', rows: 1 }] });
      push({ t: 'arr', path: ['rows'], kicker: '비교', titleFn: function (it) { return it.label || ''; }, nodes: [{ t: 'text', path: ['label'], label: '항목', rows: 1 }, { t: 'text', path: ['left'], label: '왼쪽 값', rows: 2 }, { t: 'text', path: ['right'], label: '오른쪽 값', rows: 2 }] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '노트', rows: 2 });
    } else if (kind === 'products') {
      push({ t: 'arr', path: ['items'], kicker: '제품', titleFn: function (it) { return it.name || ''; }, nodes: [
        { t: 'text', path: ['tag'], label: '태그', rows: 1 },
        { t: 'text', path: ['name'], label: '제품명', rows: 2 },
        { t: 'text', path: ['spec'], label: '스펙 한 줄', rows: 1 },
        { t: 'strarr', path: ['lines'], label: '설명 줄' },
        { t: 'arr', path: ['sections'], kicker: '섹션', titleFn: function (it) { return it.label || '섹션'; }, nodes: [{ t: 'text', path: ['label'], label: '소제목', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 2 }] },
        { t: 'text', path: ['credit'], label: '출처', rows: 1 }
      ] });
    } else if (kind === 'quad') {
      push({ t: 'arr', path: ['cards'], kicker: '카드', titleFn: function (it) { return it.title || ''; }, nodes: [{ t: 'text', path: ['eyebrow'], label: '아이브로우', rows: 1 }, { t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 3 }, { t: 'text', path: ['stat'], label: '수치 배지', rows: 1 }] });
    } else if (kind === 'steps') {
      push({ t: 'arr', path: ['items'], kicker: '단계', titleFn: function (it) { return (it.num ? it.num + ' ' : '') + (it.title || ''); }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['sub'], label: '오른쪽 배지', rows: 1 }, { t: 'text', path: ['text'], label: '설명', rows: 2 }] });
      if (s.note_band) push({ t: 'text', path: ['note_band'], label: '하단 키컬러 띠', rows: 1 });
    } else if (kind === 'closing') {
      push({ t: 'arr', path: ['cards'], kicker: '카드', titleFn: function (it) { return (it.num ? it.num + ' ' : '') + (it.text || ''); }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['text'], label: '문구', rows: 2 }, { t: 'text', path: ['tone'], label: '톤 (ink 또는 key)', rows: 1 }] });
      if (s.note_band) push({ t: 'text', path: ['note_band'], label: '하단 안내 띠', rows: 2 });
    } else if (kind === 'lineage') {
      push({ t: 'arr', path: ['rows'], kicker: '단계', titleFn: function (it) { return it.name || ''; }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['name'], label: '이름', rows: 1 }, { t: 'text', path: ['sub'], label: '부제', rows: 1 }, { t: 'text', path: ['tag'], label: '태그', rows: 1 }] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '노트', rows: 2 });
    }
  } else if (fam === 'pick') {
    if (kind === 'story') {
      push({ t: 'arr', path: ['facts'], kicker: '사실', titleFn: function (it) { return it[0] || '사실'; }, nodes: [{ t: 'text', path: [0], label: '큰 값', rows: 1 }, { t: 'text', path: [1], label: '설명', rows: 1 }] });
    } else if (kind === 'stats') {
      push({ t: 'arr', path: ['stats'], kicker: '숫자', titleFn: function (it) { return (it.value || '') + ' ' + (it.unit || ''); }, nodes: [{ t: 'text', path: ['value'], label: '값', rows: 1 }, { t: 'text', path: ['unit'], label: '단위·이름', rows: 1 }, { t: 'text', path: ['note'], label: '설명', rows: 1 }] });
      if (s.side_image) push({ t: 'obj', path: ['side_image'], title: '오른쪽 사진', nodes: [{ t: 'text', path: ['credit'], label: '사진 크레딧', rows: 1 }] });
    } else if (kind === 'diagram') {
      push({ t: 'text', path: ['banner'], label: '오른쪽 배지 문구', rows: 1 });
      push({ t: 'arr', path: ['rows'], kicker: '층', titleFn: function (it) { return it.title || '층'; }, nodes: [{ t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['sub'], label: '영문 라벨', rows: 1 }, { t: 'text', path: ['text'], label: '설명', rows: 1 }, { t: 'text', path: ['ratio'], label: '막대 비율 (0~1)', rows: 1 }, { t: 'text', path: ['tone'], label: '색 (ink 또는 key)', rows: 1 }] });
    } else if (kind === 'table') {
      push({ t: 'strarr', path: ['columns'], label: '열 이름' });
      push({ t: 'table', colsPath: ['columns'], rowsPath: ['rows'], label: '칸 고치기', hint: '칸을 누르면 바로 반영' });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '표 아래 노트', rows: 2 });
    } else if (kind === 'checks') {
      push({ t: 'arr', path: ['items'], kicker: '항목', titleFn: function (it, k) { return pad2(k + 1) + ' · ' + (it.title || ''); }, nodes: [{ t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['body'], label: '본문', rows: 3 }] });
    } else if (kind === 'notes') {
      push({ t: 'arr', path: ['callouts'], kicker: '스티커', titleFn: function (it) { return it.text || '문구'; }, nodes: [
        { t: 'text', path: ['text'], label: '문구', rows: 2 },
        { t: 'obj', path: [], title: '위치·크기 (선택)', nodes: [
          { t: 'text', path: ['x'], label: '가로 위치', rows: 1, hint: '0~1080' },
          { t: 'text', path: ['y'], label: '세로 위치', rows: 1, hint: '0~1000' },
          { t: 'text', path: ['size'], label: '글자 크기', rows: 1 },
          { t: 'text', path: ['tilt'], label: '기울기 (도)', rows: 1 },
          { t: 'text', path: ['fill'], label: '바탕색', rows: 1, hint: '#FFFFFF' }
        ] }
      ] });
    } else if (kind === 'how') {
      push({ t: 'text', path: ['intro'], label: '도입 본문', rows: 3 });
      push({ t: 'text', path: ['banner'], label: '오른쪽 배지 문구', rows: 1 });
      push({ t: 'arr', path: ['panels'], kicker: '매대', titleFn: function (it) { return it.title || '매대'; }, nodes: function (panel) {
        var common = [
          { t: 'text', path: ['type'], label: '도해 종류 (brand / type)', rows: 1, hint: 'brand = 브랜드별 벽 · type = 종류별 선반', rebuild: true },
          { t: 'text', path: ['title'], label: '제목', rows: 1 },
          { t: 'text', path: ['sub'], label: '영문 라벨', rows: 1 },
          { t: 'text', path: ['caption'], label: '하단 캡션', rows: 2 }
        ];
        if (panel && panel.type === 'brand') {
          common.push({ t: 'strarr', path: ['names'], label: '브랜드 이름표', hint: '왼쪽부터 · 비우면 브랜드 A~C', seed: ['브랜드 A', '브랜드 B', '브랜드 C'] });
        } else {
          common.push({ t: 'strarr', path: ['labels'], label: '종류 이름표', hint: '위에서부터 · 비우면 베이스·쿠션 / 립 / 아이 / 블러셔', seed: ['베이스·쿠션', '립', '아이', '블러셔'] });
        }
        return common;
      } });
    } else if (kind === 'spot') {
      push({ t: 'arr', path: ['callouts'], kicker: '스티커', titleFn: function (it) { return it.text || '문구'; }, nodes: [
        { t: 'text', path: ['text'], label: '문구', rows: 2 },
        { t: 'obj', path: [], title: '위치·크기 (선택)', nodes: [
          { t: 'text', path: ['x'], label: '가로 위치', rows: 1, hint: '0~1080' },
          { t: 'text', path: ['y'], label: '세로 위치', rows: 1, hint: '0~1000' },
          { t: 'text', path: ['size'], label: '글자 크기', rows: 1 },
          { t: 'text', path: ['tilt'], label: '기울기 (도)', rows: 1 },
          { t: 'text', path: ['fill'], label: '바탕색', rows: 1, hint: '#FFFFFF' }
        ] }
      ] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '사진 아래 각주', rows: 2 });
    } else if (kind === 'floor') {
      push({ t: 'text', path: ['answer'], label: '상단 답 줄', rows: 2 });
      push({ t: 'strarr', path: ['columns'], label: '열 이름 (3열 고정)', seed: ['층', '무엇이 있나', '대표 체험 · 공간'] });
      push({ t: 'arr', path: ['rows'], kicker: '층', titleFn: function (it) { return [it.floor, it.title].filter(Boolean).join(' · ') || '층'; }, nodes: [
        { t: 'text', path: ['floor'], label: '층 (예: 1F)', rows: 1 },
        { t: 'text', path: ['what'], label: '무엇이 있나', rows: 2 },
        { t: 'text', path: ['title'], label: '대표 체험·공간', rows: 2 },
        { t: 'text', path: ['desc'], label: '설명', rows: 3 },
        { t: 'text', path: ['tag'], label: '우측 태그', rows: 1 }
      ] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '표 아래 각주', rows: 2 });
    } else if (kind === 'scale') {
      push({ t: 'arr', path: ['stats'], kicker: '수치', titleFn: function (it) { return it.value || '수치'; }, nodes: [
        { t: 'text', path: ['value'], label: '값', rows: 1 },
        { t: 'text', path: ['note'], label: '설명', rows: 2 }
      ] });
    } else if (kind === 'age') {
      push({ t: 'arr', path: ['stats'], kicker: '큰 숫자', titleFn: function (it) { return it.value || '숫자'; }, nodes: [
        { t: 'text', path: ['value'], label: '값', rows: 1 },
        { t: 'text', path: ['note'], label: '보조 라벨', rows: 2 }
      ] });
      if (s.mini) push({ t: 'obj', path: ['mini'], title: '비교 표', nodes: [
        { t: 'text', path: ['head'], label: '표 제목', rows: 1 },
        { t: 'table', colsPath: ['cols'], rowsPath: ['rows'], label: '칸 고치기', hint: '칸을 누르면 바로 반영' }
      ] });
    } else if (kind === 'check') {
      push({ t: 'arr', path: ['items'], kicker: '확인', titleFn: function (it, k) { return pad2(k + 1) + ' · ' + (it.title || ''); }, nodes: function (item) {
        var n = [{ t: 'text', path: ['title'], label: '제목', rows: 1 }];
        // 동선 줄은 이미 있는 항목에만 보여준다(빈 칸을 늘어놓지 않게).
        if (item && item.route) {
          n.push({ t: 'obj', path: ['route'], title: '위치·시간 줄 (모두 비우면 사라짐)', nodes: [
            { t: 'text', path: ['from'], label: '출발지', rows: 1 },
            { t: 'text', path: ['walk'], label: '도보 시간', rows: 1 },
            { t: 'text', path: ['to'], label: '도착지', rows: 1 },
            { t: 'text', path: ['hours'], label: '운영 시간', rows: 1 }
          ] });
        }
        n.push({ t: 'text', path: ['body'], label: '본문', rows: 3 });
        return n;
      } });
      // 장표 맨 아래 안내 줄(예: 07 CHECK 의 "보고 싶은 층을 …"). 비우면 캔버스에서 바로 사라진다.
      push({ t: 'text', path: ['body'], label: '하단 안내 문구', rows: 2, hint: '비우면 장표에서 사라짐' });
    } else if (kind === 'closing') {
      push({ t: 'text', path: ['cta'], label: '저장·공유 유도 문구', rows: 2 });
      push({ t: 'text', path: ['sources_label'], label: '출처 라벨', rows: 1, hint: '기본 SOURCES', seed: 'SOURCES' });
      push({ t: 'strarr', path: ['sources'], label: '출처 목록' });
      push({ t: 'text', abs: true, path: ['disclaimer'], label: '면책 문구', rows: 3 });
      push({ t: 'text', path: ['credit'], label: '사진 크레딧 (보관용)', rows: 1, hint: '장표에는 그리지 않음 · 사진 출처는 SOURCES에' });
    }
  } else {
    if (kind === 'table') push({ t: 'table', colsPath: ['table', 'columns'], rowsPath: ['table', 'rows'], label: '칸 고치기' });
    else if (kind === 'cards') push({ t: 'arr', path: ['cards'], kicker: '카드', titleFn: function (it) { return it.title || ''; }, nodes: [{ t: 'text', path: ['eyebrow'], label: '아이브로우', rows: 1 }, { t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'strarr', path: ['items'], label: '항목' }, { t: 'text', path: ['note'], label: '하단 메모', rows: 1 }] });
    else if (kind === 'brand_pair') {
      push({ t: 'arr', path: ['images'], kicker: '이미지', titleFn: function (it, k) { return (it.tag || '') + ' 이미지 ' + (k + 1); }, nodes: [{ t: 'text', path: ['tag'], label: '태그', rows: 1 }, { t: 'text', path: ['caption'], label: '캡션', rows: 1 }] });
      push({ t: 'table', colsPath: ['table', 'columns'], rowsPath: ['table', 'rows'], label: '칸 고치기' });
    } else if (kind === 'brand_wide') {
      push({ t: 'obj', path: ['image'], title: '이미지 카드', nodes: [{ t: 'strarr', path: ['lines'], label: '로고 카드 문구 (작은 글씨)' }, { t: 'text', path: ['caption'], label: '이미지 캡션', rows: 1 }] });
      push({ t: 'arr', path: ['blocks'], kicker: '블록', titleFn: function (it) { return it.label || '블록'; }, nodes: [{ t: 'text', path: ['label'], label: '소제목', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 3 }] });
    } else if (kind === 'list' || kind === 'reasons') {
      push({ t: 'arr', path: ['items'], kicker: '항목', titleFn: function (it, k) { return pad2(k + 1) + ' · ' + (it.title || ''); }, nodes: [{ t: 'text', path: ['title'], label: '제목', rows: 1 }, { t: 'text', path: ['body'], label: '본문', rows: 3 }] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '하단 노트', rows: 2 });
    } else if (kind === 'bars') {
      push({ t: 'obj', path: ['chart'], title: '막대 도표', nodes: [
        { t: 'text', path: ['ink_label'], label: '검정 범례 이름', rows: 1 },
        { t: 'text', path: ['key_label'], label: '키컬러 범례 이름', rows: 1 },
        { t: 'arr', path: ['items'], kicker: '막대', titleFn: function (it) { return it.label || ''; }, nodes: [{ t: 'text', path: ['label'], label: '이름', rows: 1 }, { t: 'text', path: ['display'], label: '표시 값', rows: 1 }] },
        { t: 'text', path: ['note'], label: '도표 노트', rows: 2 }
      ] });
    } else if (kind === 'lineup') {
      push({ t: 'arr', path: ['products'], kicker: '제품', titleFn: function (it) { return it.name || ''; }, nodes: [
        { t: 'text', path: ['family'], label: '성분 계열', rows: 1 },
        { t: 'text', path: ['name'], label: '제품명', rows: 2 },
        { t: 'text', path: ['class'], label: '허가 분류', rows: 1 },
        { t: 'arr', path: ['spec'], kicker: '포장 · 사용 · 구매처 · 사용대상', titleFn: function (it) { return it.label || ''; }, nodes: [
          { t: 'text', path: ['label'], label: '표기', rows: 1 },
          { t: 'text', path: ['value'], label: '내용', rows: 2 }
        ] }
      ] });
    } else if (kind === 'figure') {
      if (s.caption !== undefined) push({ t: 'text', path: ['caption'], label: '그림 캐션', rows: 1 });
    }
  }
  if (s.takeaway !== undefined) {
    tail.push({ t: 'text', path: ['takeaway'], label: 'POINT 문구', rows: 2 });
    if (s.takeaway_label !== undefined) tail.push({ t: 'text', path: ['takeaway_label'], label: 'POINT 라벨', rows: 1 });
  }
  if (s.source !== undefined) tail.push({ t: 'text', path: ['source'], label: '출처', rows: 1 });

  var out = [group('제목 · 본문', base)];
  if (mid.length) out.push(group(kindName(kind, fam), mid));
  if (tail.length) out.push(group('마무리', tail));
  return out;
}
function kindName(kind, fam) {
  var names = {
    table: '표', cards: '카드', brand_pair: '이미지 + 표', brand_wide: '이미지 + 블록', list: '번호 목록',
    reasons: '이유 목록', bars: '막대 도표', points: '포인트', band: '사진 띠', split: '사진 + 블록',
    lineup: '제품 5종', figure: '도해',
    compare: '비교 패널', products: '제품', quad: '4칸 카드', steps: '단계', lineage: '계보', closing: '마무리', brief: '도표',
    story: '사실 · 요약', stats: '숫자 카드', diagram: '막대 도해', checks: '항목 목록', notes: '사진 · 스티커',
    how: '매대 비교 도해', spot: '현장 사진 · 스티커', floor: '층별 안내', scale: '수치 카드',
    age: '큰 숫자 · 비교표', check: '확인 항목'
  };
  return names[kind] || '내용';
}

/* 인스타 캡션 그룹 — 다섯 챕터 모두 최상위 `caption` 한 칸만 둔다.
   표지·2장·3장~ 어느 장표에서 보더라도 같은 한 벌을 고치는 같은 칸이다. */
var CAP_HINT_DEFAULT = '제목 1줄 · 빈 줄 · 요약 2~3줄 (해시태그 없이) · 결재 시 함께 커밋';
var CAP_HINT_BRIEF = '오프닝 + 기사 압축 요약 · 해시태그 없이 · 2,200자 이내';
function captionGroups(page) {
  var g = [group('인스타 캡션', [
    { t: 'text', abs: true, path: ['caption'], label: '인스타 캡션', rows: 6, hint: isBrief() ? CAP_HINT_BRIEF : CAP_HINT_DEFAULT }
  ])];
  if (state.family === 'pick') {
    g.unshift(group('뷰티 픽 하단 푸터', [
      { t: 'text', abs: true, path: ['series'], label: '시리즈 문구', rows: 1, hint: '하단 BEAUTY PICK 자리' },
      { t: 'text', abs: true, path: ['date'], label: '날짜 (YYYY.MM.DD)', rows: 1, hint: '결재 시 결재일로 자동 변경' }
    ]));
  }
  return g;
}
function buildPanel() {
  var body = document.getElementById('panelBody');
  body.innerHTML = '';
  var page = state.pages[state.page];
  if (!page) return;
  var basePath = page.type === 'cover' ? ['cover'] : page.type === 'index' ? ['index'] : ['slides', page.i];
  var specs = page.type === 'cover' ? coverSpec() : page.type === 'index' ? indexSpec() : slideSpec(D.slides[page.i] || {}, page.i);
  // 인스타 캡션 — 표지·페이지 문구 수정 칸을 모두 내보낸 뒤 맨 아래에 둔다.
  specs = specs.concat(captionGroups(page));
  specs.forEach(function (g, gi) {
    var det = document.createElement('details');
    det.className = 'grp';
    if (g.open === true || (g.open === undefined && gi < 2)) det.open = true;
    var sum = document.createElement('summary');
    sum.appendChild(document.createTextNode(g.title));
    if (g.cnt) sum.appendChild(el('span', 'cnt', g.cnt));
    det.appendChild(sum);
    renderNodes(g.nodes || [], basePath, det);
    body.appendChild(det);
  });
  updateStageHead();
}

/* ---------------------------------------------------------------- 13. 내보내기 */
function download(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function exportPng() {
  var page = state.pages[state.page];
  renderPage(page);
  var name = (state.presetId === '__custom__' ? 'cardnews-custom' : (state.presetId || 'cardnews'));
  var tag = page.type === 'cover' ? 'cover' : page.type === 'index' ? 'index' : 'p' + pad2(page.i + 1);
  cv.toBlob(function (blob) {
    if (!blob) { toast('PNG를 만들지 못했습니다'); return; }
    download(blob, name + '-' + tag + '.png');
    toast('PNG 저장 · ' + name + '-' + tag + '.png');
  }, 'image/png');
}
function exportJson() {
  var name = (state.presetId === '__custom__' ? 'cardnews-custom' : (state.presetId || 'cardnews'));
  var blob = new Blob([JSON.stringify(D, null, 2)], { type: 'application/json' });
  download(blob, name + '-edited.json');
  toast('수정 JSON을 내려받았습니다 · GitHub에 저장하거나 피클에게 넘기면 됩니다');
}

/* ---------------------------------------------------------------- 13b. 전체 장표 PNG */
function exportAllPng() {
  if (!D) return;
  var btn = document.getElementById('btnPngAll');
  if (btn.disabled) return;
  var name = state.presetId || 'cardnews';
  var pages = state.pages.slice();
  var i = 0;
  btn.disabled = true;
  toast('전체 ' + pages.length + '장 PNG 저장을 시작합니다\n브라우저가 여러 파일 저장을 물으면 허용해 주세요');
  function step() {
    if (i >= pages.length) {
      btn.disabled = false;
      requestRender();
      toast('전체 ' + pages.length + '장 PNG를 저장했습니다');
      return;
    }
    var page = pages[i];
    try { renderPage(page); } catch (e) { if (window.console) console.error(e); }
    var tag = page.type === 'cover' ? 'cover' : page.type === 'index' ? 'index' : 'p' + pad2(page.i + 1);
    cv.toBlob(function (blob) {
      if (blob) download(blob, name + '-' + tag + '.png');
      i++;
      setTimeout(step, 450);
    }, 'image/png');
  }
  step();
}

/* ---------------------------------------------------------------- 13c. 전체 장표 ZIP(외부 라이브러리 없이) */
var _crcTable = null;
function crc32(u8) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) crc = _crcTable[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  var enc = new TextEncoder();
  var chunks = [], central = [], offset = 0, centralSize = 0;
  files.forEach(function (f) {
    var nameBytes = enc.encode(f.name);
    var crc = crc32(f.data), size = f.data.length;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0x2100, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, f.data);

    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x2100, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    centralSize += 46 + nameBytes.length;
    offset += 30 + nameBytes.length + size;
  });
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
}
function exportAllZip() {
  if (!D) return;
  var btn = document.getElementById('btnZip');
  if (btn.disabled) return;
  var name = state.presetId || 'cardnews';
  var pages = state.pages.slice();
  var i = 0, files = [];
  btn.disabled = true;
  toast('전체 ' + pages.length + '장을 ZIP으로 묶는 중…');
  function step() {
    if (i >= pages.length) {
      try {
        download(zipStore(files), name + '-png.zip');
        toast('ZIP 저장 · ' + name + '-png.zip (' + pages.length + '장)');
      } catch (e) {
        toast('ZIP을 만들지 못했습니다 · ' + (e && e.message));
      }
      btn.disabled = false;
      requestRender();
      return;
    }
    var page = pages[i];
    try { renderPage(page); } catch (e) { if (window.console) console.error(e); }
    var tag = page.type === 'cover' ? 'cover' : page.type === 'index' ? 'index' : 'p' + pad2(page.i + 1);
    cv.toBlob(function (blob) {
      if (blob) {
        blob.arrayBuffer().then(function (buf) {
          files.push({ name: name + '-' + tag + '.png', data: new Uint8Array(buf) });
          i++;
          setTimeout(step, 30);
        });
      } else { i++; setTimeout(step, 30); }
    }, 'image/png');
  }
  step();
}

/* ---------------------------------------------------------------- 14. 홈 갤러리 · 라우팅 · 시작 */
function esc2(s) { return esc(s); }

function cardEl(d, i) {
  var ch = chapterOf(d.series);
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'card' + (deckIsTest(d) ? ' isTest' : '');
  b.setAttribute('data-id', d.id);
  b.setAttribute('aria-label', d.title + ' — 문구 수정 화면 열기');

  var cover = document.createElement('div');
  cover.className = 'cardCover';
  var img = document.createElement('img');
  img.src = d.coverThumb || '';
  img.alt = d.title + ' 표지';
  img.loading = i < 4 ? 'eager' : 'lazy';
  img.decoding = 'async';
  cover.appendChild(img);
  var issue = document.createElement('span');
  issue.className = 'issue' + (deckIsTest(d) ? ' test' : '');
  issue.textContent = issueLabel(d);
  cover.appendChild(issue);
  b.appendChild(cover);

  var body = document.createElement('div');
  body.className = 'cardBody';
  var st = deckStatus(d);
  if (st) {
    var pill = document.createElement('span');
    pill.className = 'statusTag ' + st.kind;
    pill.textContent = st.text;
    pill.title = statusTip(d);
    body.appendChild(pill);
  }

  var kick = document.createElement('div');
  kick.className = 'cardKicker';
  kick.innerHTML = '<span class="dot"></span><span class="k">' + esc(d.seriesLabel || ch.label) + '</span>' +
    '<span class="date">' + esc(fmtDate(d.date)) + '</span>';
  body.appendChild(kick);
  var t = document.createElement('div');
  t.className = 'cardTitle';
  t.textContent = d.title || d.id;
  body.appendChild(t);
  if (d.subtitle) {
    var sub = document.createElement('div');
    sub.className = 'cardSub';
    sub.textContent = d.subtitle;
    body.appendChild(sub);
  }
  b.appendChild(body);

  b.addEventListener('click', function () { location.hash = '#/edit/' + encodeURIComponent(d.id); });
  return b;
}

/* -------------------- 홈 갤러리 레이아웃
   · 최신순: 날짜 내림차순, 같은 날짜면 호수(issueNo) 내림차순
   · 모바일(≤720px): 챕터당 4개(2열 × 2행) + 1 2 3 … 페이지네이션
   · 데스크톱(≥721px): 챕터당 6열 가로스크롤 + ‹ › 화살표
   -------------------- */
var GAL_MQ = '(max-width: 720px)';
var GAL_PER_PAGE = 4;   /* 모바일 한 페이지에 보이는 표지 수 */
var GAL_COLS = 6;       /* 데스크톱 한 줄에 나열하는 표지 수 */
var GAL = { mode: '', page: {} };

function galMode() {
  try {
    if (window.matchMedia && window.matchMedia(GAL_MQ).matches) return 'mobile';
  } catch (e) { /* 옛 브라우저 */ }
  var w = window.innerWidth || document.documentElement.clientWidth || 1024;
  return w <= 720 ? 'mobile' : 'desktop';
}

function sortDecks(list) {
  return (list || []).slice().sort(function (a, b) {
    var ta = deckIsTest(a) ? 1 : 0, tb = deckIsTest(b) ? 1 : 0;
    if (ta !== tb) return ta - tb;                          /* TEST 항목은 챕터 맨 뒤로 */
    var da = String(a.date || ''), db = String(b.date || '');
    if (da !== db) return da < db ? 1 : -1;                 /* 최신 날짜 먼저 */
    var na = Number(a.issueNo || 0), nb = Number(b.issueNo || 0);
    if (na !== nb) return nb - na;                          /* 같은 날이면 최근 호 먼저 */
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

function galPager(series, total, page) {
  var pages = Math.ceil(total / GAL_PER_PAGE);
  var nav = document.createElement('nav');
  nav.className = 'pager';
  nav.setAttribute('aria-label', chapterOf(series).label + ' 페이지');
  if (pages <= 1) { nav.hidden = true; return nav; }

  var win = 5;                                              /* 숫자는 최대 5개 */
  var start = Math.min(Math.max(page - 2, 1), Math.max(1, pages - win + 1));
  var end = Math.min(pages, start + win - 1);

  function add(label, target, cls, aria) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.setAttribute('aria-label', aria || (target + '페이지'));
    if (target === page) { b.classList.add('on'); b.setAttribute('aria-current', 'page'); }
    b.addEventListener('click', function () {
      if (GAL.page[series] === target) return;
      GAL.page[series] = target;
      renderGallery();
    });
    nav.appendChild(b);
  }

  /* 5페이지까지는 숫자만, 5를 넘으면 ‹ › « » 로 창을 넘긴다 */
  var wide = pages > win;
  if (wide && start > 1) add('«', 1, 'edge', '첫 페이지');
  if (wide && page > 1) add('‹', page - 1, 'step', '이전 페이지');
  for (var p = start; p <= end; p++) add(String(p), p, 'num', p + '페이지');
  if (wide && page < pages) add('›', page + 1, 'step', '다음 페이지');
  if (wide && end < pages) add('»', pages, 'edge', '마지막 페이지');
  return nav;
}

function galHead(c, count) {
  var head = document.createElement('div');
  head.className = 'chapterHead';
  head.innerHTML = '<h3>' + esc(c.label) + '</h3><span class="desc">' + esc(c.desc) + '</span>' +
    '<span class="rule"></span><span class="n">' + count + '</span>';
  return head;
}

function galRailNav(c) {
  var nav = document.createElement('div');
  nav.className = 'railNav';
  var prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'railBtn prev';
  prev.textContent = '‹';
  prev.setAttribute('aria-label', c.label + ' 이전 카드');
  var next = document.createElement('button');
  next.type = 'button';
  next.className = 'railBtn next';
  next.textContent = '›';
  next.setAttribute('aria-label', c.label + ' 다음 카드');
  nav.appendChild(prev);
  nav.appendChild(next);
  return nav;
}

function galWireRail(rail) {
  var track = rail.querySelector('.railTrack');
  var sec = rail.parentElement;
  var nav = sec ? sec.querySelector('.railNav') : null;   /* 화살표는 챕터 헤더에 있다 */
  if (!track || !nav) return;
  var prev = nav.querySelector('.prev'), next = nav.querySelector('.next');
  function gapPx() {
    var cs = window.getComputedStyle(track);
    var g = parseFloat(cs.columnGap || cs.gap || '');
    return isNaN(g) ? 14 : g;
  }
  function step(dir) {
    var amount = (track.clientWidth + gapPx()) * dir;
    if (track.scrollBy) track.scrollBy({ left: amount, behavior: 'smooth' });
    else track.scrollLeft += amount;
  }
  prev.addEventListener('click', function () { step(-1); });
  next.addEventListener('click', function () { step(1); });
  rail.__sync = function () {
    var max = track.scrollWidth - track.clientWidth;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= max - 2;
  };
  track.addEventListener('scroll', function () { rail.__sync(); }, { passive: true });
  rail.__sync();
}

function galSyncRails() {
  var rails = document.querySelectorAll('#sections .rail');
  for (var i = 0; i < rails.length; i++) if (rails[i].__sync) rails[i].__sync();
}

function galChapter(c, list) {
  var sec = document.createElement('section');
  sec.className = 'chapter';
  sec.setAttribute('data-series', c.series);
  var head = galHead(c, list.length);

  if (GAL.mode === 'mobile') {
    var pages = Math.ceil(list.length / GAL_PER_PAGE);
    var page = Math.min(Math.max(Number(GAL.page[c.series]) || 1, 1), pages);
    GAL.page[c.series] = page;
    var grid = document.createElement('div');
    grid.className = 'mGrid';
    list.slice((page - 1) * GAL_PER_PAGE, page * GAL_PER_PAGE)
      .forEach(function (d, i) { grid.appendChild(cardEl(d, i)); });
    sec.appendChild(head);
    sec.appendChild(grid);
    var pager = galPager(c.series, list.length, page);
    if (!pager.hidden) sec.appendChild(pager);
  } else {
    /* 6개를 넘을 때만 화살표를 달고, 넘지 않으면 숨긴다 */
    if (list.length > GAL_COLS) head.appendChild(galRailNav(c));
    var rail = document.createElement('div');
    rail.className = 'rail';
    var track = document.createElement('div');
    track.className = 'railTrack';
    track.tabIndex = 0;
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', c.label + ' 카드뉴스 ' + list.length + '건 · 좌우로 넘겨 보기');
    list.forEach(function (d, i) { track.appendChild(cardEl(d, i)); });
    rail.appendChild(track);
    sec.appendChild(head);
    sec.appendChild(rail);
  }
  return sec;
}

/* -------------------- ☰ 메뉴 · 결재/발행 상태 필터 (2026-11-27)
   상태는 manifest 의 approved · publishedAt 으로 정해진다.
     결재 대기 = !approved && !publishedAt · 업로드 대기 = approved && !publishedAt · 업로드 완료 = publishedAt
   테스트 항목(deckIsTest)은 결재·업로드 대상이 아니므로 세 상태에서 빠진다. */
function statusKeyOf(d) {
  if (!d) return 'pending';
  if (d.publishedAt) return 'done';
  if (d.approved) return 'ready';
  return 'pending';
}
function statusLabelOf(key) {
  for (var i = 0; i < STATUS_FILTERS.length; i++) if (STATUS_FILTERS[i].key === key) return STATUS_FILTERS[i].label;
  return '전체';
}
function deckPassesStatus(d) {
  if (filterStatus === 'all') return true;
  if (deckIsTest(d)) return false;
  return statusKeyOf(d) === filterStatus;
}
/* 메뉴의 숫자 = 그 항목을 눌렀을 때 보이는 건수(나머지 한쪽 필터는 그대로 둔 채) */
function statusCount(key, series) {
  var n = 0;
  (MANIFEST.decks || []).forEach(function (d) {
    if (!d) return;
    if (series && series !== 'all' && d.series !== series) return;
    if (key !== 'all') { if (deckIsTest(d)) return; if (statusKeyOf(d) !== key) return; }
    n++;
  });
  return n;
}
function chapterCount(series) {
  var n = 0;
  (MANIFEST.decks || []).forEach(function (d) {
    if (!d) return;
    if (series !== 'all' && d.series !== series) return;
    if (!deckPassesStatus(d)) return;
    n++;
  });
  return n;
}
function shownDeckCount() {
  var n = 0;
  (MANIFEST.decks || []).forEach(function (d) {
    if (!deckPassesStatus(d)) return;
    if (filterSeries !== 'all' && d.series !== filterSeries) return;
    n++;
  });
  return n;
}

/* 홈 상단의 '지금 걸린 상태 필터' 표시 + ☰ 버튼 점 */
function updateFilterNote() {
  var btn = document.getElementById('btnMenu');
  if (btn) btn.classList.toggle('on', filterStatus !== 'all');
  var el = document.getElementById('filterNote');
  if (!el) return;
  if (filterStatus === 'all') { el.hidden = true; el.innerHTML = ''; return; }
  var label = statusLabelOf(filterStatus);
  if (filterSeries !== 'all') label += ' · ' + chapterOf(filterSeries).label;
  el.hidden = false;
  el.innerHTML = '<span class="fnBadge">' + esc(label) + '</span>' +
    '<span class="fnCnt">' + shownDeckCount() + '건</span>' +
    '<button class="fnReset" type="button" id="fnReset">필터 초기화 ✕</button>';
  document.getElementById('fnReset').addEventListener('click', resetGalleryFilters);
}
function resetGalleryFilters() {
  filterStatus = 'all';
  filterSeries = 'all';
  GAL.page = {};
  renderGallery();
}
function scrollToGalleryTop() {
  var nav = document.getElementById('chapters');
  if (!nav) return;
  var top = nav.getBoundingClientRect().top + (window.pageYOffset || 0) - 56;
  if (top > 0 && (window.pageYOffset || 0) > top) {
    try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, top); }
  }
}

function renderGallery() {
  var all = MANIFEST.decks || [];
  var host = document.getElementById('chapters');
  host.innerHTML = '';
  var filters = [{ key: 'all', label: '전체', n: chapterCount('all') }].concat(CHAPTERS.map(function (c) {
    return { key: c.series, label: c.label, n: chapterCount(c.series) };
  }));
  filters.forEach(function (f) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (filterSeries === f.key ? ' on' : '');
    b.innerHTML = '<span>' + esc(f.label) + '</span><span class="cnt">' + f.n + '</span>';
    b.addEventListener('click', function () { filterSeries = f.key; renderGallery(); });
    host.appendChild(b);
  });

  var stat = document.getElementById('statDecks');
  if (stat) stat.textContent = String(all.length);

  GAL.mode = galMode();
  var sections = document.getElementById('sections');
  sections.innerHTML = '';
  var shown = 0;
  CHAPTERS.forEach(function (c) {
    if (filterSeries !== 'all' && filterSeries !== c.series) return;
    var list = sortDecks(decksOf(c.series).filter(deckPassesStatus));
    if (!list.length) return;
    shown += list.length;
    sections.appendChild(galChapter(c, list));
  });
  if (GAL.mode !== 'mobile') {
    var rails = sections.querySelectorAll('.rail');
    for (var i = 0; i < rails.length; i++) galWireRail(rails[i]);
  }
  if (!shown) {
    sections.innerHTML = (filterStatus !== 'all' || filterSeries !== 'all')
      ? '<p class="empty">이 조건에 맞는 카드뉴스가 없습니다 · <button class="link" type="button" id="emptyReset">필터 초기화</button></p>'
      : '<p class="empty">아직 올라온 카드뉴스가 없습니다 · <code>scripts/sync_to_github.py</code>로 올려 주세요.</p>';
    var er = document.getElementById('emptyReset');
    if (er) er.addEventListener('click', resetGalleryFilters);
  }
  updateFilterNote();
  galSyncRails();
}

/* 모바일 ↔ 데스크톱 전환(창 크기·회전)에서 레이아웃이 깨지지 않게 다시 그린다 */
function galWatch() {
  var onChange = function () { if (galMode() !== GAL.mode) renderGallery(); else galSyncRails(); };
  if (window.matchMedia) {
    var mq = window.matchMedia(GAL_MQ);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
}

/* -------------------- ☰ 메뉴 드로어 · 운영 안내 모달 */
var menuUI = { open: false, timer: 0 };

function menuRow(o) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'menuItem';
  b.setAttribute('aria-pressed', o.on ? 'true' : 'false');
  b.innerHTML = '<span class="mk" aria-hidden="true">✓</span><span class="nm">' + esc(o.label) + '</span>' +
    '<span class="num">' + o.num + '</span>';
  b.addEventListener('click', o.onClick);
  return b;
}
function renderMenu() {
  var st = document.getElementById('menuStatus');
  var ch = document.getElementById('menuChapter');
  if (!st || !ch) return;
  st.innerHTML = '';
  STATUS_FILTERS.forEach(function (f) {
    st.appendChild(menuRow({
      label: f.label, num: statusCount(f.key, filterSeries), on: filterStatus === f.key,
      onClick: function () { applyStatusFilter(f.key); }
    }));
  });
  ch.innerHTML = '';
  [{ key: 'all', label: '전체' }].concat(CHAPTERS.map(function (c) { return { key: c.series, label: c.label }; }))
    .forEach(function (r) {
      ch.appendChild(menuRow({
        label: r.label, num: chapterCount(r.key), on: filterSeries === r.key,
        onClick: function () { applyChapterFilter(r.key); }
      }));
    });
}
function applyStatusFilter(key) {
  filterStatus = key;
  GAL.page = {};
  closeMenu();
  renderGallery();
  scrollToGalleryTop();
}
function applyChapterFilter(key) {
  filterSeries = key;
  GAL.page = {};
  closeMenu();
  renderGallery();
  scrollToGalleryTop();
}
function openMenu() {
  renderMenu();
  var layer = document.getElementById('menuLayer');
  if (!layer) return;
  clearTimeout(menuUI.timer);
  layer.hidden = false;
  menuUI.open = true;
  document.body.classList.add('menuOpen');
  var btn = document.getElementById('btnMenu');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(function () { if (menuUI.open) layer.classList.add('on'); });
  var c = document.getElementById('menuClose');
  if (c) { try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); } }
}
function closeMenu() {
  var layer = document.getElementById('menuLayer');
  if (!layer || !menuUI.open) return;
  menuUI.open = false;
  layer.classList.remove('on');
  document.body.classList.remove('menuOpen');
  var btn = document.getElementById('btnMenu');
  if (btn) { btn.setAttribute('aria-expanded', 'false'); try { btn.focus({ preventScroll: true }); } catch (e) { } }
  clearTimeout(menuUI.timer);
  menuUI.timer = setTimeout(function () { if (!menuUI.open) layer.hidden = true; }, 220);
}
function openGuide() {
  closeMenu();
  var m = document.getElementById('guideModal');
  if (!m) return;
  m.hidden = false;
  var b = document.getElementById('guideClose');
  if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
}
function closeGuide() {
  var m = document.getElementById('guideModal');
  if (!m || m.hidden) return;
  m.hidden = true;
  var b = document.getElementById('btnMenu');
  if (b) { try { b.focus({ preventScroll: true }); } catch (e) { } }
}
function trapTab(e, root) {
  if (e.key !== 'Tab') return;
  var f = root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function wireMenu() {
  var btn = document.getElementById('btnMenu');
  var layer = document.getElementById('menuLayer');
  var panel = document.getElementById('menuDrawer');
  var closeBtn = document.getElementById('menuClose');
  var guideBtn = document.getElementById('btnGuide');
  var guide = document.getElementById('guideModal');
  if (btn) btn.addEventListener('click', function () { menuUI.open ? closeMenu() : openMenu(); });
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (layer) layer.addEventListener('click', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-menu-close')) closeMenu();
  });
  if (panel) panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    trapTab(e, panel);
  });
  if (guideBtn) guideBtn.addEventListener('click', openGuide);
  var gClose = document.getElementById('guideClose');
  if (gClose) gClose.addEventListener('click', closeGuide);
  if (guide) {
    guide.addEventListener('click', function (e) { if (e.target === guide) closeGuide(); });
    guide.addEventListener('keydown', function (e) {
      var card = guide.querySelector('.modalCard');
      if (e.key === 'Escape') { e.preventDefault(); closeGuide(); return; }
      if (card) trapTab(e, card);
    });
  }
}

function showGallery() {
  document.getElementById('viewEditor').hidden = true;
  document.getElementById('viewGallery').hidden = false;
  document.title = '뷰티 카드뉴스 허브 · but';
  updateGhChip();
}

function showEditor(id) {
  var meta = DECK[id];
  if (!meta) { location.hash = '#/'; return; }
  currentDeck = meta;
  state.presetId = id;
  document.getElementById('viewGallery').hidden = true;
  document.getElementById('viewEditor').hidden = false;
  document.getElementById('deckTitle').textContent = meta.title || meta.id;
  var bits;
  if (isBriefSeries(meta) && !deckIsTest(meta)) {
    bits = ['뷰티 브리핑'];
    if (briefDateFull(meta)) bits.push(briefDateFull(meta));
  } else { bits = [issueLabel(meta)]; bits.push(fmtDate(meta.date)); }
  document.getElementById('deckSub').textContent = bits.join(' · ');
  document.title = (meta.title || meta.id) + ' · 카드뉴스 허브';
  window.scrollTo(0, 0);
  updateGhChip();
  updateApproveBtn();
  loadDeck(id);
}

function route() {
  closeMenu();
  closeGuide();
  var m = String(location.hash || '').match(/^#\/edit\/(.+)$/);
  if (m) showEditor(decodeURIComponent(m[1]));
  else { showGallery(); renderGallery(); }
}

function wireChrome() {
  document.getElementById('btnBack').addEventListener('click', function () { location.hash = '#/'; });
  document.getElementById('btnPrev').addEventListener('click', function () { goPage(state.page - 1); });
  document.getElementById('btnNext').addEventListener('click', function () { goPage(state.page + 1); });
  document.getElementById('btnPng').addEventListener('click', exportPng);
  document.getElementById('btnPngAll').addEventListener('click', exportAllPng);
  document.getElementById('btnZip').addEventListener('click', exportAllZip);
  document.getElementById('btnJson').addEventListener('click', exportJson);
  document.getElementById('btnGhSave').addEventListener('click', ghSave);
  document.getElementById('btnApprove').addEventListener('click', approveToggle);
  document.getElementById('btnPat').addEventListener('click', function () { openPat(); });
  document.getElementById('btnPatHome').addEventListener('click', function () { openPat(); });
  ['btnPatFoot', 'btnPatLink'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', function () { openPat(); });
  });

  var stageEl = document.getElementById('stage');
  var zoomBtn = document.getElementById('btnZoom');
  zoomBtn.addEventListener('click', function () {
    var on = stageEl.classList.toggle('big');
    zoomBtn.textContent = on ? '닫기' : '크게 보기';
  });

  document.getElementById('btnReset').addEventListener('click', function () {
    if (!state.presetId) return;
    if (!confirm('수정한 내용을 버리고 GitHub에 있는 원본으로 되돌릴까요?')) return;
    lsDel(state.savedKey);
    state.dirty = false;
    markDirty(false);
    loadDeck(state.presetId, { fresh: true }).then(function () { toast('원본으로 되돌렸습니다'); });
  });

  // 결재 2차 확인 모달
  document.getElementById('cfmOk').addEventListener('click', function () { closeConfirm(true); });
  document.getElementById('cfmCancel').addEventListener('click', function () { closeConfirm(false); });
  document.getElementById('cfmModal').addEventListener('click', function (e) {
    if (e.target === this) closeConfirm(false);
  });

  // 토큰 모달
  document.getElementById('btnPatCancel').addEventListener('click', closePat);
  document.getElementById('btnPatSave').addEventListener('click', function () {
    var token = document.getElementById('patInput').value.trim();
    var stateEl = document.getElementById('patState');
    if (!token) { stateEl.className = 'patState err'; stateEl.textContent = '토큰을 넣어 주세요.'; return; }
    stateEl.className = 'patState';
    stateEl.textContent = '토큰을 확인하는 중…';
    verifyToken(token).then(function (r) {
      lsSet(LS_PAT, token);
      updateGhChip();
      if (r.canWrite) {
        stateEl.className = 'patState ok';
        stateEl.textContent = '연결됨 · @' + r.login + ' · 이 저장소에 저장 권한이 있습니다';
        toast('GitHub 연결 완료 · @' + r.login);
        setTimeout(closePat, 900);
      } else {
        stateEl.className = 'patState err';
        stateEl.textContent = '연결은 됐지만 @' + r.login + ' 계정에 이 저장소 쓰기 권한이 없습니다 · Contents: Read and write 를 켜 주세요';
      }
      markDirty(state.dirty);
    }).catch(function (err) {
      stateEl.className = 'patState err';
      stateEl.textContent = err.message;
    });
  });
  document.getElementById('btnPatForget').addEventListener('click', function () {
    lsDel(LS_PAT);
    updateGhChip();
    var stateEl = document.getElementById('patState');
    stateEl.className = 'patState';
    stateEl.textContent = '저장된 토큰을 지웠습니다. 편집·PNG 저장은 그대로 동작합니다.';
    markDirty(state.dirty);
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      closeConfirm(false);
      closePat();
      closeGuide();
      closeMenu();
      if (stageEl.classList.contains('big')) { stageEl.classList.remove('big'); zoomBtn.textContent = '크게 보기'; }
    }
    if (typing || document.getElementById('viewEditor').hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goPage(state.page - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); goPage(state.page + 1); }
  });

  window.addEventListener('hashchange', route);

  // 편집 흔적 표시
  var _commit0 = commit;
  commit = function () { _commit0(); markDirty(!!state.dirty); };
}

function boot() {
  IMGS['__logo_black__'] = 'assets/logo-black.png';
  IMGS['__logo_white__'] = 'assets/logo-white.png';
  wireChrome();
  wireMenu();
  galWatch();
  updateGhChip();
  showGallery();
  fetch('data/manifest.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' · data/manifest.json');
      return r.json();
    })
    .then(function (m) {
      MANIFEST = (m && m.decks) ? m : { decks: [] };
      indexDecks();
      renderGallery();
      route();
    })
    .catch(function (err) {
      document.getElementById('sections').innerHTML =
        '<p class="empty">카드뉴스 목록을 읽지 못했습니다 · ' + esc(err.message) +
        '<br>GitHub Pages 주소(또는 로컬 서버)로 열었는지 확인해 주세요.</p>';
      route();
    });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { _mc.clear(); requestRender(); });
  }
}

window.addEventListener('error', function (e) {
  window.__errs = window.__errs || [];
  window.__errs.push(String(e.message) + ' @' + e.lineno);
});

boot();
})();
