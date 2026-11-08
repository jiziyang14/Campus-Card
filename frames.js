// tools/card-link/frames.js —— 手机侧的帧组装。不碰 DOM,所以能在 node 里逐字节验证。
//
// 线上格式(和 main/card_link.c 的分帧层一致):
//
//     [len][payload ...]       len = 1..160
//
// payload[0] 是帧类型,后面是内容。所有多字节整数都是小端。
(function (root) {
  'use strict';

  var MAX_FRAME = 160;     // 与 CARD_LINK_MAX_FRAME 一致(相册把上限从 56 放宽到 160)
  var MAX_WORDS = 60;      // 与 CARD_WORD_MAX 一致
  var MAX_EN = 17;         // CARD_WORD_EN - 1
  var MAX_ZH = 23;         // CARD_WORD_ZH - 1
  var MAX_PERIODS = 8;

  var enc = new TextEncoder();

  function frame(payload) {
    if (!payload || payload.length < 1 || payload.length > MAX_FRAME) {
      throw new Error('帧长度不合法: ' + (payload ? payload.length : 0));
    }
    var out = new Uint8Array(payload.length + 1);
    out[0] = payload.length;
    out.set(payload, 1);
    return out;
  }

  // 按字节截断,但不切半个字符——和 C 的 copy_utf8 同一条规则。
  // 切半个字的话,字库里查不到,屏幕上就是一个空白方块。
  function clampBytes(bytes, max) {
    if (bytes.length <= max) return bytes;
    var n = max;
    while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--;   // 退到字符开头
    return bytes.slice(0, n);
  }

  var api = {
    MAX_FRAME: MAX_FRAME,
    MAX_WORDS: MAX_WORDS,

    // ---- 词表 ----
    begin: function (count) {
      if (count < 1 || count > MAX_WORDS) throw new Error('词表 1..' + MAX_WORDS);
      return frame([6, count]);
    },

    item: function (index, en, zh) {
      if (index < 0 || index >= MAX_WORDS) throw new Error('序号越界');
      var e = clampBytes(enc.encode(en || ''), MAX_EN);
      var z = clampBytes(enc.encode(zh || ''), MAX_ZH);
      if (e.length < 1) throw new Error('英文不能为空');
      var p = [7, index, e.length, z.length];
      return frame(p.concat(Array.from(e), Array.from(z)));
    },

    end: function () { return frame([8]); },
    clearWords: function () { return frame([9]); },

    // ---- 手绘卡面 ----
    // cells: 144 个 0..3(纸 / 墨 / 红 / 青),行优先。
    // 打包规则与 main/card_face.c 的 card_face_expand 严格互逆:
    // 每字节 4 格,先出现的像素在高两位。
    setFace: function (cells) {
      if (!cells || cells.length !== 144) throw new Error('卡面要 144 格');
      var payload = new Uint8Array(1 + 36);
      payload[0] = 10;
      for (var i = 0; i < 144; i++) {
        payload[1 + (i >> 2)] |= (cells[i] & 3) << (6 - 2 * (i & 3));
      }
      return frame(payload);
    },

    // ---- 首页背景 ----
    // 240×320 的 1 位位图,9600 字节,拆成 185 块(每块 52 字节)。
    // 每块单独一帧:BLE 一次写不完 9600 字节,而 BEGIN/END 让"发一半断了"
    // 变成"这次不换",而不是"换上半张花屏"。
    bgBegin: function (total) {
      return frame([14, total & 0xff, (total >> 8) & 0xff]);
    },
    bgData: function (off, bytes) {
      return frame([15, off & 0xff, (off >> 8) & 0xff].concat(Array.from(bytes)));
    },
    bgEnd: function () { return frame([16]); },
    bgClear: function () { return frame([17]); },

    // ---- 个人信息 ----
    // [11][n][姓名][c][班级][m][学号][s][口号]
    // 前三个长度上限和 C 侧的 card_profile.h 逐字对应:
    // 姓名 12 字节(4 个汉字)、班级 15 字节(5 个汉字)、学号 10 字节、口号 18 字节。
    // 空字符串 = "这一项不改";口号除外 —— 它是 0 长度就是"把这句话去掉"。
    setProfile: function (name, klass, no, slogan) {
      var n = clampBytes(enc.encode(name || ''), 12);
      var c = clampBytes(enc.encode(klass || ''), 15);
      var m = clampBytes(enc.encode(no || ''), 10);
      var g = clampBytes(enc.encode(slogan || ''), 18);
      var p = [11, n.length];
      return frame(p.concat(Array.from(n), [c.length], Array.from(c), [m.length], Array.from(m),
                            [g.length], Array.from(g)));
    },

    // ---- 课表 / 待办 / 对时 / 找我 ----
    // wday 是星期(0=周一)。给就一起发：这台机器没有 RTC，只有手机知道日期。
    // 不给也能发，卡片就"只知道钟点、不知道周几"，表盘不会显示饭表。
    setTime: function (minuteOfDay, wday) {
      var m = Math.max(0, Math.min(24 * 60 - 1, minuteOfDay | 0));
      var p = [1, m & 0xff, (m >> 8) & 0xff];
      if (typeof wday === 'number' && wday >= 0 && wday <= 6) p.push(wday | 0);
      return frame(p);
    },

    setTodo: function (mask) { return frame([2, mask & 0xff]); },

    addPeriod: function (period, startMin, endMin, nameId) {
      if (period < 1 || period > MAX_PERIODS) throw new Error('节次 1..' + MAX_PERIODS);
      var s = Math.max(0, Math.min(24 * 60 - 1, startMin | 0));
      var e = Math.max(s, Math.min(24 * 60 - 1, endMin | 0));
      return frame([3, period, s & 0xff, (s >> 8) & 0xff, e & 0xff, (e >> 8) & 0xff, nameId & 0xff]);
    },

    clearPlan: function () { return frame([4]); },

    // 周末课表:[18][day][节次][开始 lo][开始 hi][结束 lo][结束 hi][课程]
    // day 只认 5(周六)/6(周日)。周一到周五还是 addPeriod ——
    // 这样老网页写课表时不会把周末也刷成工作日的样子。
    addPeriodDay: function (day, period, startMin, endMin, nameId) {
      if (day !== 5 && day !== 6) throw new Error('周末只有 5(六)/6(日)');
      if (period < 1 || period > MAX_PERIODS) throw new Error('节次 1..' + MAX_PERIODS);
      var s = Math.max(0, Math.min(24 * 60 - 1, startMin | 0));
      var e = Math.max(s, Math.min(24 * 60 - 1, endMin | 0));
      return frame([18, day, period, s & 0xff, (s >> 8) & 0xff,
                    e & 0xff, (e >> 8) & 0xff, nameId & 0xff]);
    },
    // 这一帧只带 1 个字节,所以上限是 255(固件里那句 300 的夹紧是给直接调用留的,
    // 从线上根本传不到 300——超了会被 uint8 截成 44)。
    findMe: function (seconds) { return frame([5, Math.max(1, Math.min(255, seconds | 0))]); },

    // ---- 饭表 ----
    // [12][day][kind][len][菜名]，day 0=周一, kind 0=早 1=午 2=晚。
    // 一格一帧：传一半断了只是"改了一半"，不会新旧混着；重发那几格就行。
    setMeal: function (day, kind, dish) {
      if (day < 0 || day > 6) throw new Error('星期 0..6');
      if (kind < 0 || kind > 2) throw new Error('哪一顿 0..2');
      var d = clampBytes(enc.encode(dish || ''), 23);
      return frame([12, day, kind, d.length].concat(Array.from(d)));
    },

    clearMeal: function () { return frame([13]); },

    // ---- 远程控制 ----
    // [19][cmd][arg]  cmd 与固件 CARD_CMD_* 同号;arg 随命令变(分钟/秒/音量/亮度)。
    // 这是"遥控器",不是语音专用:屏幕上能按到的东西,网页都能按。
    cmd: function (id, arg) {
      var c = id | 0, a = arg | 0;
      if (c < 0 || c > 19) throw new Error('命令号 0..19');
      return frame([19, c, a & 0xff]);
    },

    // ---- 名片墙 ----
    // [20][0xFF] 要摘要(人数/累计/再遇见),[20][i] 要第 i 条记录。
    // 回执是**二进制**不是文字:一条 11 字节(id4 种子2 状态 次数 合章 时间2),
    // 走的是 card_gatt 的另一条通知通道——文字那条"只留最新一句",会把记录顶掉。
    meetSummary: function () { return frame([20, 0xFF]); },

    meetItem: function (index) {
      if (index < 0 || index > 15) throw new Error('第几条 0..15');
      return frame([20, index]);
    },

    // ---- 相册 ----
    // 一张 240×320 的 RGB565 = 153 600 字节,偏移用 3 字节(2 字节装不下)。
    //   [21][总长 3][w 2][h 2]     开始
    //   [22][off 3][字节...]       一块,最多 156 字节(1 + 3 + 156 = 160 = 上限)
    //   [23][crc32 4]              收完了
    //   [24]                       放弃这次上传
    //   [25]                       问一句:卡片回一行 "ALBUM n/31"
    //   [26][index]                删掉第 index 张(0 起)
    ALBUM_W: 240,
    ALBUM_H: 320,
    ALBUM_PIX_BYTES: 240 * 320 * 2,
    ALBUM_MAX: 31,
    ALBUM_BLOCK: 156,

    albumBegin: function (total, w, h) {
      var n = total >>> 0;
      return frame([21, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff,
                    w & 0xff, (w >>> 8) & 0xff, h & 0xff, (h >>> 8) & 0xff]);
    },

    albumData: function (off, bytes) {
      var o = off >>> 0;
      if (o > 0xffffff) throw new Error('偏移超过 3 字节');
      if (!bytes || !bytes.length || bytes.length > 156) {
        throw new Error('一块 1..156 字节,收到 ' + (bytes ? bytes.length : 0));
      }
      var p = new Uint8Array(4 + bytes.length);
      p[0] = 22;
      p[1] = o & 0xff;
      p[2] = (o >>> 8) & 0xff;
      p[3] = (o >>> 16) & 0xff;
      p.set(bytes, 4);
      return frame(p);
    },

    albumEnd: function (crc) {
      var c = crc >>> 0;
      return frame([23, c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, (c >>> 24) & 0xff]);
    },

    albumAbort: function () { return frame([24]); },
    albumQuery: function () { return frame([25]); },

    albumDelete: function (index) {
      if (index < 0 || index >= 31) throw new Error('第几张 0..30');
      return frame([26, index]);
    },

    // [27][from][to] 把第 from 张挪到第 to 张(0 起)。只改目录顺序,不搬照片,
    // 所以不管挪多远都是一瞬间。回执是 "MOVE OK" / "MOVE ERR"。
    albumMove: function (from, to) {
      if (from < 0 || from >= 31 || to < 0 || to >= 31) throw new Error('第几张 0..30');
      return frame([27, from, to]);
    },

    // CRC32,与固件的 esp_rom_crc32_le(0, ...) 实测一致 —— 也就是标准 zlib CRC32:
    // 反射多项式 0xEDB88320,计算前后各取反一次。
    crc32: function (bytes, seed) {
      var c = ((seed || 0) ^ 0xFFFFFFFF) >>> 0;
      for (var i = 0; i < bytes.length; i++) {
        c ^= bytes[i];
        for (var k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xEDB88320 : 0);
      }
      return (c ^ 0xFFFFFFFF) >>> 0;
    },

    // RGBA → RGB565 小端。屏幕驱动开了 swap_bytes,所以这里按 LVGL 的原生
    // 小端写:低字节在前 = G 的低 3 位 + B。
    rgb565: function (rgba, w, h) {
      var out = new Uint8Array(w * h * 2);
      for (var i = 0, p = 0, q = 0; i < w * h; i++, p += 4, q += 2) {
        var v = ((rgba[p] & 0xf8) << 8) | ((rgba[p + 1] & 0xfc) << 3) | (rgba[p + 2] >> 3);
        out[q] = v & 0xff;
        out[q + 1] = (v >>> 8) & 0xff;
      }
      return out;
    },

    // ---- 分片 ----
    // 一片 20 字节:这是 BLE 默认 MTU 23 下最保险的大小。
    // 固件按字节流拼,所以片大一点小一点都对;这里选小的是为了兼容老手机。
    chunk: function (bytes, size) {
      var n = size || 20;
      var out = [];
      for (var i = 0; i < bytes.length; i += n) {
        out.push(bytes.slice(i, i + n));
      }
      return out;
    },

    // 解析一行 "word,释义" / "word 释义" / "word\t释义"
    parseLine: function (line) {
      var t = String(line).trim();
      if (!t) return null;
      var m = t.split(/\s*[,\t]\s*|\s{2,}/);
      if (m.length === 1) {
        var sp = t.indexOf(' ');
        if (sp > 0) return { en: t.slice(0, sp), zh: t.slice(sp + 1).trim() };
        return { en: t, zh: '' };
      }
      return { en: m[0].trim(), zh: m.slice(1).join(' ').trim() };
    }
  };

  root.CardFrames = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
