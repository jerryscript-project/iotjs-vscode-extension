import * as SP from '../JerryProtocolConstants';
import { Breakpoint } from '../JerryBreakpoints';
import { JerryDebugProtocolHandler } from '../JerryProtocolHandler';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { stringToCesu8, setUint32 } from '../JerryUtils';

// utility function
function encodeArray(byte: number, str: string) {
  const array = new Uint8Array(1 + str.length);
  array[0] = byte & 0xff;
  for (let i = 0; i < str.length; i++) {
    array[i + 1] = str.charCodeAt(i);
  }
  return array;
}

// Extends configArray with JERRY_DEBUGGER_VERSION.
//
// configArray data: [messageType, byteOrder, maxMessageSize, cpointerSize]
function createConfiguration(configArray) {
  let version = new Uint8Array(4);
  setUint32(Boolean(configArray[1]), version, 0, SP.JERRY_DEBUGGER_VERSION);
  configArray.splice(2, 0, ...version);
  return Uint8Array.from(configArray);
}

function setupHaltedProtocolHandler(isThereBreakpointHit: boolean = false) {
  const debugClient = {
    send: sinon.spy(),
  };
  const handler = new JerryDebugProtocolHandler({});
  handler.debuggerClient = debugClient as any;
  // For these tests mock the current breakpoint by setting the private lastBreakpointHit member:
  if (!isThereBreakpointHit) {
    (handler as any).lastBreakpointHit = {} as Breakpoint;
  } else {
    const bp: any = {
      activeIndex: 4,
      func: {
        byteCodeCP: 42,
      },
      offset: 10,
    };

    (handler as any).lastBreakpointHit = bp as Breakpoint;
  }
  return { handler, debugClient };
}

