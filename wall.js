// tools/card-link/wall.js —— 把卡上的两张"脸"在网页上重画一遍。
//
// 卡片**不传图**,只传种子(2 字节)、状态、合章号。理由是:
//   · 传图要 36 字节/张,16 张就是 576 字节,而 BLE 一次只有 20 字节;
//   · 更要命的是**缩放**:卡上是 96×96 的 I4 画布,网页上是 72×72 的 DOM 格子,
//     一旦走图片路线,两边的颜色和边缘就会不一样——"卡上是这个人、手机上是那个人"。
//
// 所以这里是 main/card_avatar.c、main/card_sigil.c 的逐行翻译。
// 两份算法都由 `node tools/card-link/wall_test.mjs` 与 C 的输出逐格比对
// (基准向量由 tools/card-link/gen_wall_vectors.c 从固件同一份源码生成)。
// 名字不在这里算:它只由对方发过来,收不到就显示"（未署名）"。
(function (root) {
  'use strict';

  var W = 12, H = 12;
  var PAPER = 0, INK = 1, RED = 2, TEAL = 3;

  function xs(s) {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s >>> 0;
  }

  function put(out, x, y, v) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    out[y * W + x] = v;
  }

  // ---- 头像:2 字节种子 → 144 个调色板索引 ----
  function avatar(seed) {
    var out = new Uint8Array(W * H);
    var s = seed ? (seed >>> 0) : 0x9E3779B9;
    var r = xs(s);

    var body = (r & 0x01) ? TEAL : RED;
    var accColor = (body === RED) ? TEAL : RED;
    var ears = (r & 0x04) !== 0;
    var blush = (r & 0x10) !== 0;
    var acc = (r >>> 5) & 0x03;

    for (var y = 3; y <= 10; y++) {
      for (var x = 2; x <= 9; x++) put(out, x, y, body);
    }
    put(out, 2, 3, PAPER);
    put(out, 9, 3, PAPER);
    put(out, 2, 10, PAPER);
    put(out, 9, 10, PAPER);

    for (var fx = 3; fx <= 8; fx++) put(out, fx, 3, INK);
    put(out, 2, 4, INK);
    put(out, 9, 4, INK);

    if (ears) {
      put(out, 1, 6, body);
      put(out, 10, 6, body);
    }

    for (var ex = 3; ex <= 7; ex += 4) {
      put(out, ex, 5, INK);
      put(out, ex + 1, 5, INK);
      put(out, ex, 6, INK);
      put(out, ex + 1, 6, INK);
      put(out, ex === 3 ? ex : ex + 1, 5, PAPER);
    }

    if (blush) {
      put(out, 3, 7, RED);
      put(out, 8, 7, RED);
    }

    put(out, 4, 8, INK);
    put(out, 7, 8, INK);
    put(out, 5, 9, INK);
    put(out, 6, 9, INK);

    switch (acc) {
    case 1:
      put(out, 5, 2, INK);
      put(out, 6, 2, INK);
      break;
    case 2:
      put(out, 5, 1, accColor);
      put(out, 6, 1, accColor);
      put(out, 4, 2, accColor);
      put(out, 7, 2, accColor);
      break;
    case 3:
      put(out, 4, 1, accColor);
      put(out, 7, 1, accColor);
      put(out, 4, 2, INK);
      put(out, 7, 2, INK);
      break;
    default:
      break;
    }
    return out;
  }

  // 状态装饰:只动眉眼和头顶,和 card_avatar_decorate() 逐格一致。
  function decorate(out, status) {
    var body = out[5 * W + 2];
    var ex;
    switch (status & 7) {
    case 0:   // 学习:眯眼
      for (ex = 3; ex <= 7; ex += 4) {
        put(out, ex, 5, body);
        put(out, ex + 1, 5, body);
      }
      break;
    case 1:   // 空闲:不装饰
      break;
    case 2:   // 别理我:眯眼 + 平嘴
      for (ex = 3; ex <= 7; ex += 4) {
        put(out, ex, 5, body);
        put(out, ex + 1, 5, body);
      }
      put(out, 4, 8, body);
      put(out, 7, 8, body);
      break;
    case 3:   // 求组队:头顶红加号
      for (var y = 0; y <= 2; y++) {
        for (var x = 3; x <= 8; x++) put(out, x, y, PAPER);
      }
      put(out, 5, 0, RED);
      put(out, 6, 0, RED);
      for (var xx = 4; xx <= 7; xx++) put(out, xx, 1, RED);
      put(out, 5, 2, RED);
      put(out, 6, 2, RED);
      break;
    case 4:   // 吃饭:张嘴
      put(out, 4, 8, body);
      put(out, 7, 8, body);
      put(out, 5, 8, INK);
      put(out, 6, 8, INK);
      break;
    case 5:   // 运动:一滴汗
      put(out, 10, 4, INK);
      put(out, 10, 5, INK);
      break;
    case 6:   // 赶作业:三道焦躁线
      for (var yy = 0; yy <= 2; yy++) {
        for (var xxx = 3; xxx <= 8; xxx++) put(out, xxx, yy, PAPER);
      }
      put(out, 4, 1, INK);
      put(out, 6, 1, INK);
      put(out, 8, 1, INK);
      break;
    case 7:   // 摸鱼:眨一只眼
      put(out, 7, 5, body);
      put(out, 8, 5, body);
      break;
    }
    return out;
  }

  function avatarSt(seed, status) {
    return decorate(avatar(seed), status);
  }

  // ---- 合章:0..23 → 5×5 对称点阵 ----
  function mix32(x) {
    x = x >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x >>> 0;
  }

  var EMBLEM_COUNT = 24;
  var SIG = 5;

  function sigil(emblem) {
    var out = new Uint8Array(SIG * SIG);
    var r = mix32((Math.imul(emblem % EMBLEM_COUNT, 2654435761 >>> 0) + 0x9E3779B9) >>> 0);

    for (var y = 0; y < SIG; y++) {
      for (var x = 0; x < 3; x++) {
        r = mix32((r + 0x9E3779B9) >>> 0);
        var on = (((r >>> 8) % 100) < 45) ? 1 : 0;
        out[y * SIG + x] = on;
        out[y * SIG + (SIG - 1 - x)] = on;
      }
    }

    var ink = 0;
    for (var i = 0; i < SIG * SIG; i++) ink += out[i];

    var kFill = [12, 7, 17, 2, 22];
    var kClear = [0, 4, 20, 24];
    if (ink < 6) {
      for (var f = 0; f < kFill.length; f++) out[kFill[f]] = 1;
    } else if (ink > 20) {
      for (var c = 0; c < kClear.length; c++) {
        out[kClear[c]] = 0;
        out[SIG * SIG - 1 - kClear[c]] = 0;
      }
    }
    return out;
  }

  // ---- 名字不再"现算" ----
  // 以前这里有一份 16 姓 × 16 名的表,按 id 算出一个像人名的代号。
  // 删掉了:名字只有两种 —— 他自己说的,或者还没收到。
  // 没有名字时界面显示"（未署名）",不编。

  // ---- "什么时候见的":0xFFFF = 没对时 ----
  var WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  function seenText(seen) {
    if (seen === 0xFFFF || seen >= 7 * 1440) return '没记时';
    var wd = Math.floor(seen / 1440);
    var min = seen % 1440;
    var h = Math.floor(min / 60), m = min % 60;
    return WD[wd] + ' ' + h + ':' + (m < 10 ? '0' + m : m);
  }

  // ---- 一条记录的 21 字节 → 对象 ----
  // 布局在 main/card_store.h 的 CARD_REC_WIRE 里(那边有主机测试)。
  // [0..10] 见 pack_rec;[11..20] 是他自己写在卡上的名字(UTF-8,不足补 0)。
  function parseRec(b) {
    if (!b || b.length !== 21) throw new Error('一条记录是 21 字节');
    var end = 11;
    while (end < 21 && b[end] !== 0) end++;
    var name = '';
    if (end > 11) {
      try { name = new TextDecoder().decode(new Uint8Array(b.slice(11, end))); } catch (e) { name = ''; }
    }
    return {
      id: [b[0], b[1], b[2], b[3]],
      seed: b[4] | (b[5] << 8),
      status: b[6] & 7,
      count: b[7],
      emblem: b[8] % 24,
      seen: b[9] | (b[10] << 8),
      // 收不到名字就是空串。调用方显示"（未署名）",不要编一个。
      name: name
    };
  }

  var STATUS = ['学习', '空闲', '别理我', '组队', '吃饭', '运动', '赶作业', '摸鱼'];

  root.CardWall = {
    COLS: W, ROWS: H, SIG: SIG,
    PAPER: PAPER, INK: INK, RED: RED, TEAL: TEAL,
    avatar: avatar,
    avatarSt: avatarSt,
    sigil: sigil,
    seenText: seenText,
    parseRec: parseRec,
    statusName: function (s) { return STATUS[s & 7] || '空闲'; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
