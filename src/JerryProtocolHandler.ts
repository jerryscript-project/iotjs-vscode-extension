/*
 * Copyright 2018-present Samsung Electronics Co., Ltd. and other contributors
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as SP from './JerryProtocolConstants';
import { Breakpoint, ParsedFunction } from './JerryBreakpoints';
import {
  ByteConfig, cesu8ToString, assembleUint8Arrays,
  decodeMessage, encodeMessage, stringToCesu8, setUint32
} from './JerryUtils';
import { JerryDebuggerClient } from './JerryDebuggerClient';

export type CompressedPointer = number;
export type ByteCodeOffset = number;
export type LoggerFunction = (message: any) => void;

export interface ParserStackFrame {
  isFunc: boolean;
  scriptId: number;
  line: number;
  column: number;
  name: string;
  source: string;
  sourceName?: string;
  lines: Array<number>;
  offsets: Array<ByteCodeOffset>;
  byteCodeCP?: CompressedPointer;
  firstBreakpointLine?: number;
  firstBreakpointOffset?: ByteCodeOffset;
}

export interface JerryDebugProtocolDelegate {
  onBacktrace?(backtrace: Array<Breakpoint>): void;
  onBreakpointHit?(message: JerryMessageBreakpointHit, stopType: string): void;
  onExceptionHit?(message: JerryMessageExceptionHit): void;
  onEvalResult?(subType: number, result: string): void;
  onError?(code: number, message: string): void;
  onResume?(): void;
  onScriptParsed?(message: JerryMessageScriptParsed): void;
  onWaitForSource?(): void;
}

export interface JerryMessageSource {
  name: string;
  source: string;
}

export interface JerryMessageScriptParsed {
  id: number;
  name: string;
  lineCount: number;
}

export interface JerryMessageBreakpointHit {
  breakpoint: Breakpoint;
  exact: boolean;
}

export interface JerryMessageExceptionHit {
  breakpoint: Breakpoint;
  exact: boolean;
  message: string;
}

export interface JerryEvalResult {
  subtype: number;
  value: string;
}

interface ProtocolFunctionMap {
  [type: number]: (data: Uint8Array) => void;
}

interface FunctionMap {
  [cp: string]: ParsedFunction;
}

interface LineFunctionMap {
  // maps line number to an array of functions
  [line: number]: Array<ParsedFunction>;
}

interface ParsedSource {
  name?: string;
  source?: string;
}

interface StopTypeMap {
  [type: number]: string;
}

class PendingRequest {
  public data: Uint8Array;
  public promise: Promise<any>;
  public resolve: (arg?: any) => void;
  public reject: (arg?: any) => void;

  public constructor(data: Uint8Array) {
    this.data = data;
    this.promise = new Promise<any>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

// abstracts away the details of the protocol
export class JerryDebugProtocolHandler {
  public debuggerClient?: JerryDebuggerClient;
  private delegate: JerryDebugProtocolDelegate;

  // debugger configuration
  private maxMessageSize: number = 0;
  private byteConfig: ByteConfig;
  private version: number = 0;
  private functionMap: ProtocolFunctionMap;

  private stack: Array<ParserStackFrame> = [];
  // first element is a dummy because sources is 1-indexed
  private sources: Array<ParsedSource> = [{}];
  // first element is a dummy because lineLists is 1-indexed
  private lineLists: Array<LineFunctionMap> = [[]];
  private source: string = '';
  private sourceData?: Uint8Array;
  private sourceName?: string;
  private sourceNameData?: Uint8Array;
  private functionName?: string;
  private functionNameData?: Uint8Array;
  private evalResultData?: Uint8Array;
  private functions: FunctionMap = {};
  private newFunctions: FunctionMap = {};
  private backtrace: Array<Breakpoint> = [];

  private nextScriptID: number = 1;
  private exceptionData?: Uint8Array;
  private exceptionString?: string;
  private evalsPending: number = 0;
  private lastBreakpointHit?: Breakpoint;
  private lastBreakpointExact: boolean = true;
  private activeBreakpoints: Array<Breakpoint> = [];
  private nextBreakpointIndex: number = 0;
  private waitForSourceEnabled: boolean = false;

  private log: LoggerFunction;
  private requestQueue: PendingRequest[];
  private currentRequest: PendingRequest;
  private stopTypeMap: StopTypeMap;
  private lastStopType: number;

  constructor(delegate: JerryDebugProtocolDelegate, log?: LoggerFunction) {
    this.delegate = delegate;
    this.log = log || <any>(() => {});

    this.byteConfig = {
      cpointerSize: 0,
      littleEndian: true,
    };

    this.functionMap = {
      [SP.SERVER.JERRY_DEBUGGER_CONFIGURATION]: this.onConfiguration,
      [SP.SERVER.JERRY_DEBUGGER_BYTE_CODE_CP]: this.onByteCodeCP,
      [SP.SERVER.JERRY_DEBUGGER_PARSE_FUNCTION]: this.onParseFunction,
      [SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST]: this.onBreakpointList,
      [SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_OFFSET_LIST]: this.onBreakpointList,
      [SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE]: this.onSourceCode,
      [SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END]: this.onSourceCode,
      [SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME]: this.onSourceCodeName,
      [SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END]: this.onSourceCodeName,
      [SP.SERVER.JERRY_DEBUGGER_FUNCTION_NAME]: this.onFunctionName,
      [SP.SERVER.JERRY_DEBUGGER_FUNCTION_NAME_END]: this.onFunctionName,
      [SP.SERVER.JERRY_DEBUGGER_RELEASE_BYTE_CODE_CP]: this.onReleaseByteCodeCP,
      [SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_HIT]: this.onBreakpointHit,
      [SP.SERVER.JERRY_DEBUGGER_EXCEPTION_HIT]: this.onBreakpointHit,
      [SP.SERVER.JERRY_DEBUGGER_EXCEPTION_STR]: this.onExceptionStr,
      [SP.SERVER.JERRY_DEBUGGER_EXCEPTION_STR_END]: this.onExceptionStr,
      [SP.SERVER.JERRY_DEBUGGER_BACKTRACE]: this.onBacktrace,
      [SP.SERVER.JERRY_DEBUGGER_BACKTRACE_END]: this.onBacktrace,
      [SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT]: this.onEvalResult,
      [SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT_END]: this.onEvalResult,
      [SP.SERVER.JERRY_DEBUGGER_WAIT_FOR_SOURCE]: this.onWaitForSource
    };

    this.requestQueue = [];
    this.currentRequest = null;

    this.stopTypeMap = {
      [SP.CLIENT.JERRY_DEBUGGER_NEXT]: 'step',
      [SP.CLIENT.JERRY_DEBUGGER_STEP]: 'step-in',
      [SP.CLIENT.JERRY_DEBUGGER_FINISH]: 'step-out',
      [SP.CLIENT.JERRY_DEBUGGER_CONTINUE]: 'continue',
      [SP.CLIENT.JERRY_DEBUGGER_STOP]: 'pause',
    };
    this.lastStopType = null;
  }

  // FIXME: this lets test suite run for now
  public unused(): void {
    // tslint:disable-next-line no-unused-expression
    this.lastBreakpointExact;
  }

  public stepOver(): Promise<any> {
    return this.resumeExec(SP.CLIENT.JERRY_DEBUGGER_NEXT);
  }

  public stepInto(): Promise<any> {
    return this.resumeExec(SP.CLIENT.JERRY_DEBUGGER_STEP);
  }

  public stepOut(): Promise<any> {
    return this.resumeExec(SP.CLIENT.JERRY_DEBUGGER_FINISH);
  }

  public pause(): Promise<any> {
    if (this.lastBreakpointHit) {
      return Promise.reject(new Error('attempted pause while at breakpoint'));
    }

    this.lastStopType = SP.CLIENT.JERRY_DEBUGGER_STOP;
    return this.sendSimpleRequest(encodeMessage(this.byteConfig, 'B', [SP.CLIENT.JERRY_DEBUGGER_STOP]));
  }

  public resume(): Promise<any> {
    return this.resumeExec(SP.CLIENT.JERRY_DEBUGGER_CONTINUE);
  }

  public getPossibleBreakpoints(scriptId: number, startLine: number, endLine?: number): Array<Breakpoint> {
    const array = [];
    const lineList = this.lineLists[scriptId];
    for (const line in lineList) {
      const linenum = Number(line);
      if (linenum >= startLine) {
        if (!endLine || linenum <= endLine) {
          for (const func of lineList[line]) {
            array.push(func.lines[line]);
          }
        }
      }
    }
    return array;
  }

  public getSource(scriptId: number): string {
    if (scriptId < this.sources.length) {
      return this.sources[scriptId].source || '';
    }
    return '';
  }

  public decodeMessage(format: string, message: Uint8Array, offset: number): any {
    return decodeMessage(this.byteConfig, format, message, offset);
  }

  public onConfiguration(data: Uint8Array): void {
    this.logPacket('Configuration');
    if (data.length < 5) {
      this.abort('configuration message wrong size');
      return;
    }

    this.maxMessageSize = data[1];
    this.byteConfig.cpointerSize = data[2];
    this.byteConfig.littleEndian = Boolean(data[3]);
    this.version = data[4];

    if (this.byteConfig.cpointerSize !== 2 && this.byteConfig.cpointerSize !== 4) {
      this.abort('compressed pointer must be 2 or 4 bytes long');
    }

    if (this.version !== SP.JERRY_DEBUGGER_VERSION) {
      this.abort(`incorrect target debugger version detected: ${this.version} expected: ${SP.JERRY_DEBUGGER_VERSION}`);
    }
  }

  public onByteCodeCP(data: Uint8Array): void {
    this.logPacket('Byte Code CP', true);
    if (this.evalsPending) {
      return;
    }

    const frame = this.stack.pop();
    if (!frame) {
      throw new Error('missing parser stack frame');
    }

    const byteCodeCP = this.decodeMessage('C', data, 1)[0];
    const func = new ParsedFunction(byteCodeCP, frame);

    this.newFunctions[byteCodeCP] = func;
    if (this.stack.length > 0) {
      return;
    }

    // FIXME: it seems like this is probably unnecessarily keeping the
    //   whole file's source to this point?
    func.source = this.source.split(/\n/);
    func.sourceName = this.sourceName;
    this.source = '';
    this.sourceName = undefined;

    const lineList: LineFunctionMap = {};
    for (const cp in this.newFunctions) {
      const func = this.newFunctions[cp];
      this.functions[cp] = func;

      for (const i in func.lines) {
        // map line numbers to functions for this source
        if (i in lineList) {
          lineList[i].push(func);
        } else {
          lineList[i] = [func];
        }
      }
    }
    this.lineLists.push(lineList);
    this.nextScriptID++;
    this.newFunctions = {};
  }

  public onParseFunction(data: Uint8Array): void {
    this.logPacket('Parse Function');
    const position = this.decodeMessage('II', data, 1);
    this.stack.push({
      isFunc: true,
      scriptId: this.nextScriptID,
      line: position[0],
      column: position[1],
      name: this.functionName || '',
      source: this.source,
      sourceName: this.sourceName,
      lines: [],
      offsets: [],
    });
    this.functionName = undefined;
    return;
  }

  public onBreakpointList(data: Uint8Array): void {
    this.logPacket('Breakpoint List', true);
    if (this.evalsPending) {
      return;
    }

    if (data.byteLength % 4 !== 1 || data.byteLength < 1 + 4) {
      throw new Error('unexpected breakpoint list message length');
    }

    let array: Array<number> = [];
    const stackFrame = this.stack[this.stack.length - 1];
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_LIST) {
      array = stackFrame.lines;
    } else {
      array = stackFrame.offsets;
    }

    for (let i = 1; i < data.byteLength; i += 4) {
      array.push(this.decodeMessage('I', data, i)[0]);
    }
  }

  public onSourceCode(data: Uint8Array): void {
    this.logPacket('Source Code', true);
    if (this.evalsPending) {
      return;
    }

    if (this.stack.length === 0) {
      this.stack = [{
        isFunc: false,
        scriptId: this.nextScriptID,
        line: 1,
        column: 1,
        name: '',
        source: '',
        lines: [],
        offsets: [],
      }];
    }

    this.sourceData = assembleUint8Arrays(this.sourceData, data);
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_END) {
      this.source = cesu8ToString(this.sourceData);
      this.sources[this.nextScriptID] = {
        name: this.sourceName,
        source: this.source,
      };
      this.sourceData = undefined;
      if (this.delegate.onScriptParsed) {
        this.delegate.onScriptParsed({
          'id': this.nextScriptID,
          'name': this.sourceName || '',
          'lineCount': this.source.split(/\n/).length,
        });
      }
    }
  }

  public onSourceCodeName(data: Uint8Array): void {
    this.logPacket('Source Code Name');
    this.sourceNameData = assembleUint8Arrays(this.sourceNameData, data);
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_SOURCE_CODE_NAME_END) {
      this.sourceName = cesu8ToString(this.sourceNameData);
      this.sourceNameData = undefined;
      // TODO: test that this is completed before source and included in the
      //   onScriptParsed delegate function called in onSourceCode, or abort
    }
  }

  private onFunctionName(data: Uint8Array): void {
    this.logPacket('Function Name');
    this.functionNameData = assembleUint8Arrays(this.functionNameData, data);
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_FUNCTION_NAME_END) {
      this.functionName = cesu8ToString(this.functionNameData);
      this.functionNameData = undefined;
    }
  }

  public releaseFunction(byteCodeCP: number): void {
    const func = this.functions[byteCodeCP];

    const lineList = this.lineLists[func.scriptId];
    for (const i in func.lines) {
      const array = lineList[i];
      const index = array.indexOf(func);
      array.splice(index, 1);

      const breakpoint = func.lines[i];
      if (breakpoint.activeIndex >= 0) {
        delete this.activeBreakpoints[breakpoint.activeIndex];
      }
    }

    delete this.functions[byteCodeCP];
  }

  private onReleaseByteCodeCP(data: Uint8Array): void {
    this.logPacket('Release Byte Code CP', true);
    if (!this.evalsPending) {
      const byteCodeCP = this.decodeMessage('C', data, 1)[0];
      if (byteCodeCP in this.newFunctions) {
        delete this.newFunctions[byteCodeCP];
      } else {
        this.releaseFunction(byteCodeCP);
      }
    }

    // just patch up incoming message
    data[0] = SP.CLIENT.JERRY_DEBUGGER_FREE_BYTE_CODE_CP;
    this.sendSimpleRequest(data);
  }

  private getBreakpoint(breakpointData: Array<number>): JerryMessageBreakpointHit {
    const func = this.functions[breakpointData[0]];
    const offset = breakpointData[1];

    if (offset in func.offsets) {
      return {
        breakpoint: func.offsets[offset],
        exact: true,
      };
    }

    if (offset < func.firstBreakpointOffset) {
      return {
        breakpoint: func.offsets[func.firstBreakpointOffset],
        exact: true,
      };
    }

    let nearestOffset = -1;
    for (const currentOffset in func.offsets) {
      const current = Number(currentOffset);
      if ((current <= offset) && (current > nearestOffset)) {
        nearestOffset = current;
      }
    }

    return {
      breakpoint: func.offsets[nearestOffset],
      exact: false,
    };
  }

  public onBreakpointHit(data: Uint8Array): void {
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_BREAKPOINT_HIT) {
      this.logPacket('Breakpoint Hit');
    } else {
      this.logPacket('Exception Hit');
    }
    const breakpointData = this.decodeMessage('CI', data, 1);
    const breakpointRef = this.getBreakpoint(breakpointData);
    const breakpoint = breakpointRef.breakpoint;

    this.lastBreakpointHit = breakpoint;
    this.lastBreakpointExact = breakpointRef.exact;

    let breakpointInfo = '';
    if (breakpoint.activeIndex >= 0) {
      breakpointInfo = `breakpoint:${breakpoint.activeIndex} `;
    }

    const atAround = breakpointRef.exact ? 'at' : 'around';
    this.log(`Stopped ${atAround} ${breakpointInfo}${breakpoint}`);

    if (data[0] === SP.SERVER.JERRY_DEBUGGER_EXCEPTION_HIT) {
      this.log('Exception throw detected');
      if (this.exceptionString) {
        this.log(`Exception hint: ${this.exceptionString}`);
      }

      if (this.delegate.onExceptionHit) {
        this.delegate.onExceptionHit({
          'breakpoint': breakpoint,
          'exact': breakpointRef.exact,
          'message': this.exceptionString,
        });
        this.exceptionString = undefined;
        return;
      }
    }

    if (this.delegate.onBreakpointHit) {
      const stopTypeText = this.stopTypeMap[this.lastStopType] || 'entry';
      const stopType = `${breakpoint.activeIndex === -1 ? 'inactive ' : ''}breakpoint (${stopTypeText})`;
      this.delegate.onBreakpointHit(breakpointRef, stopType);
    }

    this.lastStopType = null;
  }

  public onBacktrace(data: Uint8Array): Breakpoint[] {
    this.logPacket('Backtrace');
    for (let i = 1; i < data.byteLength; i += this.byteConfig.cpointerSize + 4) {
      const breakpointData = this.decodeMessage('CI', data, i);
      this.backtrace.push(this.getBreakpoint(breakpointData).breakpoint);
    }

    if (data[0] === SP.SERVER.JERRY_DEBUGGER_BACKTRACE_END) {
      if (this.delegate.onBacktrace) {
        this.delegate.onBacktrace(this.backtrace);
      }

      const bt = this.backtrace;
      this.backtrace = [];

      return bt;
    }

    return [];
  }

  public onEvalResult(data: Uint8Array): JerryEvalResult {
    this.logPacket('Eval Result');

    const result: JerryEvalResult = {
      subtype: -1,
      value: ''
    };

    this.evalResultData = assembleUint8Arrays(this.evalResultData, data);
    if (data[0] === SP.SERVER.JERRY_DEBUGGER_EVAL_RESULT_END) {
      const subType = data[data.length - 1];
      const evalResult = cesu8ToString(this.evalResultData.slice(0, -1));

      if (this.delegate.onEvalResult) {
        this.delegate.onEvalResult(subType, evalResult);
      }

      this.evalResultData = undefined;
      this.evalsPending--;

      result.subtype = subType;
      result.value = evalResult;
    }

    return result;
  }

  public onMessage(message: Uint8Array): void {
    if (message.byteLength < 1) {
      this.abort('message too short');
      return;
    }

    if (this.byteConfig.cpointerSize === 0) {
      if (message[0] !== SP.SERVER.JERRY_DEBUGGER_CONFIGURATION) {
        this.abort('the first message must be configuration');
        return;
      }
    }

    const request = this.currentRequest;
    const handler = this.functionMap[message[0]];

    if (handler) {
      const result = handler.call(this, message) || false;
      if (request && result) {
        request.resolve(result);

        // Process the queued requests.
        if (this.requestQueue.length > 0) {
          const newRequest = this.requestQueue.shift();

          if (!this.submitRequest(newRequest)) {
            newRequest.reject('Failed to submit request.');
          }
        } else {
          this.currentRequest = null;
        }
      }
    } else {
      if (request) request.reject(`unhandled protocol message type: ${message[0]}`);
      this.abort(`unhandled protocol message type: ${message[0]}`);
    }
  }

  public getLastBreakpoint(): Breakpoint {
    return this.lastBreakpointHit;
  }

  public getScriptIdByName(name: string): number {
    const index = this.sources.findIndex(s => s.name && s.name.endsWith(name));
    if (index > 0) return index;
    throw new Error('no such source');
  }

  public getActiveBreakpoint(breakpointId: number): Breakpoint {
    return this.activeBreakpoints[breakpointId];
  }

  public getActiveBreakpointsByScriptId(scriptId: number): Breakpoint[] {
    return this.activeBreakpoints.filter(b => b.scriptId === scriptId);
  }

  public evaluate(expression: string): Promise<any> {
    if (!this.lastBreakpointHit) {
      return Promise.reject(new Error('attempted eval while not at breakpoint'));
    }

    this.evalsPending++;

    // send an _EVAL message prefixed with the byte length, followed by _EVAL_PARTs if necessary
    const array = stringToCesu8(SP.EVAL_SUBTYPE.JERRY_DEBUGGER_EVAL_EVAL + expression, 1 + 4, this.byteConfig);
    const arrayLength = array.byteLength;
    const byteLength = arrayLength - 1 - 4;
    array[0] = SP.CLIENT.JERRY_DEBUGGER_EVAL;
    setUint32(this.byteConfig.littleEndian, array, 1, byteLength);

    let offset = 0;
    let request: Promise<any> = null;
    while (offset < arrayLength - 1) {
      const clamped = Math.min(arrayLength - offset, this.maxMessageSize);
      request = this.sendRequest(array.slice(offset, offset + clamped));
      offset += clamped - 1;
      array[offset] = SP.CLIENT.JERRY_DEBUGGER_EVAL_PART;
    }

    return request;
  }

  public findBreakpoint(scriptId: number, line: number, column: number = 0): Breakpoint {
    if (scriptId <= 0 || scriptId >= this.lineLists.length) {
      throw new Error('invalid script id');
    }

    const lineList = this.lineLists[scriptId];
    if (!lineList[line]) {
      throw new Error(`no breakpoint found for line: ${line}`);
    }

    for (const func of lineList[line]) {
      const breakpoint = func.lines[line];
      // TODO: when we start handling columns we would need to distinguish them
      return breakpoint;
    }

    throw new Error('no breakpoint found');
  }

  public updateBreakpoint(breakpoint: Breakpoint, enable: boolean): Promise<number> {
    let breakpointId;

    if (enable) {
      if (breakpoint.activeIndex !== -1) {
        return Promise.reject(new Error('breakpoint already enabled'));
      }
      breakpointId = breakpoint.activeIndex = this.nextBreakpointIndex++;
      this.activeBreakpoints[breakpointId] = breakpoint;
    } else {
      if (breakpoint.activeIndex === -1) {
        return Promise.reject(new Error('breakpoint already disabled'));
      }
      breakpointId = breakpoint.activeIndex;
      delete this.activeBreakpoints[breakpointId];
      breakpoint.activeIndex = -1;
    }

    return this.sendSimpleRequest(encodeMessage(this.byteConfig, 'BBCI', [
      SP.CLIENT.JERRY_DEBUGGER_UPDATE_BREAKPOINT,
      Number(enable),
      breakpoint.func.byteCodeCP,
      breakpoint.offset,
    ]));
  }

  public requestBacktrace(): Promise<any> {
    if (!this.lastBreakpointHit) {
      return Promise.reject(new Error('backtrace not allowed while app running'));
    }
    return this.sendRequest(encodeMessage(this.byteConfig, 'BI', [SP.CLIENT.JERRY_DEBUGGER_GET_BACKTRACE, 0]));
  }

  logPacket(description: string, ignorable: boolean = false) {
    // certain packets are ignored while evals are pending
    const ignored = (ignorable && this.evalsPending) ? 'Ignored: ' : '';
    this.log(`[Protocol Handler] ${ignored}${description}`);
  }

  private abort(message: string) {
    if (this.delegate.onError) {
      this.log(`Abort: ${message}`);
      this.delegate.onError(0, message);
    }
  }

  private resumeExec(code: number): Promise<any> {
    if (!this.lastBreakpointHit) {
      return Promise.reject(new Error('attempted resume while not at breakpoint'));
    }

    this.lastBreakpointHit = undefined;
    this.lastStopType = code;
    const result = this.sendSimpleRequest(encodeMessage(this.byteConfig, 'B', [code]));

    if (this.delegate.onResume) {
      this.delegate.onResume();
    }

    return result;
  }

  public sendClientSource(fileName: string, fileSourceCode: string): Promise<any> {
    if (!this.waitForSourceEnabled) {
      return Promise.reject(new Error('wait-for-source not enabled'));
    }

    this.waitForSourceEnabled = false;
    let array = stringToCesu8(`${fileName}\0${fileSourceCode}`, 5, this.byteConfig );
    const byteLength = array.byteLength;

    array[0] = SP.CLIENT.JERRY_DEBUGGER_CLIENT_SOURCE;

    if (byteLength <= this.maxMessageSize) {
      return this.sendSimpleRequest(array);
    }

    let result = this.sendSimpleRequest(array.slice(0, this.maxMessageSize));

    let offset = this.maxMessageSize - 1;

    while (offset < byteLength) {
      array[offset] = SP.CLIENT.JERRY_DEBUGGER_CLIENT_SOURCE_PART;
      result = this.sendSimpleRequest(array.slice(offset, offset + this.maxMessageSize));
      offset += this.maxMessageSize - 1;
    }

    return result;
  }

  public sendClientSourceControl(code: number): Promise<any> {
    const validCodes: number[] = [SP.CLIENT.JERRY_DEBUGGER_NO_MORE_SOURCES, SP.CLIENT.JERRY_DEBUGGER_CONTEXT_RESET];

    if (validCodes.indexOf(code) === -1) {
      return Promise.reject(new Error('Invalid source sending control code.'));
    }

    return this.sendSimpleRequest(encodeMessage(this.byteConfig, 'B', [code]));
  }

  public onWaitForSource(): void {
    this.waitForSourceEnabled = true;
    if (this.delegate.onWaitForSource) {
      this.delegate.onWaitForSource();
    }
  }

  private sendRequest(data: Uint8Array): Promise<any> {
    const request = new PendingRequest(data);

    if (this.currentRequest !== null) {
      this.requestQueue = [...this.requestQueue, request];
    } else {
      if (!this.submitRequest(request)) {
        return Promise.reject(new Error('Failed to submit request.'));
      }
    }

    return request.promise;
  }

  private sendSimpleRequest(data: Uint8Array): Promise<any> {
    const request = new PendingRequest(data);

    if (!this.submitRequest(request, true)) {
      return Promise.reject(new Error('Failed to submit request.'));
    }

    return Promise.resolve();
  }

  private submitRequest(request: PendingRequest, simple: boolean = false): boolean {
    if (!this.debuggerClient!.send(request.data)) return false;
    if (!simple) this.currentRequest = request;
    return true;
  }

  private onExceptionStr(data: Uint8Array): void {
      this.logPacket('onExceptionStr');
      this.exceptionData = assembleUint8Arrays(this.exceptionData, data);
      if (data[0] === SP.SERVER.JERRY_DEBUGGER_EXCEPTION_STR_END) {
        this.exceptionString = cesu8ToString(this.exceptionData);
        this.exceptionData = undefined;
      }
    }
}
