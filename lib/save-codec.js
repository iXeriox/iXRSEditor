'use strict';

const zlib = require('node:zlib');

const compressors = {
  gzip: { decode: zlib.gunzipSync, encode: zlib.gzipSync },
  zlib: { decode: zlib.inflateSync, encode: zlib.deflateSync },
  deflateRaw: { decode: zlib.inflateRawSync, encode: zlib.deflateRawSync },
  brotli: { decode: zlib.brotliDecompressSync, encode: zlib.brotliCompressSync }
};

function parseJsonText(text) {
  const start = Math.min(...['{', '['].map(char => {
    const position = text.indexOf(char);
    return position < 0 ? Infinity : position;
  }));
  if (!Number.isFinite(start)) throw new Error('No JSON object or array was found');

  for (let end = text.length; end > start; end -= 1) {
    const last = text[end - 1];
    if (last !== '}' && last !== ']') continue;
    try {
      return { value: JSON.parse(text.slice(start, end)), start, end };
    } catch { /* keep searching for an embedded JSON boundary */ }
  }
  throw new Error('The save contains JSON-like data, but it is not valid JSON');
}

function decodeText(buffer) {
  const encodings = buffer[0] === 0xff && buffer[1] === 0xfe
    ? ['utf16le', 'utf8'] : ['utf8', 'utf16le'];
  for (const encoding of encodings) {
    try {
      const text = buffer.toString(encoding).replace(/^\uFEFF/, '');
      const parsed = parseJsonText(text);
      return { ...parsed, text, encoding };
    } catch { /* try the next supported text encoding */ }
  }
  throw new Error('No supported JSON payload was detected');
}

function decodeSave(input) {
  if (!Buffer.isBuffer(input) || !input.length) throw new Error('The save file is empty');
  const attempts = [{ compression: 'none', content: input }];
  for (const [compression, codec] of Object.entries(compressors)) {
    try { attempts.push({ compression, content: codec.decode(input) }); } catch { /* format mismatch */ }
  }

  for (const attempt of attempts) {
    try {
      const decoded = decodeText(attempt.content);
      const beforeText = decoded.text.slice(0, decoded.start);
      const afterText = decoded.text.slice(decoded.end);
      return {
        json: decoded.value,
        format: {
          compression: attempt.compression,
          encoding: decoded.encoding,
          prefix: Buffer.from(beforeText, decoded.encoding).toString('base64'),
          suffix: Buffer.from(afterText, decoded.encoding).toString('base64')
        }
      };
    } catch { /* try decompressed candidate */ }
  }
  throw new Error('Unsupported save. Select the WGS data blob, not container.index. Supported payloads are JSON, gzip, zlib, raw deflate, and Brotli.');
}

function encodeSave(json, format = {}) {
  if (json === undefined) throw new Error('JSON is required');
  const compression = format.compression || 'none';
  const encoding = format.encoding === 'utf16le' ? 'utf16le' : 'utf8';
  const prefix = Buffer.from(format.prefix || '', 'base64');
  const suffix = Buffer.from(format.suffix || '', 'base64');
  const body = Buffer.from(JSON.stringify(json), encoding);
  const content = Buffer.concat([prefix, body, suffix]);
  if (compression === 'none') return content;
  if (!compressors[compression]) throw new Error(`Unsupported compression: ${compression}`);
  return compressors[compression].encode(content);
}

module.exports = { decodeSave, encodeSave };
