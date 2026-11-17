/* =============================================================================
   뷰티 카드뉴스 허브 — konghwanhee/but
   · 홈: 챕터별(뷰티 포인트 / 뷰티 테크 / 데일리 브리핑) 표지 갤러리
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
function renderCover(c, family) {
  var cov = c.cover || {};
  _ctx.fillStyle = INK; _ctx.fillRect(0, 0, W, H);
  if (family === 'brief') return coverBrief(cov);
  var tech = family === 'tech';
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
function framePoint(page) {
  drawLogo('black', MX, 74, 42);
  if (page) drawText(page, CR, 96, 25, 'bold', KEY, 'rs');
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
function headBlock(slide, firstY) {
  labelPoint(slide.label || '');
  var maxW = CR - MX;
  var size = Number(slide.head_size || 62);
  var lines = headlineLines(slide);
  while (size > 34 && headlineWidth(lines, size, 'extrabold') > maxW) size -= 2;
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
function drawRule(y, w) {
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, y, w || 64, 3);
}
function takeaway(text, height, label) {
  var h = height || 112;
  var y0 = CTM - h;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, h);
  _ctx.fillStyle = KEY; _ctx.fillRect(MX, y0, 8, h);
  var fsize = h === 104 ? 24 : 25;
  var lines = wrapText(text, fsize, 'bold', CR - MX - 76);
  var n = lines.length;
  var gap = h === 104 ? 32 : 33;
  var first = y0 + h / 2 - gap * (n - 1) / 2 + (h === 104 ? 12 : 10);
  if (label) {
    tracked(label, MX + 34, y0 + (h === 104 ? 28 : 30), 15, 'bold', KEY, 3);
    first += h === 104 ? 10 : 12;
  }
  for (var i = 0; i < n; i++) drawText(lines[i], MX + 34, first + i * gap, fsize, 'bold', WHITE, 'ls');
}

/* ---------------------------------------------------------------- 6. 뷰티 포인트 장표 */
function pTable(s, headLast) {
  var spec = s.table || {}, cols = spec.columns || [], rows = spec.rows || [];
  var ncol = cols.length || 1;
  var raw = (spec.widths && spec.widths.length) ? spec.widths : new Array(ncol).fill(1);
  var tot = raw.reduce(function (a, b) { return a + Number(b); }, 0) || 1;
  var widths = raw.map(function (w) { return Number(w) / tot * (CR - MX); });
  var keyCells = {};
  (spec.key_cells || []).forEach(function (cc) { keyCells[cc[0] + ',' + cc[1]] = true; });
  var top = headLast + Number(s.gap_after_head === undefined ? 58 : s.gap_after_head);
  drawRule(top);
  var headTop = top + 22, headH = Number(spec.head_height || 54);
  _ctx.fillStyle = INK; _ctx.fillRect(MX, headTop, CR - MX, headH);
  var fh = Number(spec.head_size || 21), x = MX;
  cols.forEach(function (c, j) {
    var align = spec.align && spec.align[j] === 'r';
    var tx = align ? x + widths[j] - 18 : x + (j ? 18 : 20);
    drawText(c, tx, headTop + headH / 2, fh, 'bold', WHITE, align ? 'rm' : 'lm');
    x += widths[j];
  });
  var listTop = headTop + headH;
  var bandH = s.takeaway ? 112 : 0;
  var avail = CTM - listTop - (bandH ? bandH + 30 : 0);
  var rowH = avail / Math.max(1, rows.length);
  var size = Number(spec.cell_size || 24);
  while (size > 17) {
    var ok = true;
    for (var r = 0; r < rows.length && ok; r++) {
      for (var j2 = 0; j2 < rows[r].length; j2++) {
        if (measure(rows[r][j2], size, 'medium') > widths[j2] - 34) { ok = false; break; }
      }
    }
    if (ok) break;
    size -= 1;
  }
  for (var i = 0; i < rows.length; i++) {
    var y0 = listTop + rowH * i, cy = y0 + rowH / 2;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1);
    var x2 = MX;
    for (var j3 = 0; j3 < rows[i].length; j3++) {
      var align2 = spec.align && spec.align[j3] === 'r';
      var tx2 = align2 ? x2 + widths[j3] - 18 : x2 + (j3 ? 18 : 20);
      var hot = keyCells[i + ',' + j3];
      var color = hot ? KEY : INK;
      var wt = hot || j3 === 0 ? 'bold' : 'medium';
      drawText(rows[i][j3], tx2, cy, size, wt, color, align2 ? 'rm' : 'lm');
      x2 += widths[j3];
    }
  }
  var endY = listTop + rowH * rows.length;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, endY, CR - MX, 2);
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT'); return CTM; }
  return endY;
}

