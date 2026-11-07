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
  // 和 card_avatar.c 的 render() 一一对应:只有 5 个自由度(脸色、腮红、
  // 头顶装饰三选一),其余全是固定笔画,镜像由 11-x 折过去。
  function avatar(seed) {
    var out = new Uint8Array(W * H);
    var s = seed ? (seed >>> 0) : 0x9E3779B9;
    var r = xs(s);

    var body = (r & 0x01) ? TEAL : RED;
    var accColor = (body === RED) ? TEAL : RED;
    var blush = (r & 0x10) !== 0;
    var top = (r >>> 5) % 3;

    // 脸体,四个角各切一格
    for (var y = 3; y <= 10; y++) {
      for (var x = 2; x <= 9; x++) put(out, x, y, body);
    }
    put(out, 2, 3, PAPER);
    put(out, 9, 3, PAPER);
    put(out, 2, 10, PAPER);
    put(out, 9, 10, PAPER);

    // 刘海压一行,两侧留鬓角
    for (var fx = 3; fx <= 8; fx++) put(out, fx, 3, INK);
    put(out, 2, 4, INK);
    put(out, 9, 4, INK);

    // 眼睛:2×2,外侧上角留一格当高光
    for (var dy = 0; dy < 2; dy++) {
      for (var dx = 0; dx < 2; dx++) {
        put(out, 3 + dx, 5 + dy, INK);
        put(out, 8 - dx, 5 + dy, INK);
      }
    }
    put(out, 3, 5, PAPER);
    put(out, 8, 5, PAPER);

    if (blush) {
      put(out, 3, 7, RED);
      put(out, 8, 7, RED);
    }

    // 嘴:嘴角在上、中间在下,四格拼一个"U"
    put(out, 4, 8, INK);
    put(out, 7, 8, INK);
    put(out, 5, 9, INK);
    put(out, 6, 9, INK);

    if (top === 1) {           // 呆毛:贴着发际线
      put(out, 5, 2, INK);
      put(out, 6, 2, INK);
    } else if (top === 2) {    // 天线:一点 + 一杆
      put(out, 4, 1, accColor);
      put(out, 7, 1, accColor);
      put(out, 4, 2, INK);
      put(out, 7, 2, INK);
    }
    return out;
  }

  // 状态装饰:和 card_avatar_decorate() 的差量表一一对应。
  // 每个状态只改四五格,位置固定在眼、嘴、头顶 —— 换的是神情,不是换人。
  var BODY = -1;

  function sym(x, y, c) { return [[x, y, c], [W - 1 - x, y, c]]; }

  function ops() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) out = out.concat(arguments[i]);
    return out;
  }

  var PLANS = [
    // 学习:一条横梁把两只黑眼睛连起来,读成眼镜
    { ops: ops(sym(5, 5, INK), sym(2, 5, INK), sym(3, 5, INK)), clearTop: false },
    // 空闲:不装饰
    { ops: [], clearTop: false },
    // 别理我:上眼睑压下来,嘴角翻下去
    { ops: ops(sym(4, 5, BODY), sym(4, 8, BODY), sym(5, 9, BODY),
               sym(5, 8, INK), sym(4, 9, INK)), clearTop: false },
    // 组队:头顶红加号
    { ops: ops(sym(5, 0, RED), sym(4, 1, RED), sym(5, 1, RED), sym(5, 2, RED)), clearTop: true },
    // 吃饭:嘴角收掉,嘴张成 2×2
    { ops: ops(sym(4, 8, BODY), sym(5, 8, INK)), clearTop: false },
    // 运动:右边脸颊一滴汗(只在一边)
    { ops: [[9, 8, INK], [9, 9, INK]], clearTop: false },
    // 赶作业:头顶三道焦躁线
    { ops: [[4, 1, INK], [6, 1, INK], [8, 1, INK]], clearTop: true },
    // 摸鱼:眼神往上飘
    { ops: ops(sym(3, 5, INK), sym(3, 6, BODY), sym(4, 6, BODY)), clearTop: false }
  ];

  function decorate(out, status) {
    if (status < 0 || status >= PLANS.length) return out;

    var plan = PLANS[status];
    var body = out[5 * W + 2];

    if (plan.clearTop) {
      for (var y = 0; y <= 2; y++) {
        for (var x = 3; x <= 8; x++) put(out, x, y, PAPER);
      }
    }
    for (var i = 0; i < plan.ops.length; i++) {
      var op = plan.ops[i];
      put(out, op[0], op[1], op[2] === BODY ? body : op[2]);
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