suite('JerryProtocolHandler', () => {
  suite('onConfiguration', () => {
    const delegate = {
      onError: sinon.spy(),
    };
    const handler = new JerryDebugProtocolHandler(delegate);

    test('aborts when message too short', () => {
      delegate.onError.resetHistory();
      const array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 2, 3, 4]);
      handler.onConfiguration(array);
      assert(delegate.onError.calledOnce);
    });

    test('allows otherwise valid message to be too long', () => {
      delegate.onError.resetHistory();
      const array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 200, 4, 0]);
      handler.onConfiguration(array);
      assert(delegate.onError.notCalled);
    });

    test('aborts when compressed pointer wrong size', () => {
      delegate.onError.resetHistory();
      const array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 200, 6]);
      handler.onConfiguration(array);
      assert(delegate.onError.calledOnce);
    });

    test('aborts when version unexpected', () => {
      delegate.onError.resetHistory();
      const array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 0, 0, 0, 0, 200, 4]);
      handler.onConfiguration(array);
      assert(delegate.onError.calledOnce);
    });

    test('succeeds when everything is normal', () => {
      delegate.onError.resetHistory();
      const array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 200, 4]);
      handler.onConfiguration(array);
      assert(delegate.onError.notCalled);
    });
  });

  suite('onByteCodeCP', () => {
    const delegate = {
      onScriptParsed: sinon.spy(),
      onError: sinon.spy()
    };
    let handler: JerryDebugProtocolHandler;

    test('throws if stack empty', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      const array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP]);
      assert.throws(() => handler.onByteCodeCP(array));
      assert(delegate.onError.notCalled);
    });
  });

  suite('onSourceCode', () => {
    const delegate = {
      onScriptParsed: sinon.spy(),
      onError: sinon.spy()
    };
    let handler: JerryDebugProtocolHandler;

    test('does not call scriptParsed after only SOURCE message', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      const array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE, 'abc');
      // code = 'abc'
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.notCalled);
      assert(delegate.onError.notCalled);
    });

    test('immediately calls scriptParsed from END message', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      const array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'abc');
      // code = 'abc' + END
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.calledOnce);
      const data = delegate.onScriptParsed.args[0][0];
      // first script is #1, 'abc' is just one line, and no name was given
      assert.strictEqual(data.id, 1);
      assert.strictEqual(data.lineCount, 1);
      assert.strictEqual(data.name, '');
      assert.strictEqual(handler.getSource(1), 'abc');
      assert(delegate.onError.notCalled);
    });

    test('concatenates multiple SOURCE messages with END message', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      const array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE, 'abc');
      // code = 'abc' + 'abc' + 'abc'
      handler.onSourceCode(array);
      handler.onSourceCode(array);
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.notCalled);
      array[0] = SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END;
      // code += 'abc' + END
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.calledOnce);
      // 'abcabcabc' + 'abc' = 'abcabcabcabc'
      assert.strictEqual(handler.getSource(1), 'abcabcabcabc');
      assert(delegate.onError.notCalled);
    });
  });

  suite('onSourceCodeName', () => {
    const delegate = {
      onScriptParsed: sinon.spy(),
      onError: sinon.spy()
    };
    let handler: JerryDebugProtocolHandler;

    test('immediately completes name from END message', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      // name = 'foo' + END
      let array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END, 'foo');
      handler.onSourceCodeName(array);
      // source = 'abc' + END
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'abc');
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.calledOnce);
      const data = delegate.onScriptParsed.args[0][0];
      assert.strictEqual(data.name, 'foo');
      assert(delegate.onError.notCalled);
    });

    test('concatenates multiple NAME messages with END message', () => {
      delegate.onScriptParsed.resetHistory();
      handler = new JerryDebugProtocolHandler(delegate);
      // name = 'foo'
      let array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME, 'foo');
      handler.onSourceCodeName(array);
      // name += 'foo' + END
      array[0] = SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END;
      handler.onSourceCodeName(array);
      // source = 'abc' + END
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'abc');
      handler.onSourceCode(array);
      assert(delegate.onScriptParsed.calledOnce);
      const data = delegate.onScriptParsed.args[0][0];
      // 'foo' + 'foo' = 'foofoo'
      assert.strictEqual(data.name, 'foofoo');
      assert(delegate.onError.notCalled);
    });
  });

  suite('releaseFunction', () => {
    test('updates functions, lineLists, and activeBreakpoints', () => {
      const byteCodeCP = 0;
      const func = {
        scriptId: 7,
        lines: [
          { activeIndex: 3 },
          { activeIndex: -1 },
          { activeIndex: -1 },
        ],
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).functions = [ func ];
      (handler as any).lineLists = {
        7: [[func], ['a', func], [func, 'b']],
      };
      (handler as any).activeBreakpoints = [1, 2, 3, 4, 5];
      handler.releaseFunction(byteCodeCP);
      assert.strictEqual((handler as any).activeBreakpoints[3], undefined);
      assert.strictEqual((handler as any).functions[byteCodeCP], undefined);
      assert.deepStrictEqual((handler as any).lineLists[7], [ [], [ 'a' ], [ 'b' ] ]);
    });
  });

  suite('onBreakpointHit', () => {
    test('calls delegate function if available', () => {
      const delegate = {
        onBreakpointHit: sinon.spy(),
        onError: sinon.spy()
      };
      const handler = new JerryDebugProtocolHandler(delegate);

      let array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 128, 2]);
      handler.onConfiguration(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST, 25, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST, 125, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP, 42, 0]);
      handler.onByteCodeCP(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_HIT, 42, 0, 125, 0, 0, 0]);
      assert(delegate.onBreakpointHit.notCalled);
      handler.onBreakpointHit(array);
      assert(delegate.onBreakpointHit.calledOnce);
      assert(delegate.onError.notCalled);
    });
  });

  suite('onBacktrace', () => {
    const delegate = {
      onBacktrace: sinon.spy(),
      onError: sinon.spy()
    };
    const handler = new JerryDebugProtocolHandler(delegate);

    test('calls delegate function immediately on END event', () => {
      delegate.onBacktrace.resetHistory();
      let array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 128, 2]);
      handler.onConfiguration(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST,
        16, 0, 0, 0,
        25, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST,
        64, 0, 0, 0,
        125, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP, 42, 0]);
      handler.onByteCodeCP(array);

      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BACKTRACE_END, 42, 0, 125, 0, 0, 0]);
      assert(delegate.onBacktrace.notCalled);
      handler.onBacktrace(array);
      assert(delegate.onBacktrace.calledOnce);
      assert(delegate.onError.notCalled);

    });

    test('calls delegate function only on END event', () => {
      delegate.onBacktrace.resetHistory();
      let array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 128, 2]);
      handler.onConfiguration(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST,
        16, 0, 0, 0,
        25, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST,
        64, 0, 0, 0,
        125, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP, 42, 0]);
      handler.onByteCodeCP(array);

      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BACKTRACE, 42, 0, 64, 0, 0, 0]);
      assert(delegate.onBacktrace.notCalled);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BACKTRACE_END, 42, 0, 125, 0, 0, 0]);
      assert(delegate.onBacktrace.notCalled);
      handler.onBacktrace(array);
      assert(delegate.onBacktrace.calledOnce);
      assert(delegate.onError.notCalled);
    });
  });

  suite('onEvalResult', () => {
    test('handles a single END packet', () => {
      const delegate = {
        onEvalResult: sinon.spy(),
        onError: sinon.spy()
      };
      const handler = new JerryDebugProtocolHandler(delegate);
      (handler as any).evalResultData = undefined;
      (handler as any).evalsPending = 1;
      handler.onEvalResult(Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT_END,
        'a'.charCodeAt(0), 'b'.charCodeAt(0), SP.EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK]));
      assert(delegate.onEvalResult.calledOnce);
      assert.strictEqual(delegate.onEvalResult.args[0][0], SP.EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK);
      assert.strictEqual(delegate.onEvalResult.args[0][1], 'ab');
      assert.strictEqual((handler as any).evalResultData, undefined);
      assert.strictEqual((handler as any).evalsPending, 0);
      assert(delegate.onError.notCalled);
    });

    test('handles a partial packet plus an END packet', () => {
      const delegate = {
        onEvalResult: sinon.spy(),
        onError: sinon.spy()
      };
      const handler = new JerryDebugProtocolHandler(delegate);
      (handler as any).evalResultData = undefined;
      (handler as any).evalsPending = 1;
      handler.onEvalResult(Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT,
        'a'.charCodeAt(0), 'b'.charCodeAt(0)]));
      handler.onEvalResult(Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT_END,
        'a'.charCodeAt(0), 'b'.charCodeAt(0), SP.EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK]));
      assert(delegate.onEvalResult.calledOnce);
      assert.strictEqual(delegate.onEvalResult.args[0][0], SP.EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK);
      assert.strictEqual(delegate.onEvalResult.args[0][1], 'abab');
      assert.strictEqual((handler as any).evalResultData, undefined);
      assert.strictEqual((handler as any).evalsPending, 0);
      assert(delegate.onError.notCalled);
    });
  });

  suite('onMessage', () => {
    const delegate = {
      onError: sinon.spy(),
    };
    const handler = new JerryDebugProtocolHandler(delegate);

    test('aborts when message too short', () => {
      delegate.onError.resetHistory();
      handler.onMessage(new Uint8Array(0));
      assert(delegate.onError.calledOnce);
    });

    test('aborts when first message is not configuration', () => {
      delegate.onError.resetHistory();
      const array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 1, 2, 3]);
      handler.onMessage(array);
      assert(delegate.onError.calledOnce);
    });

    test('aborts when unhandled message sent', () => {
      delegate.onError.resetHistory();
      const array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 200, 4]);
      handler.onMessage(array);
      assert(delegate.onError.notCalled);
      array[0] = 255;
      handler.onMessage(array);
      assert(delegate.onError.calledOnce);
    });
  });

  suite('getScriptIdByName', () => {
    test('throws if no sources', () => {
      const handler = new JerryDebugProtocolHandler({});
      assert.throws(() => handler.getScriptIdByName('mozzarella'));
    });

    test('throws if not match for source name', () => {
      const handler = new JerryDebugProtocolHandler({});
      let array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END, 'mozzarella');
      handler.onSourceCodeName(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);

      assert.throws(() => handler.getScriptIdByName('pepperjack'));
    });

    test('returns index match found for source name', () => {
      const handler = new JerryDebugProtocolHandler({});
      let array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END, 'mozzarella');
      handler.onSourceCodeName(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);

      // script IDs are 1-indexed
      assert.strictEqual(handler.getScriptIdByName('mozzarella'), 1);
    });
  });

  suite('getSources', () => {
    test('returns a sources array', () => {
      const sources = [{
        // Dummy, because the sources is 1-indexed
      }, {
        name: 'ble.js',
        source: 'console.log("This is a module...");'
      }, {
        name: 'led-stripe.js',
        source: 'const x = 10;'
      }];

      const handler = new JerryDebugProtocolHandler({});
      (handler as any).sources = sources;

      const result = handler.getSources();
      assert.strictEqual(result[0].name, 'ble.js');
      assert.strictEqual(result[1].source, 'const x = 10;');
      assert.strictEqual(result.length, 2);
    });

    test('returns an empty array', () => {
      const sources = [{
        // Dummy, because the sources is 1-indexed
      }];

      const handler = new JerryDebugProtocolHandler({});
      (handler as any).sources = sources;

      const result = handler.getSources();
      assert.strictEqual(result.length, 0);
    });
  });

  suite('evaluate', () => {
    test('sends single eval packet for short expressions', () => {
      const debugClient = {
        send: sinon.spy(),
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).lastBreakpointHit = true;
      (handler as any).byteConfig = {
        littleEndian: true,
      };
      (handler as any).maxMessageSize = 16;
      (handler as any).debuggerClient = debugClient;
      handler.evaluate('foo');
      assert(debugClient.send.calledOnce);
      assert.deepStrictEqual(debugClient.send.args[0][0], Uint8Array.from([
        SP.CLIENT.JERRY_DEBUGGER_EVAL, 4, 0, 0, 0, 0,
        'f'.charCodeAt(0), 'o'.charCodeAt(0), 'o'.charCodeAt(0),
      ]));
    });

    test('sends two eval packets for longer expression', () => {
      const debugClient = {
        send: sinon.spy(),
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).lastBreakpointHit = true;
      (handler as any).byteConfig = {
        littleEndian: true,
      };
      (handler as any).maxMessageSize = 6;
      (handler as any).debuggerClient = debugClient;
      handler.evaluate('foobar');
      assert(debugClient.send.calledThrice);
      assert.deepStrictEqual(debugClient.send.args[0][0], Uint8Array.from([
        SP.CLIENT.JERRY_DEBUGGER_EVAL, 7, 0, 0, 0, 0,
      ]));
      assert.deepStrictEqual(debugClient.send.args[1][0], Uint8Array.from([
        SP.CLIENT.JERRY_DEBUGGER_EVAL_PART, 'f'.charCodeAt(0), 'o'.charCodeAt(0), 'o'.charCodeAt(0),
        'b'.charCodeAt(0), 'a'.charCodeAt(0),
      ]));
      assert.deepStrictEqual(debugClient.send.args[2][0], Uint8Array.from([
        SP.CLIENT.JERRY_DEBUGGER_EVAL_PART, 'r'.charCodeAt(0),
      ]));
    });
  });

  suite('findBreakpoint', () => {
    test('throws on scriptId 0 with one source', () => {
      const handler = new JerryDebugProtocolHandler({});
      const array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      assert.throws(() => handler.findBreakpoint(0, 5));
    });

    test('throws on scriptId 2 with one source', () => {
      const handler = new JerryDebugProtocolHandler({});
      const array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      assert.throws(() => handler.findBreakpoint(2, 5));
    });

    test('throws on line w/o breakpoint, succeeds on line w/ breakpoint', () => {
      const handler = new JerryDebugProtocolHandler({});
      let array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 128, 2]);
      handler.onConfiguration(array);

      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);

      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST,
        4, 0, 0, 0,
        9, 0, 0, 0,
        16, 0, 0, 0,
        25, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST,
        8, 0, 0, 0,
        27, 0, 0, 0,
        64, 0, 0, 0,
        125, 0, 0, 0]);
      handler.onBreakpointList(array);

      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP, 42, 0]);
      handler.onByteCodeCP(array);
      assert.throws(() => handler.findBreakpoint(1, 6));
      assert.strictEqual(handler.findBreakpoint(1, 4).line, 4);
    });
  });

  suite('getActiveFunctionBreakpointsByScriptId', () => {
    test('return a breakpoints array', () => {
      const name = 'crane.js';
      const scriptId = 11;
      const func = {
        scriptId,
        lines: [
          {
            activeIndex: 3,
            func: { name }
          },
          {
            activeIndex: -1,
            func: { name }
          },
          {
            activeIndex: -1,
            func: { name }
          },
        ],
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).functions = [ func ];
      (handler as any).lineLists = {
        [scriptId]: [[func], ['a', func], [func, 'b']],
      };
      const breakpoints = handler.getActiveFunctionBreakpointsByScriptId(scriptId);
      assert.strictEqual(breakpoints[0].activeIndex, 3);
      assert.strictEqual(breakpoints[0].func.name, name);
      assert.strictEqual(breakpoints.length, 1);
    });

    test('throws error on invalid scriptId (0)', () => {
      const scriptId = 0;
      const handler = new JerryDebugProtocolHandler({});
      assert.throws(() => handler.getActiveFunctionBreakpointsByScriptId(scriptId), 'invalid script id');
    });

    test('throws error on invalid scriptId (greater than linelist length)', () => {
      const scriptId = 4;
      const handler = new JerryDebugProtocolHandler({});
      assert.throws(() => handler.getActiveFunctionBreakpointsByScriptId(scriptId), 'invalid script id');
    });

    test('return an empty array in case of no active functionbreakpoints', () => {
      const name = 'lumbermill.js';
      const scriptId = 1;
      const func = {
        scriptId,
        lines: [
          {
            activeIndex: -1,
            func: { name }
          },
        ],
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).functions = [ func ];
      (handler as any).lineLists = {
        [scriptId]: [[func], ['a', func], [func, 'b']],
      };

      const breakpoints = handler.getActiveFunctionBreakpointsByScriptId(scriptId);
      assert.strictEqual(breakpoints.length, 0);
    });
  });

  suite('getInactiveFunctionBreakpointsByScriptId', () => {
    test('return a breakpoins array', () => {
      const name = 'missing-data.js';
      const scriptId = 9;
      const func = {
        scriptId,
        lines: [
          {
            activeIndex: -1,
            func: { name }
          },
          {
            activeIndex: 4,
            func: { name }
          },
          {
            activeIndex: 5,
            func: { name }
          },
        ],
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).functions = [ func ];
      (handler as any).lineLists = {
        [scriptId]: [[func], ['a', func], [func, 'b']],
      };
      const breakpoints = handler.getInactiveFunctionBreakpointsByScriptId(scriptId);
      assert.strictEqual(breakpoints[0].activeIndex, -1);
      assert.strictEqual(breakpoints[0].func.name, name);
      assert.strictEqual(breakpoints.length, 1);
    });

    test('throws error on invalid scriptId (0)', () => {
      const scriptId = 0;
      const handler = new JerryDebugProtocolHandler({});
      assert.throws(() => handler.getInactiveFunctionBreakpointsByScriptId(scriptId), 'invalid script id');
    });

    test('throws error on invalid scriptId (greater than linelist length)', () => {
      const scriptId = 10;
      const handler = new JerryDebugProtocolHandler({});
      assert.throws(() => handler.getInactiveFunctionBreakpointsByScriptId(scriptId), 'invalid script id');
    });

    test('return an empty array in case of no inactive functionbreakpoints', () => {
      const name = 'dust.js';
      const scriptId = 7;
      const func = {
        scriptId,
        lines: [
          {
            activeIndex: 4,
            func: { name }
          },
        ],
      };
      const handler = new JerryDebugProtocolHandler({});
      (handler as any).functions = [ func ];
      (handler as any).lineLists = {
        [scriptId]: [[func], ['a', func], [func, 'b']],
      };

      const breakpoints = handler.getInactiveFunctionBreakpointsByScriptId(scriptId);
      assert.strictEqual(breakpoints.length, 0);
    });
  });

  suite('updateBreakpoint', () => {
    const debugClient = {
      send: sinon.spy(),
    };

    test('throws on enabling active breakpoint', async () => {
      debugClient.send.resetHistory();
      const bp: any = { activeIndex: 3 };
      const handler = new JerryDebugProtocolHandler({});
      await handler.updateBreakpoint(bp, true)
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'breakpoint already enabled');
        });
    });

    test('throws on disabling inactive breakpoint', async () => {
      debugClient.send.resetHistory();
      const bp: any = { activeIndex: -1 };
      const handler = new JerryDebugProtocolHandler({});
      await handler.updateBreakpoint(bp, false)
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'breakpoint already disabled');
        });
    });

    test('enables inactive breakpoint successfully', async () => {
      const handler = new JerryDebugProtocolHandler({});
      let array = Uint8Array.from([0, 128, 2, 1, 1]);
      handler.onConfiguration(array);
      handler.updateBreakpoint = sinon.stub().resolves(4);

      const bp: any = {
        activeIndex: -1,
        func: {
          byteCodeCP: 42,
        },
        offset: 10,
      };

      const bpAfter: any = {
        ...bp,
        activeIndex: 4
      };

      await handler.updateBreakpoint(bp, true)
        .then(id => {
          assert.strictEqual(id, bpAfter.activeIndex);
        });

      assert.notStrictEqual(bpAfter.activeIndex, -1);
    });

    test('disables active breakpoint successfully', async () => {
      const handler = new JerryDebugProtocolHandler({});
      let array = Uint8Array.from([0, 128, 2, 1, 1]);
      handler.onConfiguration(array);
      handler.updateBreakpoint = sinon.stub().resolves(4);

      const bp: any = {
        activeIndex: 4,
        func: {
          byteCodeCP: 42,
        },
        offset: 10,
      };

      const bpAfter: any = {
        ...bp,
        activeIndex: -1
      };

      await handler.updateBreakpoint(bp, true)
        .then(id => {
          assert.strictEqual(id, 4);
        });

      assert.strictEqual(bpAfter.activeIndex, -1);
    });
  });

  suite('requestBacktrace', () => {
    const debugClient = {
      send: sinon.spy(),
    };

    test('throws if not at a breakpoint', async () => {
      debugClient.send.resetHistory();
      const handler = new JerryDebugProtocolHandler({});
      await handler.requestBacktrace()
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'backtrace not allowed while app running');
        });
    });

    test('sends if at a breakpoint', async () => {
      debugClient.send.resetHistory();
      const handler = new JerryDebugProtocolHandler({});
      handler.debuggerClient = debugClient as any;

      let array = createConfiguration([SP.SERVER.JERRY_DEBUGGER_CONFIGURATION, 1, 128, 2]);
      handler.onConfiguration(array);
      array = encodeArray(SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END, 'code');
      handler.onSourceCode(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST, 25, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST, 125, 0, 0, 0]);
      handler.onBreakpointList(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP, 42, 0]);
      handler.onByteCodeCP(array);
      array = Uint8Array.from([SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_HIT, 42, 0, 125, 0, 0, 0]);
      handler.onBreakpointHit(array);
      assert(debugClient.send.notCalled);
      handler.requestBacktrace();
      assert(debugClient.send.calledOnce);
    });
  });

  suite('stepping', () => {
    test('sends the expected message when calling stepInto()', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      handler.stepInto();
      assert(debugClient.send.withArgs(Uint8Array.from([SP.CLIENT.JERRY_DEBUGGER_STEP])));
    });

    test('sends the expected message when calling stepOut()', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      handler.stepOut();
      assert(debugClient.send.withArgs(Uint8Array.from([SP.CLIENT.JERRY_DEBUGGER_FINISH])));
    });

    test('sends the expected message when calling stepOver()', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      handler.stepOver();
      assert(debugClient.send.withArgs(Uint8Array.from([SP.CLIENT.JERRY_DEBUGGER_NEXT])));
    });

    test('sends the expected message when calling resume()', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      handler.resume();
      assert(debugClient.send.withArgs(Uint8Array.from([SP.CLIENT.JERRY_DEBUGGER_CONTINUE])));
    });

    test('pause() throwing error when pausing at breakpoint', async () => {
      const { handler } = setupHaltedProtocolHandler(true);
      await handler.pause()
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'attempted pause while at breakpoint');
        });
    });

    test('pause() sending the expected message', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      handler.pause();
      assert(debugClient.send.withArgs(Uint8Array.from([SP.CLIENT.JERRY_DEBUGGER_STOP])));
    });
  });

  suite('getLastBreakpoint()', () => {
    test('returns with the correct breakpoint', () => {
      const { handler } = setupHaltedProtocolHandler(true);
      const bp: any = {
        activeIndex: 4,
        func: {
          byteCodeCP: 42,
        },
        offset: 10,
      };
      assert.deepStrictEqual(handler.getLastBreakpoint(), bp);
    });
  });

  suite('sendClientSourceControl()', () => {
    test('throws if index is -1', async () => {
      const handler = new JerryDebugProtocolHandler({});
      await handler.sendClientSourceControl(-1)
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'Invalid source sending control code.');
        });
    });

    test('sends with correct args', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      const defConfig = {
        cpointerSize: 2,
        littleEndian: true,
      };

      const altConfig = {
        cpointerSize: 4,
        littleEndian: true,
      };

      handler.debuggerClient = debugClient as any;
      handler.sendClientSourceControl(10);
      assert(debugClient.send.withArgs(defConfig, 'B', 10));
      assert(debugClient.send.withArgs(altConfig, 'B', 10));
    });

    test('sends with correct args2', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      const defConfig = {
        cpointerSize: 2,
        littleEndian: false,
      };

      const  altConfig = {
        cpointerSize: 4,
        littleEndian: false,
      };

      handler.debuggerClient = debugClient as any;
      handler.sendClientSourceControl(10);
      assert(debugClient.send.withArgs(defConfig, 'B', 10));
      assert(debugClient.send.withArgs(altConfig, 'B', 10));
    });
  });

  suite('sendClientSource()', () => {
    test('throws if waitForSource is not enabled', async () => {
      const handler = new JerryDebugProtocolHandler({});
      await handler.sendClientSource('onelittlekitten', 'and some more')
        .catch(error => {
          assert.strictEqual((<Error>error).message, 'wait-for-source not enabled');
        });
    });

    test('if byteLength is less than maxMessageSize send the array', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      const defConfig = {
        cpointerSize: 2,
        littleEndian: false,
      };

      (handler as any).maxMessageSize = 100;
      let array = stringToCesu8(`onelittlekitten\0and some more`, 5, defConfig );
      (handler as any).onWaitForSource();
      handler.sendClientSource('onelittlekitten', 'and some more');
      assert(debugClient.send.withArgs(array));
    });
  });

  suite('restart()', () => {
    test('sends the correct message', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      const defConfig = {
        cpointerSize: 2,
        littleEndian: false,
        };
      handler.restart();
      let array = stringToCesu8(SP.EVAL_SUBTYPE.JERRY_DEBUGGER_EVAL_ABORT + '\'r353t\'', 1 + 4, defConfig);
      array[0] = SP.CLIENT.JERRY_DEBUGGER_EVAL;
      assert(debugClient.send.withArgs(array));
    });

    test('sends the correct message2', () => {
      const { handler, debugClient } = setupHaltedProtocolHandler();
      const altConfig = {
        cpointerSize: 4,
        littleEndian: false,
        };
      handler.restart();
      let array = stringToCesu8(SP.EVAL_SUBTYPE.JERRY_DEBUGGER_EVAL_ABORT + '\'r353t\'', 1 + 4, altConfig);
      array[0] = SP.CLIENT.JERRY_DEBUGGER_EVAL;
      assert(debugClient.send.withArgs(array));
    });
  });
});
