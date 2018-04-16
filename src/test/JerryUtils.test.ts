import { getFormatSize } from '../JerryUtils';
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
      assert.strictEqual(getFormatSize(defConfig, 'B'), 1)
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
});