function pCards(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 56 : s.gap_after_head);
  var cards = s.cards || [];
  var gap = 24, cw = (CR - MX - gap * (cards.length - 1)) / Math.max(1, cards.length);
  var pad = 34, bandH = s.takeaway ? 112 : 0;
  var limit = CTM - (bandH ? bandH + 34 : 0);
  var need = 0;
  cards.forEach(function (card) {
    var y = 178;
    (card.items || []).forEach(function (item) {
      var lines = wrapText(item, 21, 'medium', cw - pad * 2 - 22);
      y += 32 * lines.length + 16;
    });
    if (card.note) y += 34;
    need = Math.max(need, y);
  });
  var ch = Math.min(limit - top, need + 56);
  ch = Math.max(ch, 320);
  var slack = limit - (top + ch);
  if (slack > 60) top += Math.round(slack * 0.45);
  cards.forEach(function (card, i) {
    var x = MX + i * (cw + gap);
    var bg = (card.tone || 'ink') === 'ink' ? INK : KEY;
    _ctx.fillStyle = bg; _ctx.fillRect(x, top, cw, ch);
    var tx = x + pad;
    tracked(card.eyebrow || '', tx, top + 62, 18, 'bold', WHITE, 3);
    var title = card.title || '';
    var size = 40;
    while (measure(title, size, 'extrabold') > cw - pad * 2 && size > 28) size -= 1;
    drawText(title, tx, top + 122, size, 'extrabold', WHITE, 'ls');
    var y = top + 178;
    (card.items || []).forEach(function (item) {
      _ctx.fillStyle = WHITE; _ctx.fillRect(tx, y - 9, 10, 10);
      var lines = wrapText(item, 21, 'medium', cw - pad * 2 - 22);
      for (var k = 0; k < lines.length; k++) drawText(lines[k], tx + 22, y + k * 32, 21, 'medium', WHITE, 'ls');
      y += 32 * lines.length + 16;
    });
    if (card.note) {
      _ctx.fillStyle = WHITE; _ctx.fillRect(tx, top + ch - 74, cw - pad * 2, 2);
      drawText(card.note, tx, top + ch - 40, 19, 'bold', WHITE, 'ls');
    }
  });
  if (s.takeaway) { takeaway(s.takeaway, 112, s.takeaway_label || 'POINT'); return CTM; }
  return top + ch;
}

function pBrandPair(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 48 : s.gap_after_head);
  var images = s.images || [], n = images.length || 1, gap = 24;
  var cell = (CR - MX - gap * (n - 1)) / n;
  var ih = Number(s.image_height || 300);
  images.forEach(function (spec, i) {
    var x = MX + i * (cell + gap);
    if (spec.framed) drawContain(spec.image, x, top, cell, ih, true);
    else {
      drawContainPlain(spec.image, x, top, cell, ih);
      _ctx.fillStyle = INK; _ctx.fillRect(x, top + ih + 2, cell, 2);
    }
    if (spec.caption) drawText(spec.caption, x, top + ih + 30, 19, 'bold', INK, 'ls');
    if (spec.tag) {
      var tw = trackedW(spec.tag, 16, 'bold', 2);
      _ctx.fillStyle = KEY; _ctx.fillRect(x, top - 12, tw + 26, 32);
      tracked(spec.tag, x + 13, top + 15, 16, 'bold', WHITE, 2);
    }
  });
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
  var top = headLast + Number(s.gap_after_head === undefined ? 46 : s.gap_after_head);
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

function noteBlock(s, noteH, note, withKeyBar) {
  var ny = CTM - noteH;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, ny, CR - MX, noteH);
  if (withKeyBar) { _ctx.fillStyle = KEY; _ctx.fillRect(MX, ny, 8, noteH); }
  var lines = wrapText(note, 21, 'bold', CR - MX - 64);
  for (var i = 0; i < lines.length; i++) drawText(lines[i], MX + 32, ny + 50 + i * 30, 21, 'bold', WHITE, 'ls');
}

function pList(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 56 : s.gap_after_head);
  var items = s.items || [], note = s.note || '', noteH = 0;
  if (note) noteH = 34 + 30 * wrapText(note, 21, 'bold', CR - MX - 64).length + 28;
  var avail = CTM - noteH - 20 - top;
  var step = avail / Math.max(1, items.length);
  items.forEach(function (item, i) {
    var y = top + step * i;
    drawText(pad2(i + 1), MX, y + 44, 40, 'extrabold', KEY, 'ls');
    drawText(item.title, MX + 88, y + 30, 27, 'bold', INK, 'ls');
    var lines = wrapText(item.body || '', 21, 'regular', CR - MX - 88);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], MX + 88, y + 70 + k * 31, 21, 'regular', INK, 'ls');
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y + step - 26, CR - MX, 1);
  });
  if (note) noteBlock(s, noteH, note, false);
  return CTM;
}

