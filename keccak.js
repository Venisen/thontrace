/**
 * Keccak-256 in plain JavaScript (the variant Ethereum uses, with 0x01 padding, not NIST SHA-3).
 * Used by the offline model and the demo page so that lot keys and tag commitments are identical to the
 * values the Solidity contract computes. Checked against the two published test vectors in test/model.test.js.
 * Works in Node and in the browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TT = Object.assign(root.TT || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MASK = (1n << 64n) - 1n;
  const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

  // Round constants and rotation offsets generated from the Keccak specification.
  const RC = [];
  {
    let R = 1;
    for (let round = 0; round < 24; round++) {
      let c = 0n;
      for (let j = 0; j < 7; j++) {
        R = ((R << 1) ^ ((R >> 7) * 0x71)) % 256;
        if (R & 2) c ^= 1n << BigInt((1 << j) - 1);
      }
      RC.push(c);
    }
  }
  const ROT = new Array(25).fill(0);
  {
    let x = 1;
    let y = 0;
    for (let t = 0; t < 24; t++) {
      ROT[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
      const nx = y;
      const ny = (2 * x + 3 * y) % 5;
      x = nx;
      y = ny;
    }
  }

  function keccakF(s) {
    const B = new Array(25);
    const C = new Array(5);
    for (let round = 0; round < 24; round++) {
      for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (let x = 0; x < 5; x++) {
        const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) s[x + 5 * y] ^= d;
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & MASK & B[((x + 2) % 5) + 5 * y]);
        }
      }
      s[0] ^= RC[round];
    }
  }

  /** @param {Uint8Array} bytes @returns {Uint8Array} 32 bytes */
  function keccak256Bytes(bytes) {
    const rate = 136;
    const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    const s = new Array(25).fill(0n);
    for (let off = 0; off < padded.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) {
        let lane = 0n;
        for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
        s[i] ^= lane;
      }
      keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
      for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((s[i] >> BigInt(8 * b)) & 0xffn);
    }
    return out;
  }

  const toHex = (u8) => "0x" + Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const utf8 = (str) => new TextEncoder().encode(str);
  function fromHex(hex) {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (h.length % 2) throw new Error("odd-length hex");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  /** keccak256 of a UTF-8 string, as 0x-prefixed hex. Same as ethers.id(text) and Solidity keccak256(bytes(text)). */
  const keccakText = (text) => toHex(keccak256Bytes(utf8(text)));
  /** keccak256 of the 32 raw bytes of a 0x-prefixed hex value, as Solidity keccak256(abi.encodePacked(bytes32)). */
  const keccakHex = (hex) => toHex(keccak256Bytes(fromHex(hex)));

  return { keccak256Bytes, keccakText, keccakHex, toHex, fromHex };
});
