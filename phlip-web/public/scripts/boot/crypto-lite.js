/* Phlip — Web Crypto fallback for insecure contexts (http://LAN IP).
   crypto.subtle is HTTPS/localhost only; LAN browser join still needs SHA-256,
   PBKDF2-HMAC-SHA-256, and AES-256-GCM matching Web Crypto outputs.

   LAN-only: never used on HTTPS public paths (those use crypto.subtle). S-box /
   GF / GHASH and GCM tag compare are not constant-time; a network attacker on
   plain HTTP can already MITM, so timing side-channels are not the practical
   risk. Keep outputs pinned to Web Crypto test vectors when changing this file. */
(function (global) {
  "use strict";

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
  }

  var K256 = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256(data) {
    var bytes = toBytes(data);
    var bitLenHi = Math.floor(bytes.length / 0x20000000);
    var bitLenLo = (bytes.length * 8) >>> 0;
    var withPad = bytes.length + 1 + 8;
    var len = (withPad + 63) & ~63;
    var buf = new Uint8Array(len);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(len - 8, bitLenHi, false);
    dv.setUint32(len - 4, bitLenLo, false);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);
    var i, j;

    for (i = 0; i < len; i += 64) {
      for (j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
      for (j = 16; j < 64; j++) {
        var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (j = 0; j < 64; j++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[j] + w[j]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    odv.setUint32(0, h0, false); odv.setUint32(4, h1, false);
    odv.setUint32(8, h2, false); odv.setUint32(12, h3, false);
    odv.setUint32(16, h4, false); odv.setUint32(20, h5, false);
    odv.setUint32(24, h6, false); odv.setUint32(28, h7, false);
    return out;
  }

  function hmacSha256(key, data) {
    var k = toBytes(key);
    if (k.length > 64) k = sha256(k);
    var kin = new Uint8Array(64);
    var kout = new Uint8Array(64);
    kin.set(k); kout.set(k);
    for (var i = 0; i < 64; i++) { kin[i] ^= 0x36; kout[i] ^= 0x5c; }
    var inner = new Uint8Array(64 + toBytes(data).length);
    inner.set(kin); inner.set(toBytes(data), 64);
    var mid = sha256(inner);
    var outer = new Uint8Array(96);
    outer.set(kout); outer.set(mid, 64);
    return sha256(outer);
  }

  function pbkdf2(password, salt, iterations, dkLen) {
    var pass = typeof password === "string"
      ? new TextEncoder().encode(password)
      : toBytes(password);
    var sal = toBytes(salt);
    var out = new Uint8Array(dkLen);
    var block = 1, pos = 0;
    while (pos < dkLen) {
      var blockBytes = new Uint8Array(4);
      new DataView(blockBytes.buffer).setUint32(0, block, false);
      var msg = new Uint8Array(sal.length + 4);
      msg.set(sal); msg.set(blockBytes, sal.length);
      var u = hmacSha256(pass, msg);
      var t = new Uint8Array(u);
      for (var i = 1; i < iterations; i++) {
        u = hmacSha256(pass, u);
        for (var j = 0; j < 32; j++) t[j] ^= u[j];
      }
      var take = Math.min(32, dkLen - pos);
      out.set(t.subarray(0, take), pos);
      pos += take;
      block++;
    }
    return out;
  }

  // AES-256 (state as 16 bytes in column-major: index = row + 4*col)
  var SBOX = new Uint8Array([
    99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22
  ]);
  var RCON = new Uint8Array([0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]);

  function xtime(a) { return ((a << 1) ^ (((a >>> 7) & 1) * 0x1b)) & 0xff; }
  function mul(a, b) {
    var r = 0;
    a &= 0xff; b &= 0xff;
    for (var i = 0; i < 8; i++) {
      if (b & 1) r ^= a;
      a = xtime(a);
      b >>>= 1;
    }
    return r & 0xff;
  }

  function expandKey(keyBytes) {
    var k = toBytes(keyBytes);
    if (k.length !== 32) throw new Error("AES-256 key required");
    var Nk = 8, Nr = 14, Nw = 4 * (Nr + 1);
    var w = new Uint32Array(Nw);
    var i;
    for (i = 0; i < Nk; i++) {
      w[i] = ((k[4 * i] << 24) | (k[4 * i + 1] << 16) | (k[4 * i + 2] << 8) | k[4 * i + 3]) >>> 0;
    }
    for (i = Nk; i < Nw; i++) {
      var temp = w[i - 1];
      if (i % Nk === 0) {
        temp = (((SBOX[(temp >>> 16) & 0xff] << 24) |
          (SBOX[(temp >>> 8) & 0xff] << 16) |
          (SBOX[temp & 0xff] << 8) |
          SBOX[(temp >>> 24) & 0xff]) ^ (RCON[(i / Nk) | 0] << 24)) >>> 0;
      } else if (i % Nk === 4) {
        temp = ((SBOX[(temp >>> 24) & 0xff] << 24) |
          (SBOX[(temp >>> 16) & 0xff] << 16) |
          (SBOX[(temp >>> 8) & 0xff] << 8) |
          SBOX[temp & 0xff]) >>> 0;
      }
      w[i] = (w[i - Nk] ^ temp) >>> 0;
    }
    return { w: w, Nr: Nr };
  }

  function addRoundKey(s, w, round) {
    for (var c = 0; c < 4; c++) {
      var rk = w[round * 4 + c];
      s[0 + 4 * c] ^= (rk >>> 24) & 0xff;
      s[1 + 4 * c] ^= (rk >>> 16) & 0xff;
      s[2 + 4 * c] ^= (rk >>> 8) & 0xff;
      s[3 + 4 * c] ^= rk & 0xff;
    }
  }

  function subBytes(s) { for (var i = 0; i < 16; i++) s[i] = SBOX[s[i]]; }

  function shiftRows(s) {
    var t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
  }

  function mixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var i = 4 * c;
      var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
      s[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
      s[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
      s[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
    }
  }

  function aesEncryptBlock(exp, input16) {
    var s = new Uint8Array(16);
    var col, row;
    // plaintext bytes → column-major state
    for (col = 0; col < 4; col++)
      for (row = 0; row < 4; row++)
        s[row + 4 * col] = input16[4 * col + row];
    var w = exp.w, Nr = exp.Nr;
    addRoundKey(s, w, 0);
    for (var round = 1; round < Nr; round++) {
      subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, w, round);
    }
    subBytes(s); shiftRows(s); addRoundKey(s, w, Nr);
    var out = new Uint8Array(16);
    for (col = 0; col < 4; col++)
      for (row = 0; row < 4; row++)
        out[4 * col + row] = s[row + 4 * col];
    return out;
  }

  function galoisMultiply(x, y) {
    var z = new Uint8Array(16);
    var v = y.slice();
    for (var i = 0; i < 128; i++) {
      if (x[i >>> 3] & (0x80 >>> (i & 7))) {
        for (var j = 0; j < 16; j++) z[j] ^= v[j];
      }
      var lsb = v[15] & 1;
      for (j = 15; j > 0; j--) v[j] = ((v[j] >>> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
      v[0] >>>= 1;
      if (lsb) v[0] ^= 0xe1;
    }
    return z;
  }

  function ghash(h, data) {
    var y = new Uint8Array(16);
    for (var off = 0; off < data.length; off += 16) {
      var block = new Uint8Array(16);
      block.set(data.subarray(off, Math.min(off + 16, data.length)));
      for (var i = 0; i < 16; i++) y[i] ^= block[i];
      y = galoisMultiply(y, h);
    }
    return y;
  }

  function inc32(counter) {
    var c = counter.slice();
    for (var i = 15; i >= 12; i--) {
      c[i] = (c[i] + 1) & 0xff;
      if (c[i]) break;
    }
    return c;
  }

  function aesGcmEncrypt(key, iv, plaintext) {
    var exp = expandKey(key);
    var H = aesEncryptBlock(exp, new Uint8Array(16));
    var ivb = toBytes(iv);
    if (ivb.length !== 12) throw new Error("AES-GCM iv must be 12 bytes");
    var J0 = new Uint8Array(16);
    J0.set(ivb); J0[15] = 1;
    var pt = toBytes(plaintext);
    var ctr = inc32(J0);
    var ct = new Uint8Array(pt.length);
    var off, i, n, stream;
    for (off = 0; off < pt.length; off += 16) {
      stream = aesEncryptBlock(exp, ctr);
      ctr = inc32(ctr);
      n = Math.min(16, pt.length - off);
      for (i = 0; i < n; i++) ct[off + i] = pt[off + i] ^ stream[i];
    }
    var padLen = (ct.length + 15) & ~15;
    var gdata = new Uint8Array(padLen + 16);
    gdata.set(ct);
    var ldv = new DataView(gdata.buffer, padLen, 16);
    ldv.setUint32(8, 0, false);
    ldv.setUint32(12, (ct.length * 8) >>> 0, false);
    var S = ghash(H, gdata);
    var tagMask = aesEncryptBlock(exp, J0);
    var tag = new Uint8Array(16);
    for (i = 0; i < 16; i++) tag[i] = S[i] ^ tagMask[i];
    var out = new Uint8Array(ct.length + 16);
    out.set(ct); out.set(tag, ct.length);
    return out;
  }

  function aesGcmDecrypt(key, iv, data) {
    var raw = toBytes(data);
    if (raw.length < 16) throw new Error("ciphertext too short");
    var ct = raw.subarray(0, raw.length - 16);
    var tag = raw.subarray(raw.length - 16);
    var exp = expandKey(key);
    var H = aesEncryptBlock(exp, new Uint8Array(16));
    var ivb = toBytes(iv);
    if (ivb.length !== 12) throw new Error("AES-GCM iv must be 12 bytes");
    var J0 = new Uint8Array(16);
    J0.set(ivb); J0[15] = 1;
    var padLen = (ct.length + 15) & ~15;
    var gdata = new Uint8Array(padLen + 16);
    gdata.set(ct);
    var ldv = new DataView(gdata.buffer, padLen, 16);
    ldv.setUint32(12, (ct.length * 8) >>> 0, false);
    var S = ghash(H, gdata);
    var tagMask = aesEncryptBlock(exp, J0);
    var expect = new Uint8Array(16);
    var i, diff = 0;
    for (i = 0; i < 16; i++) { expect[i] = S[i] ^ tagMask[i]; diff |= tag[i] ^ expect[i]; }
    if (diff) throw new Error("AES-GCM auth failed");
    var ctr = inc32(J0);
    var pt = new Uint8Array(ct.length);
    for (var off = 0; off < ct.length; off += 16) {
      var stream = aesEncryptBlock(exp, ctr);
      ctr = inc32(ctr);
      var n = Math.min(16, ct.length - off);
      for (i = 0; i < n; i++) pt[off + i] = ct[off + i] ^ stream[i];
    }
    return pt;
  }

  global.AshCryptoLite = {
    sha256: sha256,
    pbkdf2: pbkdf2,
    aesGcmEncrypt: aesGcmEncrypt,
    aesGcmDecrypt: aesGcmDecrypt,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