function pReasons(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 52 : s.gap_after_head);
  var items = s.items || [], note = s.note || '', noteH = 0;
  if (note) noteH = 34 + 30 * wrapText(note, 21, 'bold', CR - MX - 64).length + 28;
  var avail = CTM - noteH - 18 - top;
  var step = avail / Math.max(1, items.length);
  var numX = MX + 28, colX = MX + 132;
  items.forEach(function (item, i) {
    var y = top + step * i;
    var barH = Math.min(step - 34, 132);
    _ctx.fillStyle = KEY; _ctx.fillRect(MX, y + 4, 7, barH);
    drawText(pad2(i + 1), numX, y + 60, 50, 'extrabold', KEY, 'ls');
    drawText(item.title, colX, y + 38, 31, 'bold', INK, 'ls');
    var lines = wrapText(item.body || '', 21, 'regular', CR - colX);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], colX, y + 82 + k * 31, 21, 'regular', INK, 'ls');
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y + step - 22, CR - MX, 1);
  });
  if (note) noteBlock(s, noteH, note, true);
  return CTM;
}

function pBars(s, headLast) {
  var spec = s.chart || {}, items = spec.items || [];
  var top = headLast + Number(s.gap_after_head === undefined ? 44 : s.gap_after_head);
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
  var top = headLast + Number(s.gap_after_head === undefined ? 40 : s.gap_after_head);
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
    drawText(s.lead, MX, headLast + 44, Number(s.lead_size || 21), 'medium', INK, 'ls');
    top = headLast + 44 + 26;
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

function tSplit(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 40 : s.gap_after_head);
  var spec = s.image || {};
  var iw = Number(s.image_width || 430), ih = Number(s.image_height || 470);
  var ix = s.bleed_left ? 0 : MX;
  bandPhoto(spec, ix, top, iw + (MX - ix), ih, Number(spec.zoom || 1), Number(spec.focus_y === undefined ? 0.5 : spec.focus_y));
  iw = iw + (MX - ix);
  if (s.frame) {
    _ctx.strokeStyle = INK; _ctx.lineWidth = 1; _ctx.strokeRect(ix + 0.5, top + 0.5, iw - 1, ih - 1);
  }
  var colX = MX + iw + 48, colW = CR - colX, y = top;
  var limit = CTM - (s.takeaway ? 120 : 0);
  (s.blocks || []).forEach(function (block) {
    tracked(block.label || '', colX, y + 14, 17, 'bold', KEY, 3);
    var size = Number(block.size || 21);
    var lines = wrapText(block.text || '', size, 'medium', colW);
    var gap = Math.round(size * 1.52);
    for (var k = 0; k < lines.length; k++) drawText(lines[k], colX, y + 52 + k * gap, size, 'medium', INK, 'ls');
    y = y + 52 + gap * lines.length + Number(s.block_gap === undefined ? 34 : s.block_gap);
  });
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tTable(s, headLast) {
  var spec = s.table || {}, cols = spec.columns || [], rows = spec.rows || [];
  var top = headLast + Number(s.gap_after_head === undefined ? 44 : s.gap_after_head);
  if (s.body) top = bodyTextTech(s.body, top + 10, s.body_size || 22) + 34;
  var ncol = cols.length || 1;
  var raw = (spec.widths && spec.widths.length) ? spec.widths : new Array(ncol).fill(1);
  var tot = raw.reduce(function (a, b) { return a + Number(b); }, 0) || 1;
  var widths = raw.map(function (w) { return Number(w) / tot * (CR - MX); });
  var keyCells = {};
  (spec.key_cells || []).forEach(function (cc) { keyCells[cc[0] + ',' + cc[1]] = true; });
  var headH = Number(spec.head_height || 52);
  var note = s.note || '';
  var noteLines = note ? wrapText(note, 18, 'medium', CR - MX) : [];
  var noteH = noteLines.length ? 34 + 27 * noteLines.length : 0;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, top, CR - MX, headH);
  var fh = Number(spec.head_size || 20), x = MX;
  cols.forEach(function (c, j) {
    drawText(c, x + 20, top + headH / 2, fh, 'bold', WHITE, 'lm');
    x += widths[j];
  });
  var listTop = top + headH;
  var bandH = s.takeaway ? 138 : 0;
  var avail = CTM - listTop - bandH - noteH - 12;
  var rowH = Math.min(Number(spec.row_height || 152), avail / Math.max(1, rows.length));
  var size = Number(spec.cell_size || 22);
  while (size > 15) {
    var ok = true;
    for (var r = 0; r < rows.length && ok; r++) {
      for (var j2 = 0; j2 < rows[r].length; j2++) {
        var parts = String(rows[r][j2]).split('\n');
        for (var p = 0; p < parts.length; p++) if (measure(parts[p], size, 'medium') > widths[j2] - 32) { ok = false; break; }
        if (!ok) break;
      }
    }
    if (ok) break;
    size -= 1;
  }
  var lead = Math.round(size * 1.32);
  for (var i = 0; i < rows.length; i++) {
    var y0 = listTop + rowH * i, cy = y0 + rowH / 2;
    _ctx.fillStyle = INK; _ctx.fillRect(MX, y0, CR - MX, 1);
    var x3 = MX;
    for (var j3 = 0; j3 < rows[i].length; j3++) {
      var hot = keyCells[i + ',' + j3];
      var cellLines = String(rows[i][j3]).split('\n');
      var ty = cy - lead * (cellLines.length - 1) / 2;
      for (var k = 0; k < cellLines.length; k++) {
        drawText(cellLines[k], x3 + 20, ty + k * lead, size, (hot || j3 === 0) ? 'bold' : 'medium', hot ? KEY : INK, 'lm');
      }
      x3 += widths[j3];
    }
  }
  var endY = listTop + rowH * rows.length;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, endY, CR - MX, 2);
  if (noteLines.length) {
    for (var k2 = 0; k2 < noteLines.length; k2++) drawText(noteLines[k2], MX, endY + 34 + k2 * 27, 18, 'medium', INK, 'ls');
  }
  if (s.takeaway) { takeaway(s.takeaway, 104, s.takeaway_label || 'POINT'); return CTM; }
  return CTM;
}

