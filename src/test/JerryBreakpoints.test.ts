import { Breakpoint, ParsedFunction } from '../JerryBreakpoints';
import * as assert from 'assert';

suite('Jerry Breakpoints', () => {
    suite('Breakpoint constructor', () => {
        const mockParsedFunction: any = {
            scriptId: 42,
        };

        test('assigns values from options arg', () => {
            const bp = new Breakpoint({
                scriptId: 1,
                func: mockParsedFunction,
                line: 42,
                offset: 37,
                activeIndex: 5,
            });
            assert.strictEqual(bp.scriptId, 1);
            assert.strictEqual(bp.func, mockParsedFunction);
            assert.strictEqual(bp.line, 42);
            assert.strictEqual(bp.offset, 37);
            assert.strictEqual(bp.activeIndex, 5);
        });

        test('sets activeIndex to -1 by default', () => {
            const bp = new Breakpoint({
                scriptId: 1,
                func: mockParsedFunction,
                line: 42,
                offset: 37,
              });
            assert.strictEqual(bp.scriptId, 1);
            assert.strictEqual(bp.func, mockParsedFunction);
            assert.strictEqual(bp.line, 42);
            assert.strictEqual(bp.offset, 37);
            assert.strictEqual(bp.activeIndex, -1);
        });
    });

    suite('Breakpoint toString', () => {
        const mockParsedFunction: any = {
            line: 21,
            column: 61,
        };

        mockParsedFunction.sourceName = 'jerry.js',
        mockParsedFunction.isFunc = true;
        mockParsedFunction.name = undefined;

        test('displays function name, line and column', () => {
            mockParsedFunction.name = 'cheese';

            const bp = new Breakpoint({
                scriptId: 1,
                func: mockParsedFunction,
                line: 42,
                offset: 37,
              });
            assert.strictEqual(bp.toString(), 'jerry.js:42 (in cheese() at line:21, col:61)');
        });

        test('shows "function" for unnamed functions', () => {
            mockParsedFunction.name = undefined;
            const bp = new Breakpoint({
                scriptId: 1,
                func: mockParsedFunction,
                line: 42,
                offset: 37,
              });
            assert.strictEqual(bp.toString(), 'jerry.js:42 (in function() at line:21, col:61)');
        });

        test('drops function detail if not really a function (i.e. global scope)', () => {
            mockParsedFunction.isFunc = false;

            const bp = new Breakpoint({
              scriptId: 1,
              func: mockParsedFunction,
              line: 42,
              offset: 37,
            });
            assert.strictEqual(bp.toString(), 'jerry.js:42');
          });

        test('reports source name as "<unknown>" if not given', () => {
            mockParsedFunction.isFunc = false;
            mockParsedFunction.sourceName = undefined;

            const bp = new Breakpoint({
              scriptId: 1,
              func: mockParsedFunction,
              line: 42,
              offset: 37,
            });
            assert.strictEqual(bp.toString(), '<unknown>:42');
          });
    });

    suite('ParsedFunction constructor', () => {
        test('adds a breakpoint for each line/offset pair in the frame', () => {
            const frame = {
              isFunc: true,
              scriptId: 42,
              line: 1,
              column: 2,
              source: '',
              sourceName: 'cheese.js',
              name: 'cheddar',
              lines: [4, 9, 16, 25],
              offsets: [8, 27, 64, 125],
            };

            const pf = new ParsedFunction(7, frame);
            assert.strictEqual(pf.isFunc, true);
            assert.strictEqual(pf.byteCodeCP, 7);
            assert.strictEqual(pf.scriptId, 42);
            assert.strictEqual(pf.line, 1);
            assert.strictEqual(pf.column, 2);
            assert.strictEqual(pf.name, 'cheddar');
            assert.strictEqual(pf.firstBreakpointLine, 4);
            assert.strictEqual(pf.firstBreakpointOffset, 8);
            assert.strictEqual(pf.sourceName, 'cheese.js');

            // the third breakpoint w/ line 16, offset 64 is indexed as 16 in lines
            assert.strictEqual(pf.lines[16].line, 16);
            assert.strictEqual(pf.lines[16].offset, 64);

            // the fourth breakpoint w/ line 25, offset 125 is indexed as 125 in offsets
            assert.strictEqual(pf.offsets[125].line, 25);
            assert.strictEqual(pf.offsets[125].offset, 125);
          });
    });
});
