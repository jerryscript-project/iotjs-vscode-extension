import { getFormatSize, getUint32,
         setUint32, decodeMessage,
         encodeMessage, cesu8ToString,
         stringToCesu8 , assembleUint8Arrays } from '../JerryUtils';
import * as assert from 'assert';

suite('Jerry Utils', () => {
  const defConfig = {
    cpointerSize: 2,
    littleEndian: true,
  };

  const altConfig = {
    cpointerSize: 4,
    littleEndian: true,
  };

  suite('getFormatSize', () => {
    test('returns 0 for an empty string', () => {
      assert.strictEqual(getFormatSize(defConfig, ''), 0);
    });

    test('throws on unexpected format character', () => {
      assert.throws(() => {
        getFormatSize(defConfig, 'Q');
      }, Error);
    });

    test('returns 1 for B', () => {
      assert.strictEqual(getFormatSize(defConfig, 'B'), 1);
    });

    test('returns 2 for C with default configuration', () => {
      assert.strictEqual(getFormatSize(defConfig, 'C'), 2);
    });

    test('returns 4 for C with alternate configuration', () => {
      assert.strictEqual(getFormatSize(altConfig, 'C'), 4);
    });

    test('returns 4 for I', () => {
      assert.strictEqual(getFormatSize(defConfig, 'I'), 4);
    });

    test('returns sum for longer format', () => {
      assert.strictEqual(getFormatSize(defConfig, 'BCIIIBBCC'), 21);
    });

    test('returns sum for longer format', () => {
      assert.strictEqual(getFormatSize(altConfig, 'BCIIIBBCC'), 27);
    });
  });

  suite('getUint32', () => {
    test('reads little endian values', () => {
      const array = Uint8Array.from([0xef, 0xbe, 0xad, 0xde]);
      assert.strictEqual(getUint32(true, array, 0), 0xdeadbeef);
    });

    test('reads big endian values', () => {
      const array = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
      assert.strictEqual(getUint32(false, array, 0), 0xdeadbeef);
    });

    test('reads at an offset', () => {
      const array = Uint8Array.from([0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
      assert.strictEqual(getUint32(false, array, 2), 0xdeadbeef);
    });
  });

  suite('setUint32', () => {
    test('writes little endian values', () => {
      const array = new Uint8Array(4);
      setUint32(true, array, 0, 0xdeadbeef);
      assert.deepStrictEqual(array, Uint8Array.from([0xef, 0xbe, 0xad, 0xde]));
    });

    test('writes big endian values', () => {
      const array = new Uint8Array(4);
      setUint32(false, array, 0, 0xdeadbeef);
      assert.deepStrictEqual(array, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));
    });

    test('writes at an offset', () => {
      const array = new Uint8Array(6);
      setUint32(false, array, 2, 0xdeadbeef);
      assert.deepStrictEqual(array, Uint8Array.from([0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]));
    });
  });

  suite('decodeMessage', () => {
    test('throws if message too short', () => {
      const array = Uint8Array.from([0, 1, 2]);
      assert.throws(() => {
        decodeMessage(defConfig, 'I', array);
      }, Error);
    });

    test('throws on unexpected format character', () => {
      const array = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
      assert.throws(() => {
        decodeMessage(defConfig, 'Q', array);
      }, Error);
    });

    test('returns a byte with B character', () => {
      const array = Uint8Array.from([42]);
      assert.deepStrictEqual(decodeMessage(defConfig, 'B', array), [42]);
    });

    test('returns two bytes for C with default config', () => {
      const array = Uint8Array.from([1, 2, 3]); // 3 ignored
      assert.deepStrictEqual(decodeMessage(defConfig, 'C', array), [1 + (2 << 8)]);
    });

    test('returns four bytes for C with big endian', () => {
      const array = Uint8Array.from([1, 2, 3, 4, 5]); // 3 ignored
      assert.deepStrictEqual(decodeMessage({
        cpointerSize: 2,
        littleEndian: false,
      }, 'C', array), [(1 << 8) + 2]);
    });

    test('returns four bytes for C with default config', () => {
      const array = Uint8Array.from([1, 2, 3, 4, 5]);  // 5 ignored
      assert.deepStrictEqual(decodeMessage(altConfig, 'C', array),
        [1 + (2 << 8) + (3 << 16) + (4 << 24)],
      );
    });

    test('returns four bytes for C with big endian', () => {
      const array = Uint8Array.from([1, 2, 3, 4, 5]);  // 5 ignored
      assert.deepStrictEqual(decodeMessage({
        cpointerSize: 4,
        littleEndian: false,
        }, 'C', array),
        [(1 << 24) + (2 << 16) + (3 << 8) + 4],
      );
    });

    test('handles multiple format characters', () => {
      const array = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);  // 8 ignored
      assert.deepStrictEqual(decodeMessage(defConfig, 'IBC', array), [
        1 + (2 << 8) + (3 << 16) + (4 << 24),
        5,
        6 + (7 << 8),
      ]);
    });

    test('throws on unexpected pointer size', () => {
      const array = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
      assert.throws(() => {
        decodeMessage({
          cpointerSize: 6,
          littleEndian: true,
        }, 'C', array);
      }, Error);
    });
  });

  suite('encodeMessage', () => {
    test('throws if value list too short', () => {
      assert.throws(() => {
        encodeMessage(defConfig, 'BI', [42]);
      }, Error);
    });

    test('throws on unexpected format character', () => {
      assert.throws(() => {
        encodeMessage(defConfig, 'Q', [42]);
      }, Error);
    });

    test('encodes a byte with B character', () => {
      const array = encodeMessage(defConfig, 'B', [42]);
      assert.deepStrictEqual(array, Uint8Array.from([42]));
    });

    test('throws on byte outside range', () => {
      assert.throws(() => {
        encodeMessage(defConfig, 'B', [-1]);
      }, Error);
      assert.throws(() => {
        encodeMessage(defConfig, 'B', [0x100]);
      }, Error);
    });

    test('encodes two bytes for C with default config', () => {
      const array = encodeMessage(defConfig, 'C', [1 + (2 << 8)]);
      assert.deepStrictEqual(array, Uint8Array.from([1, 2]));
    });

    test('encodes two bytes for C with big endian', () => {
      const array = encodeMessage({
        cpointerSize: 2,
        littleEndian: false,
      }, 'C', [(1 << 8) + 2]);
      assert.deepStrictEqual(array, Uint8Array.from([1, 2]));
    });

    test('throws on two bytes outside range', () => {
      assert.throws(() => {
        encodeMessage(defConfig, 'C', [-1]);
      }, Error);
      assert.throws(() => {
        encodeMessage(defConfig, 'C', [0x10000]);
      }, Error);
    });

    test('encodes four bytes for C with default config', () => {
      const array = encodeMessage(altConfig, 'C', [1 + (2 << 8) + (3 << 16) + (4 << 24)]);
      assert.deepStrictEqual(array, Uint8Array.from([1, 2, 3, 4]));
    });

    test('encodes four bytes for C with big endian', () => {
      const array = encodeMessage({
        cpointerSize: 4,
        littleEndian: false,
      }, 'C', [(1 << 24) + (2 << 16) + (3 << 8) + 4]);
      assert.deepStrictEqual(array, Uint8Array.from([1, 2, 3, 4]));
    });

    test('throws on float', () => {
      assert.throws(() => {
        encodeMessage(defConfig, 'I', [4.2]);
      }, Error);
    });

    test('handles multiple format characters', () => {
      const array = encodeMessage(defConfig, 'IBC', [
        1 + (2 << 8) + (3 << 16) + (4 << 24),
        5,
        6 + (7 << 8),
      ]);
      assert.deepStrictEqual(array, Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
    });

    test('throws on byte outside range', () => {
      assert.throws(() => {
        encodeMessage({
          cpointerSize: 6,
          littleEndian: true,
        }, 'C', [42]);
      }, Error);
    });

    test('throws on unexpected pointer size', () => {
      assert.throws(() => {
        encodeMessage({
          cpointerSize: 6,
          littleEndian: true,
        }, 'C', [42]);
      }, Error);
    });
  });

  suite('cesu8ToString and stringToCesu8', () => {
    test('returns empty string for undefined input', () => {
      assert.strictEqual(cesu8ToString(undefined), '');
    });

    test('returns empty array for empty string, and vice versa', () => {
      assert.strictEqual(cesu8ToString(new Uint8Array(0)), '');
      assert.deepStrictEqual(stringToCesu8('', 5, defConfig), new Uint8Array(0));
    });

    test('returns ASCII from ASCII', () => {
      const sentence = 'The quick brown fox jumped over the lazy dog.';
      const array = new Uint8Array(sentence.length);
      for (let i = 0; i < sentence.length; i++) {
        array[i] = sentence.charCodeAt(i);
      }
      assert.deepStrictEqual(cesu8ToString(array), sentence);
      assert.deepStrictEqual(stringToCesu8(sentence, 5, defConfig), array);
    });

    test('acts like UTF-8 for two-byte encodings', () => {
      // 0x080 = 00010 000000 = 0x02, 0x00
      const lowTwoByte = Uint8Array.from([0xc0 + 0x02, 0x80 + 0x00]);
      // 0x7ff = 11111 111111 = 0x1f, 0x3f
      const highTwoByte = Uint8Array.from([0xc0 + 0x1f, 0x80 + 0x3f]);
      assert.deepStrictEqual(cesu8ToString(lowTwoByte), String.fromCharCode(0x80));
      assert.deepStrictEqual(cesu8ToString(highTwoByte), String.fromCharCode(0x7ff));
      assert.deepStrictEqual(stringToCesu8(String.fromCharCode(0x80), 5, defConfig), lowTwoByte);
      assert.deepStrictEqual(stringToCesu8(String.fromCharCode(0x7ff), 5, defConfig), highTwoByte);
    });

    test('acts like UTF-8 for three-byte encodings', () => {
      // 0x0800 = 0000 100000 000000 = 0x00, 0x20, 0x00
      const lowThreeByte = Uint8Array.from([0xe0 + 0x00, 0x80 + 0x20, 0x80 + 0x00]);
      // 0xffff = 1111 111111 111111 = 0x0f, 0x3f, 0x3f
      const highThreeByte = Uint8Array.from([0xe0 + 0x0f, 0x80 + 0x3f, 0x80 + 0x3f]);
      assert.deepStrictEqual(cesu8ToString(lowThreeByte), String.fromCharCode(0x0800));
      assert.deepStrictEqual(cesu8ToString(highThreeByte), String.fromCharCode(0xffff));
      assert.deepStrictEqual(stringToCesu8(String.fromCharCode(0x0800), 5, defConfig), lowThreeByte);
      assert.deepStrictEqual(stringToCesu8(String.fromCharCode(0xffff), 5, defConfig), highThreeByte);
    });

    test('decodes UTF-16 surrogate pairs', () => {
      // 😂 is encoded as a 'surrogate pair': \ud83d\ude02 -- this is valid
      // CESU-8 but invalid UTF-8 (a four-byte encoding should be used).
      const surrogatePairBytes = Uint8Array.from([
        // 0xd83d = 1101 100000 111101 = 0x0d, 0x20, 0x3d
        0xe0 + 0x0d, 0x80 + 0x20, 0x80 + 0x3d,
        // 0xde02 = 1101 111000 000010 = 0x0d, 0x38, 0x02
        0xe0 + 0x0d, 0x80 + 0x38, 0x80 + 0x02,
      ]);
      assert.deepStrictEqual(cesu8ToString(surrogatePairBytes), '😂');
      assert.deepStrictEqual(stringToCesu8('😂', 5, defConfig), surrogatePairBytes);
    });
  });

  suite('assembleUint8Arrays', () => {
  test('drops the first byte of the second arg if first is undefined', () => {
      const array = Uint8Array.from([1, 2, 3]);
      assert.deepStrictEqual(assembleUint8Arrays(undefined, array), Uint8Array.from([2, 3]));
    });

  test('returns first array if second empty', () => {
      const array1 = Uint8Array.from([1, 2, 3]);
      const array2 = new Uint8Array([]);
      assert.deepStrictEqual(assembleUint8Arrays(array1, array2), Uint8Array.from([1, 2, 3]));
    });

  test('returns first array if second has one byte', () => {
      const array1 = Uint8Array.from([1, 2, 3]);
      const array2 = new Uint8Array([4]);
      assert.deepStrictEqual(assembleUint8Arrays(array1, array2), Uint8Array.from([1, 2, 3]));
    });

  test('concatenates two arrays dropping first byte of the second one', () => {
      const array1 = Uint8Array.from([1, 2, 3]);
      const array2 = new Uint8Array([4, 5, 6]);
      assert.deepStrictEqual(assembleUint8Arrays(array1, array2), Uint8Array.from([1, 2, 3, 5, 6]));
    });
  });
});