function tCompare(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 46 : s.gap_after_head);
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
  var top = headLast + Number(s.gap_after_head === undefined ? 30 : s.gap_after_head);
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
  var items = s.items || [], gap = 40;
  var cw = (CR - MX - gap * (items.length - 1)) / Math.max(1, items.length);
  var ih = Number(s.image_height || 300);
  var limit = CTM - (s.takeaway ? 120 : 0);
  var creditLines = 0;
  items.forEach(function (it) { if (it.credit) creditLines = Math.max(creditLines, wrapText(it.credit, 16, 'medium', cw).length); });
  var creditBase = creditLines ? limit - 20 - 22 * (creditLines - 1) : null;
  items.forEach(function (it, i) {
    var x = MX + i * (cw + gap);
    if (it.tag) {
      var tw = trackedW(it.tag, 15, 'bold', 2);
      _ctx.fillStyle = KEY; _ctx.fillRect(x, top, tw + 28, 32);
      tracked(it.tag, x + 14, top + 21, 15, 'bold', WHITE, 2);
    }
    var im = getImage(it.image);
    if (imgOk(im)) {
      var r = Math.min(cw / im.naturalWidth, ih / im.naturalHeight);
      var nw = im.naturalWidth * r, nh = im.naturalHeight * r;
      _ctx.drawImage(im, x + (cw - nw) / 2, top + 40 + (ih - nh), nw, nh);
    } else placeholder(it.image, x, top + 40, cw, ih);
    _ctx.fillStyle = INK; _ctx.fillRect(x, top + 40 + ih + 2, cw, 1);
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
  var top = headLast + Number(s.gap_after_head === undefined ? 44 : s.gap_after_head);
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
  var top = headLast + Number(s.gap_after_head === undefined ? 52 : s.gap_after_head);
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

function tLineage(s, headLast) {
  var top = headLast + Number(s.gap_after_head === undefined ? 46 : s.gap_after_head);
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

/* ---------------------------------------------------------------- 8. 데일리 브리핑 */
function frameBrief(page, progress) {
  drawLogo('black', MX, 78, 44);
  if (page) drawText(page, CR, 96, 25, 'medium', GRAY_SOFT, 'rs');
  if (progress) {
    var cur = progress[0], tot = Math.max(1, progress[1]);
    _ctx.fillStyle = HAIRLINE; _ctx.fillRect(0, BARY, W, 6);
    _ctx.fillStyle = '#1A1A1A'; _ctx.fillRect(0, BARY, W * cur / tot, 6);
  }
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
function renderIndex(c) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  var cfg = c.index || {};
  drawLogo('black', MX, 78, 44);
  var rows = indexRows(c), n = rows.length;
  var headline = (cfg.headline || '오늘의 뷰티 {n}').replace('{n}', String(n));
  var hs = 66;
  while (hs > 44 && measure(headline, hs, 'extrabold') > W - MX * 2) hs -= 1;
  var headBase = 250;
  drawText(headline, MX, headBase, hs, 'extrabold', INK, 'ls');
  var cols = (cfg.columns && cfg.columns.length ? cfg.columns : ['NO.', '분야', '제목', '핵심 수치']);
  var NUM_X = MX, CAT_X = MX + 58, TITLE_X = MX + 214, RIGHT = CR;
  var headY = headBase + 58;
  tracked(cols[0], NUM_X, headY, 14, 'bold', '#B0B0B0', 2);
  tracked(cols[1], CAT_X, headY, 14, 'bold', '#B0B0B0', 2);
  tracked(cols[2], TITLE_X, headY, 14, 'bold', '#B0B0B0', 2);
  var cw = trackedW(cols[3], 14, 'bold', 2);
  tracked(cols[3], RIGHT - cw, headY, 14, 'bold', '#B0B0B0', 2);
  var listTop = headY + 20, listBottom = 1204;
  _ctx.fillStyle = INK; _ctx.fillRect(MX, listTop, CR - MX, 1);
  if (!n) return;
  var rowH = (listBottom - listTop) / n;
  var numSz = clampNum(rowH * 0.34, 12, 20), catSz = clampNum(rowH * 0.29, 10, 15);
  var figSz = clampNum(rowH * 0.33, 11, 19), titleCap = clampNum(rowH * 0.40, 12, 23);
  var titleSz = Math.round(titleCap);
  while (titleSz > 11) {
    var fits = true;
    for (var i = 0; i < rows.length; i++) {
      var figW = rows[i].figure ? measure(rows[i].figure, figSz, 'bold') + 30 : 0;
      if (measure(rows[i].title, titleSz, 'bold') > RIGHT - TITLE_X - figW) { fits = false; break; }
      if (rows[i].cat && measure(rows[i].cat, catSz, 'bold') > TITLE_X - CAT_X - 12) { fits = false; break; }
    }
    if (fits) break;
    titleSz -= 1;
  }
  rows.forEach(function (r, i) {
    var top = listTop + rowH * i, cy = top + rowH / 2;
    drawText(r.num, NUM_X, cy, Math.round(numSz), 'bold', '#8E8E8E', 'lm');
    if (r.cat) drawText(r.cat, CAT_X, cy, Math.round(catSz), 'bold', GRAY_SOFT, 'lm');
    drawText(r.title, TITLE_X, cy, titleSz, 'bold', INK, 'lm');
    if (r.figure) drawText(r.figure, RIGHT, cy, Math.round(figSz), 'bold', '#1A1A1A', 'rm');
    if (i < n - 1) { _ctx.fillStyle = '#ECECEC'; _ctx.fillRect(MX, top + rowH - 1, CR - MX, 1); }
  });
  _ctx.fillStyle = INK; _ctx.fillRect(MX, listBottom, CR - MX, 1);
  var footer = cfg.footer === undefined ? '원문 출처는 각 페이지 하단 표기' : cfg.footer;
  if (footer) drawText(footer, MX, listBottom + 42, 20, 'regular', '#A8A8A8', 'ls');
}

function chartTitle(spec, box) {
  var title = spec.title;
  if (!title) return box.y;
  drawText(title, box.x, box.y + 14, 20, 'bold', GRAY_SOFT, 'ls');
  return box.y + 48;
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
function chartTable(spec, box) {
  var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
  var top = chartTitle(spec, box);
  var cols = spec.columns || [], rows = spec.rows || [];
  var align = spec.align || [];
  var widths = spec.widths;
  if (!widths) widths = new Array(cols.length).fill(w / Math.max(1, cols.length));
  else { var s = widths.reduce(function (a, b) { return a + Number(b); }, 0) || 1; widths = widths.map(function (ww) { return Number(ww) / s * w; }); }
  var n = rows.length, headH = 68;
  var avail = y0 + h - top - headH - 24;
  var rowH = avail / Math.max(1, n);
  if (spec.row_height) rowH = Math.min(spec.row_height, rowH);
  var headBase = top + 30, x = x0;
  cols.forEach(function (c, j) {
    var right = align[j] === 'r';
    drawText(c, right ? x + widths[j] : x, headBase, 20, 'bold', '#8F8F8F', right ? 'rs' : 'ls');
    x += widths[j];
  });
  _ctx.fillStyle = INK; _ctx.fillRect(x0, top + headH - 10, w, 1);
  var cellSize = spec.cell_size || 25;
  rows.forEach(function (row, i) {
    var yb = top + headH + rowH * i + rowH - 14, xx = x0;
    for (var j = 0; j < cols.length; j++) {
      var right = align[j] === 'r';
      drawText(row[j] === undefined ? '' : row[j], right ? xx + widths[j] : xx, yb, cellSize, j === 0 ? 'bold' : 'regular', j === 0 ? INK : GRAY_BODY, right ? 'rs' : 'ls');
      xx += widths[j];
    }
    if (i < n - 1) { _ctx.fillStyle = '#EDEDED'; _ctx.fillRect(x0, yb + 16, w, 1); }
  });
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
var CHARTS = { bar_v: chartBarV, bar_h: chartBarH, table: chartTable, timeline: chartTimeline };

function briefSlide(s, idx, total) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
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
  var ruleY = hLast + 52, bFirst = ruleY + 62;
  if (media) bFirst = Math.max(bFirst, media.y + media.h + 54);
  var bodyText = s.body || '', chart = s.chart;
  var reserve = media ? 240 : 260;
  var bodyMaxW = W - MX * 2 - 4;
  var cand = [[Number(s.body_size || 29), null], [28, 43], [27, 41], [26, 39], [25, 37]];
  var picked = null;
  for (var i = 0; i < cand.length; i++) {
    var bs = cand[i][0], bgap = cand[i][1] || Math.round(bs * 1.55);
    var bLines = wrapText(bodyText, bs, 'regular', bodyMaxW);
    var bLast = bFirst + bgap * Math.max(0, bLines.length - 1);
    var chartTop = bLast + 50, chartH = 1178 - chartTop;
    picked = { bs: bs, bgap: bgap, lines: bLines, bLast: bLast, chartTop: chartTop, chartH: chartH, bFirst: bFirst, ruleY: ruleY, hsize: hsize, hgap: hgap, hFirst: hFirst };
    if (!chart || chartH >= reserve) break;
  }
  var L = picked;
  if (s.brand_logo) {
    var bl = s.brand_logo, im = getImage(bl.image);
    if (imgOk(im)) {
      var lh = Number(bl.height || 24), lw = im.naturalWidth * lh / im.naturalHeight;
      _ctx.drawImage(im, CR - lw, 206 + 4, lw, lh);
    }
  }
  if (media) {
    drawRoundedPhoto(media.spec.image, media.x, media.y, media.w, media.h, Number(media.spec.focus || 0.5), 6);
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
  var ruleW = media ? Math.min(88, maxW) : 88;
  _ctx.fillStyle = '#D5D5D5'; _ctx.fillRect(MX, L.ruleY, Math.max(40, ruleW), 2);
  for (var j = 0; j < L.lines.length; j++) drawText(L.lines[j], MX, L.bFirst + j * L.bgap, L.bs, 'regular', GRAY_BODY, 'ls');
  if (chart) {
    var fn = CHARTS[chart.type || 'table'];
    if (fn) fn(chart, { x: MX, y: L.chartTop, w: W - MX * 2, h: L.chartH });
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

/* ---------------------------------------------------------------- 9. 장표 렌더 */
var POINT_KINDS = { table: pTable, cards: pCards, brand_pair: pBrandPair, brand_wide: pBrandWide, list: pList, reasons: pReasons, bars: pBars };
var TECH_KINDS = { points: tPoints, band: tBand, split: tSplit, table: tTable, compare: tCompare, products: tProducts, quad: tQuad, steps: tSteps, lineage: tLineage };

function renderSlidePage(s, idx, total, family) {
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  if (family === 'brief') return briefSlide(s, idx, total);
  var head = family === 'tech' ? headBlockTech(s) : headBlock(s);
  var kind = s.kind || 'table';
  var fn = family === 'tech' ? TECH_KINDS[kind] : POINT_KINDS[kind];
  if (!fn) fn = family === 'tech' ? TECH_KINDS.table : POINT_KINDS.table;
  var bodyFirst = head.last + 56;
  if (s.body && kind !== 'bars' && !(family === 'tech' && ['points', 'table', 'compare', 'quad', 'steps', 'lineage'].indexOf(kind) >= 0)) {
    head.last = bodyBlock(s, bodyFirst, s.body_size || 24);
  }
  fn(s, head.last);
  drawSource(s.source || '');
  progressPoint(idx, total);
  framePoint(idx + '/' + total);
}

function renderPage(page) {
  if (!D) return;   // 카드뉴스를 아직 불러오지 않은 상태(갤러리 화면)에서의 호출 방지
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, W, H);
  _ctx.fillStyle = WHITE; _ctx.fillRect(0, 0, W, H);
  KEY = (D && D.key_color) || '#1E4ED8';
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
  if (d && d.index) return 'brief';
  var tech = ['points', 'band', 'split', 'compare', 'quad', 'products', 'steps', 'lineage'];
  var kinds = ((d && d.slides) || []).map(function (s) { return s.kind; });
  for (var i = 0; i < kinds.length; i++) if (tech.indexOf(kinds[i]) >= 0) return 'tech';
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
  return (p.i + 1) + '/' + (D.slides || []).length + (lab ? ' · ' + lab : '');
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
  { series: 'point', label: '뷰티 포인트', short: 'POINT', desc: '주기 정보 카드뉴스 · 성분 · 제품 · 트렌드' },
  { series: 'tech', label: '뷰티 테크', short: 'TECH', desc: '작용기전과 제품 비교' },
  { series: 'briefing', label: '데일리 브리핑', short: 'BRIEF', desc: '매일 18:00 뉴스 캐러셀' }
];
var filterSeries = 'all';
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
  return { series: series, label: series, short: String(series || '').toUpperCase(), desc: '' };
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
          if (sd && (sd.cover || sd.slides)) { D = sd; state.family = familyOf(D); restored = true; state.dirty = true; }
        } catch (e) { }
      }
      buildPages();
      buildTabs();
      buildPanel();
      requestRender();
      updateStageHead();
      markDirty(state.dirty);
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
function ghSave() {
  var token = lsGet(LS_PAT);
  if (!token) { openPat('GitHub에 저장하려면 먼저 토큰을 연결해 주세요.'); return; }
  if (!D || !state.presetId) return;
  var id = state.presetId;
  var btn = document.getElementById('btnGhSave');
  btn.disabled = true;
  toast('GitHub에 저장하는 중…');
  var path = 'data/' + id + '.json';
  var title = (DECK[id] && DECK[id].title) || id;
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
      return touchManifest(id, token).catch(function () { return null; });
    })
    .catch(function (err) {
      toast('GitHub 저장 실패 · ' + err.message);
    })
    .then(function () { btn.disabled = false; });
}
function touchManifest(id, token) {
  return ghRead('data/manifest.json', token).then(function (cur) {
    if (!cur) return null;
    var json;
    try {
      var raw = cur.content ? atob(cur.content.replace(/\s/g, '')) : '';
      json = JSON.parse(decodeURIComponent(escape(raw)));
    } catch (e) { return null; }
    var stamp = new Date().toISOString();
    (json.decks || []).forEach(function (d) { if (d.id === id) d.updatedAt = stamp; });
    json.generatedAt = stamp;
    if (DECK[id]) { DECK[id].updatedAt = stamp; (MANIFEST.decks || []).forEach(function (d) { if (d.id === id) d.updatedAt = stamp; }); }
    return ghWrite('data/manifest.json', JSON.stringify(json, null, 2) + '\n',
      '카드뉴스 목록 갱신: ' + id, token, cur.sha);
  });
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
  var token = lsGet(LS_PAT);
  var chips = [document.getElementById('ghChipHome')];
  var labels = [document.getElementById('btnPat'), document.getElementById('btnPatHome')];
  chips.forEach(function (chip) {
    if (!chip) return;
    if (token) { chip.hidden = false; chip.className = 'ghChip'; chip.textContent = 'GitHub 연결됨'; }
    else { chip.hidden = true; }
  });
  labels.forEach(function (b) { if (b) b.textContent = token ? 'GitHub 연결' : 'GitHub 연결'; });
}

/* ---------------------------------------------------------------- 11. 탭 */
function buildTabs() {
  var nav = document.getElementById('tabs');
  nav.innerHTML = '';
  state.pages.forEach(function (p, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (i === state.page ? ' on' : '');
    var num = p.type === 'cover' ? '표지' : p.type === 'index' ? '요약' : pad2(p.i + 1);
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
function textField(path, label, rows, hint) {
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
  ta.addEventListener('input', function () { setPath(path, ta.value); autoGrow(ta); commit(); });
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
      var inp = document.createElement('input');
      inp.type = 'text'; inp.value = c === undefined || c === null ? '' : String(c);
      inp.addEventListener('input', function () {
        var a = getPath(colsPath) || []; a[j] = inp.value; setPath(colsPath, a); commit();
      });
      th.appendChild(inp); thead.appendChild(th);
    });
    tbl.appendChild(thead);
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      cols.forEach(function (c, j) {
        var td = document.createElement('td');
        var inp = document.createElement('input');
        inp.type = 'text'; inp.value = row[j] === undefined || row[j] === null ? '' : String(row[j]);
        inp.addEventListener('input', function () {
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
function renderNodes(nodes, basePath, container) {
  nodes.forEach(function (nd) {
    if (nd.t === 'text') container.appendChild(textField(nodePath(nd, basePath), nd.label, nd.rows, nd.hint));
    else if (nd.t === 'lines') container.appendChild(headlineField(nodePath(nd, basePath), nd.label));
    else if (nd.t === 'strarr') container.appendChild(strArrField(nodePath(nd, basePath), nd.label, nd.hint));
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
        renderNodes(nd.nodes || [], arrPath.concat([i]), box2);
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

function group(title, nodes, cnt) {
  return { title: title, nodes: nodes, cnt: cnt };
}

function coverSpec() {
  var g = [];
  var nodes = [{ t: 'lines', path: ['headline'], label: '표지 헤드라인' }];
  nodes.push({ t: 'text', path: ['kicker'], label: '킥커 (작은 라벨)', rows: 1 });
  nodes.push({ t: 'text', path: ['sub'], label: '서브 문구', rows: 2 });
  if (D.cover && D.cover.badge !== undefined) nodes.push({ t: 'text', path: ['badge'], label: '배지', rows: 1 });
  g.push(group('표지 문구', nodes));
  return g;
}
function indexSpec() {
  var g = [];
  var n = (D.slides || []).length;
  g.push(group('요약 장표', [
    { t: 'text', path: ['headline'], label: '제목', rows: 1, hint: '{n} = ' + n },
    { t: 'strarr', path: ['columns'], label: '열 머리글' },
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
  if (s.body !== undefined) base.push({ t: 'text', path: ['body'], label: '본문', rows: 3 });

  function push(o) { mid.push(o); }
  if (fam === 'brief') {
    push({ t: 'text', path: ['index_title'], label: '요약 장표 제목', rows: 1 });
    push({ t: 'text', path: ['index_figure'], label: '요약 장표 핵심 수치', rows: 1 });
    var ch = s.chart || {};
    if (ch.type === 'table' || !ch.type) {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'table', colsPath: ['chart', 'columns'], rowsPath: ['chart', 'rows'], label: '칸 고치기', hint: '칸을 누르면 바로 반영' });
    } else if (ch.type === 'bar_v') {
      push({ t: 'text', path: ['chart', 'title'], label: '도표 제목', rows: 1 });
      push({ t: 'strarr', path: ['chart', 'labels'], label: '항목 이름' });
      push({ t: 'strarr', path: ['chart', 'display'], label: '표시 값' });
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
      push({ t: 'arr', path: ['blocks'], kicker: '블록', titleFn: function (it) { return it.label || '블록'; }, nodes: [{ t: 'text', path: ['label'], label: '소제목', rows: 1 }, { t: 'text', path: ['text'], label: '본문', rows: 3 }] });
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
    } else if (kind === 'lineage') {
      push({ t: 'arr', path: ['rows'], kicker: '단계', titleFn: function (it) { return it.name || ''; }, nodes: [{ t: 'text', path: ['num'], label: '번호', rows: 1 }, { t: 'text', path: ['name'], label: '이름', rows: 1 }, { t: 'text', path: ['sub'], label: '부제', rows: 1 }, { t: 'text', path: ['tag'], label: '태그', rows: 1 }] });
      if (s.note !== undefined) push({ t: 'text', path: ['note'], label: '노트', rows: 2 });
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
    compare: '비교 패널', products: '제품', quad: '4칸 카드', steps: '단계', lineage: '계보', brief: '도표'
  };
  return names[kind] || '내용';
}

function buildPanel() {
  var body = document.getElementById('panelBody');
  body.innerHTML = '';
  var page = state.pages[state.page];
  if (!page) return;
  var basePath = page.type === 'cover' ? ['cover'] : page.type === 'index' ? ['index'] : ['slides', page.i];
  var specs = page.type === 'cover' ? coverSpec() : page.type === 'index' ? indexSpec() : slideSpec(D.slides[page.i] || {}, page.i);
  specs.forEach(function (g, gi) {
    var det = document.createElement('details');
    det.className = 'grp';
    if (gi < 2) det.open = true;
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
  b.className = 'card';
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
  issue.className = 'issue';
  issue.textContent = ch.short + (d.issueNo ? ' ' + pad2(d.issueNo) : '');
  cover.appendChild(issue);
  b.appendChild(cover);

  var body = document.createElement('div');
  body.className = 'cardBody';
  var kick = document.createElement('div');
  kick.className = 'cardKicker';
  kick.innerHTML = '<span class="dot"></span>' + esc(d.seriesLabel || ch.label) +
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

function renderGallery() {
  var all = MANIFEST.decks || [];
  var host = document.getElementById('chapters');
  host.innerHTML = '';
  var filters = [{ key: 'all', label: '전체', n: all.length }].concat(CHAPTERS.map(function (c) {
    return { key: c.series, label: c.label, n: decksOf(c.series).length };
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

  var sections = document.getElementById('sections');
  sections.innerHTML = '';
  var shown = 0;
  CHAPTERS.forEach(function (c) {
    if (filterSeries !== 'all' && filterSeries !== c.series) return;
    var list = decksOf(c.series);
    if (!list.length) return;
    shown += list.length;
    var sec = document.createElement('section');
    sec.className = 'chapter';
    var head = document.createElement('div');
    head.className = 'chapterHead';
    head.innerHTML = '<h3>' + esc(c.label) + '</h3><span class="desc">' + esc(c.desc) + '</span>' +
      '<span class="rule"></span><span class="n">' + list.length + ' · ' + esc(dateRange(list)) + '</span>';
    sec.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'grid';
    list.forEach(function (d, i) { grid.appendChild(cardEl(d, i)); });
    sec.appendChild(grid);
    sections.appendChild(sec);
  });
  if (!shown) {
    sections.innerHTML = '<p class="empty">아직 올라온 카드뉴스가 없습니다 · <code>scripts/sync_to_github.py</code>로 올려 주세요.</p>';
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
  document.getElementById('viewGallery').hidden = true;
  document.getElementById('viewEditor').hidden = false;
  document.getElementById('deckTitle').textContent = meta.title || meta.id;
  var bits = [meta.seriesLabel || chapterOf(meta.series).label];
  if (meta.issueNo) bits.push(pad2(meta.issueNo) + '호');
  bits.push(fmtDate(meta.date));
  document.getElementById('deckSub').textContent = bits.join(' · ');
  document.title = (meta.title || meta.id) + ' · 카드뉴스 허브';
  window.scrollTo(0, 0);
  updateGhChip();
  loadDeck(id);
}

function route() {
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
  document.getElementById('btnPat').addEventListener('click', function () { openPat(); });
  document.getElementById('btnPatHome').addEventListener('click', function () { openPat(); });

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
      closePat();
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
