/* ==========================================================================
   NCM 解密（网易云加密格式 → 原始 mp3 / flac）
   算法参考 dragonbreaker233/ncm-converter，四个要点：
   1. key 段：XOR 0x64 → AES-128-ECB(core key) → 去掉 "neteasecloudmusic" → 去 PKCS7
   2. meta 段：XOR 0x63 → 取 "key(Don't modify):" 后的 base64 → 解码 → 补零到 16
              → AES-128-ECB(meta key) → 去填充 → 去 "music:" → JSON
   3. meta 之后还有：CRC(4) + gap(5) + 封面长度(4) + 封面数据
   4. 音频：修改版 RC4（j 不累积、不交换 S 盒）
   ========================================================================== */
(function (global) {
  "use strict";

  var CORE_KEY = new Uint8Array([
    0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F,
    0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78, 0x57
  ]);

  // 元数据块用的是另一把密钥
  var META_KEY = new Uint8Array([
    0x23, 0x31, 0x34, 0x6C, 0x6A, 0x6B, 0x5F, 0x21,
    0x5C, 0x5D, 0x26, 0x30, 0x55, 0x3C, 0x27, 0x28
  ]);

  /* ---------------- AES-128 解密 ---------------- */
  var SBOX = new Uint8Array([
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
  ]);

  var INV_SBOX = new Uint8Array(256);
  (function () {
    for (var i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
  })();

  var RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36];

  function gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xFF;
      if (hi) a ^= 0x1B;
      b >>= 1;
    }
    return p & 0xFF;
  }

  function expandKey(key) {
    var w = new Uint8Array(176);
    w.set(key, 0);
    for (var i = 16; i < 176; i += 4) {
      var t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if (i % 16 === 0) {
        var tmp = t0;
        t0 = SBOX[t1] ^ RCON[i / 16];
        t1 = SBOX[t2];
        t2 = SBOX[t3];
        t3 = SBOX[tmp];
      }
      w[i] = w[i - 16] ^ t0;
      w[i + 1] = w[i - 15] ^ t1;
      w[i + 2] = w[i - 14] ^ t2;
      w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }

  function addRoundKey(s, w, round) {
    for (var i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
  }

  function invShiftRows(s) {
    var t;
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }

  function invSubBytes(s) {
    for (var i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  }

  function invMixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i]     = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
      s[i + 1] = gfMul(a0, 9)  ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
      s[i + 2] = gfMul(a0, 13) ^ gfMul(a1, 9)  ^ gfMul(a2, 14) ^ gfMul(a3, 11);
      s[i + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9)  ^ gfMul(a3, 14);
    }
  }

  function aesDecryptBlock(block, w) {
    var s = new Uint8Array(16);
    s.set(block);
    addRoundKey(s, w, 10);
    for (var r = 9; r >= 1; r--) {
      invShiftRows(s);
      invSubBytes(s);
      addRoundKey(s, w, r);
      invMixColumns(s);
    }
    invShiftRows(s);
    invSubBytes(s);
    addRoundKey(s, w, 0);
    return s;
  }

  function aesEcbDecrypt(cipher, key) {
    var w = expandKey(key);
    var out = new Uint8Array(cipher.length);
    for (var i = 0; i + 16 <= cipher.length; i += 16) {
      out.set(aesDecryptBlock(cipher.subarray(i, i + 16), w), i);
    }
    return out;
  }

  /* ---------------- 修改版 RC4 ----------------
     和标准 RC4 不同：j 不累积、不交换 S 盒，密钥流每 256 字节重复。 */
  function buildSbox(key) {
    var s = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) s[i] = i;

    var j = 0;
    for (i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 0xFF;
      var t = s[i]; s[i] = s[j]; s[j] = t;
    }
    return s;
  }

  function rc4Decrypt(sbox, data) {
    var out = new Uint8Array(data.length);
    for (var idx = 0; idx < data.length; idx++) {
      var i = (idx + 1) & 0xFF;
      var j = (i + sbox[i]) & 0xFF;
      var k = sbox[(sbox[i] + sbox[j]) & 0xFF];
      out[idx] = data[idx] ^ k;
    }
    return out;
  }

  function bytesToStr(u8) {
    try {
      return new TextDecoder("utf-8").decode(u8);
    } catch (e) {
      var s = "";
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      try { return decodeURIComponent(escape(s)); } catch (e2) { return s; }
    }
  }

  function b64Decode(str) {
    var clean = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
    var bin = atob(clean);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 解密一个 ncm。返回 { blob, ext, mime, meta, cover } */
  function decrypt(buffer) {
    return new Promise(function (resolve, reject) {
      try {
        var dv = new DataView(buffer);
        var u8 = new Uint8Array(buffer);

        var magic = bytesToStr(u8.subarray(0, 8));
        if (magic.indexOf("CTENFDAM") !== 0 && magic.indexOf("NETEASE") !== 0) {
          reject(new Error("这不是网易云 ncm 文件"));
          return;
        }

        var pos = 8 + 2;

        // ---- key ----
        var keyLen = dv.getUint32(pos, true); pos += 4;
        if (!keyLen || pos + keyLen > u8.length) {
          reject(new Error("ncm 文件头损坏"));
          return;
        }

        var keyData = u8.slice(pos, pos + keyLen);
        pos += keyLen;
        for (var k = 0; k < keyData.length; k++) keyData[k] ^= 0x64;

        var keyPlain = aesEcbDecrypt(keyData, CORE_KEY);
        if (bytesToStr(keyPlain.subarray(0, 17)) !== "neteasecloudmusic") {
          reject(new Error("ncm 密钥校验失败，文件可能损坏"));
          return;
        }

        var body = keyPlain.subarray(17);
        var pad = body[body.length - 1];
        var rc4Key = (pad > 0 && pad <= 16) ? body.subarray(0, body.length - pad) : body;

        // ---- meta ----
        var metaLen = dv.getUint32(pos, true); pos += 4;
        var meta = null;
        var coverData = null;

        if (metaLen > 0 && pos + metaLen <= u8.length) {
          var rawMeta = u8.slice(pos, pos + metaLen);
          pos += metaLen;
          for (var m = 0; m < rawMeta.length; m++) rawMeta[m] ^= 0x63;

          try {
            var ms = bytesToStr(rawMeta);
            var mk = "key(Don't modify):";
            var mi = ms.indexOf(mk);
            if (mi >= 0) {
              var enc = b64Decode(ms.slice(mi + mk.length));
              var need = (16 - (enc.length % 16)) % 16;
              if (need) {
                var padded = new Uint8Array(enc.length + need);
                padded.set(enc);
                enc = padded;
              }
              var dec = aesEcbDecrypt(enc, META_KEY);
              var p2 = dec[dec.length - 1];
              var plain = (p2 > 0 && p2 <= 16) ? dec.subarray(0, dec.length - p2) : dec;
              var js = bytesToStr(plain);
              if (js.indexOf("music:") === 0) js = js.slice(6);

              var start = js.indexOf("{");
              var depth = 0, end = -1;
              for (var i2 = start; i2 < js.length; i2++) {
                if (js[i2] === "{") depth++;
                else if (js[i2] === "}") { depth--; if (depth === 0) { end = i2 + 1; break; } }
              }
              if (start >= 0 && end > start) meta = JSON.parse(js.slice(start, end));
            }
          } catch (e) { meta = null; }
        }

        // ---- CRC + gap + 封面 ----
        pos += 4;   // crc
        pos += 5;   // gap

        var coverLen = dv.getUint32(pos, true);
        pos += 4;
        if (coverLen > 0 && coverLen < 50 * 1024 * 1024 && pos + coverLen <= u8.length) {
          coverData = u8.subarray(pos, pos + coverLen);
          pos += coverLen;
        }

        if (pos >= u8.length) {
          reject(new Error("ncm 里没有音频数据"));
          return;
        }

        // ---- 音频 ----
        var audio = rc4Decrypt(buildSbox(rc4Key), u8.subarray(pos));

        var isFlac = audio[0] === 0x66 && audio[1] === 0x4C && audio[2] === 0x61 && audio[3] === 0x43;
        var isId3 = audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33;
        var isMpeg = audio[0] === 0xFF && (audio[1] & 0xE0) === 0xE0;
        var isOgg = audio[0] === 0x4F && audio[1] === 0x67 && audio[2] === 0x67 && audio[3] === 0x53;

        if (!isFlac && !isId3 && !isMpeg && !isOgg) {
          reject(new Error("ncm 解密失败：请换一个文件试试"));
          return;
        }

        var ext = "mp3";
        var mime = "audio/mpeg";
        if (isFlac) { ext = "flac"; mime = "audio/flac"; }
        else if (isOgg) { ext = "ogg"; mime = "audio/ogg"; }

        // 封面单独返回，供界面直接用
        var coverUrl = "";
        if (coverData && coverData.length) {
          try {
            var isJpg = coverData[0] === 0xFF && coverData[1] === 0xD8;
            var isPng = coverData[0] === 0x89 && coverData[1] === 0x50;
            if (isJpg || isPng) {
              var bin = "";
              for (var ci = 0; ci < coverData.length; ci++) bin += String.fromCharCode(coverData[ci]);
              coverUrl = "data:" + (isPng ? "image/png" : "image/jpeg") + ";base64," + btoa(bin);
            }
          } catch (e) { }
        }

        resolve({
          blob: new Blob([audio], { type: mime }),
          ext: ext,
          mime: mime,
          meta: meta,
          cover: coverUrl
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  global.NCM = { decrypt: decrypt };
})(window);
