/*
 * Copyright 2018-present Samsung Electronics Co., Ltd. and other contributors
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

'use strict';

import {
  DebugSession, InitializedEvent, OutputEvent, Thread, Source,
  StoppedEvent, StackFrame, TerminatedEvent, Event, ErrorDestination
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as Fs from 'fs';
import * as Path from 'path';
import * as Util from 'util';
import { IAttachRequestArguments, SourceSendingOptions, TemporaryBreakpoint } from './IotjsDebuggerInterfaces';
import { JerryDebuggerClient, JerryDebuggerOptions } from './JerryDebuggerClient';
import {
  JerryDebugProtocolDelegate, JerryDebugProtocolHandler, JerryMessageScriptParsed, JerryEvalResult,
  JerryMessageExceptionHit, JerryMessageBreakpointHit
} from './JerryProtocolHandler';
import { EVAL_RESULT_SUBTYPE, CLIENT as CLIENT_PACKAGE } from './JerryProtocolConstants';
import { Breakpoint } from './JerryBreakpoints';
import { SOURCE_SENDING_STATES, LOG_LEVEL } from './IotjsDebuggerConstants';

class IotjsDebugSession extends DebugSession {

  // We don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static THREAD_ID = 1;

  private _args: IAttachRequestArguments;
  private _debugLog: number = 0;
  private _debuggerClient: JerryDebuggerClient;
  private _protocolhandler: JerryDebugProtocolHandler;
  private _sourceSendingOptions: SourceSendingOptions;

  public constructor() {
    super();

    // The debugger uses zero-based lines and columns.
    this.setDebuggerLinesStartAt1(false);
    this.setDebuggerColumnsStartAt1(false);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    // Runtime supports now threads so just return a default thread.
    response.body = {
      threads: [
        new Thread(IotjsDebugSession.THREAD_ID, 'Main Thread')
      ]
    };
    this.sendResponse(response);
  }

  /**
   * The 'initialize' request is the first request called by the frontend
   * to interrogate the debug adapter about the features it provides.
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments
  ): void {
    // This debug adapter implements the configurationDoneRequest.
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsEvaluateForHovers = false;
    response.body.supportsStepBack = false;
    response.body.supportsRestartRequest = false;
    response.body.supportsDelayedStackTraceLoading = false;

    this._sourceSendingOptions = <SourceSendingOptions>{
      contextReset: false,
      state: SOURCE_SENDING_STATES.NOP
    };

    this.sendResponse(response);
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    super.configurationDoneRequest(response, args);
  }

  protected attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments): void {

    if (!args.address || args.address === '') {
      this.sendErrorResponse(response, new Error('Must specify an address'));
      return;
    }

    if (!args.port || args.port <= 0 || args.port > 35535) {
      this.sendErrorResponse(response, new Error('Must specify a valid port'));
      return;
    }

    if (!args.localRoot || args.localRoot === '') {
      this.sendErrorResponse(response, new Error('Must specify a localRoot'));
      return;
    }

    this._args = args;
    if (args.debugLog && args.debugLog in LOG_LEVEL) {
      this._debugLog = args.debugLog;
    } else {
      this.sendErrorResponse(response, new Error('No log level given'));
    }

    const protocolDelegate = <JerryDebugProtocolDelegate>{
      onBreakpointHit: (ref: JerryMessageBreakpointHit, type: string) => this.onBreakpointHit(ref, type),
      onExceptionHit: (data: JerryMessageExceptionHit) => this.onExceptionHit(data),
      onScriptParsed: (data: JerryMessageScriptParsed) => this.onScriptParsed(data),
      onWaitForSource: () => this.onWaitForSource()
    };

    this._protocolhandler = new JerryDebugProtocolHandler(
      protocolDelegate, (message: any, level: number = LOG_LEVEL.VERBOSE) => this.log(message, level)
    );
    this._debuggerClient = new JerryDebuggerClient(<JerryDebuggerOptions>{
      delegate: {
        onMessage: (message: Uint8Array) => this._protocolhandler.onMessage(message),
        onClose: () => this.onClose()
      },
      host: args.address,
      port: args.port
    });
    this._protocolhandler.debuggerClient = this._debuggerClient;

    this._debuggerClient.connect()
      .then(() => {
        this.log(`Connected to: ${args.address}:${args.port}`, LOG_LEVEL.SESSION);
        this.sendResponse(response);
      })
      .catch(error => {
        this.log(error, LOG_LEVEL.ERROR);
        this.sendErrorResponse(response, error);
      })
      .then(() => {
        this.sendEvent(new InitializedEvent());
      });
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
    this.sendErrorResponse(response, new Error('Launching is not supported. Use Attach.'));
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments
  ): void {
    this._debuggerClient.disconnect();

    this.sendEvent(new TerminatedEvent());
    this.sendResponse(response);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
    this.log('restartRequest: Not implemented yet', LOG_LEVEL.SESSION);

    this.sendResponse(response);
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
    this._protocolhandler.resume()
      .then(() => {
        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, <Error>error));
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
    this._protocolhandler.stepOver()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, <Error>error));
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
    this._protocolhandler.stepInto()
      .then(() => {
        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, <Error>error));
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
    this._protocolhandler.stepOut()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, <Error>error));
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
    this._protocolhandler.pause()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, <Error>error));
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    const filename: string = args.source.name;
    const vscodeBreakpoints: DebugProtocol.Breakpoint[] = args.breakpoints!.map(b => ({verified: false, line: b.line}));

    try {
      const scriptId: number = this._protocolhandler.getScriptIdByName(filename);
      const activeBps: Breakpoint[] = this._protocolhandler.getActiveBreakpointsByScriptId(scriptId);

      // Get the new breakpoints.
      const activeBpsLines: number[] = activeBps.map(b => b.line);
      const newBps: DebugProtocol.Breakpoint[] = vscodeBreakpoints.filter(b => activeBpsLines.indexOf(b.line) === -1);

      const newBreakpoints: TemporaryBreakpoint[] = await Promise.all(newBps.map(async (breakpoint, index) => {
        try {
          const jerryBreakpoint: Breakpoint = this._protocolhandler.findBreakpoint(scriptId, breakpoint.line);
          await this._protocolhandler.updateBreakpoint(jerryBreakpoint, true);
          return <TemporaryBreakpoint>{verified: true, line: breakpoint.line};
        } catch (error) {
          this.log(error, LOG_LEVEL.ERROR);
          return <TemporaryBreakpoint>{verified: false, line: breakpoint.line, message: (<Error>error).message};
        }
      }));

      // Get the persists breakpoints.
      const newBreakpointsLines: number[] = newBreakpoints.map(b => b.line);
      const persistingBreakpoints: TemporaryBreakpoint[] = vscodeBreakpoints
                                    .filter(b => newBreakpointsLines.indexOf(b.line) === -1)
                                    .map(b => ({verified: true, line: b.line}));

      // Get the removalbe breakpoints.
      const vscodeBreakpointsLines: number[] = vscodeBreakpoints.map(b => b.line);
      const removeBps: Breakpoint[] = activeBps.filter(b => vscodeBreakpointsLines.indexOf(b.line) === -1);

      removeBps.forEach(async b => {
        const jerryBreakpoint = this._protocolhandler.findBreakpoint(scriptId, b.line);
        await this._protocolhandler.updateBreakpoint(jerryBreakpoint, false);
      });

      response.body = { breakpoints: [...persistingBreakpoints, ...newBreakpoints] };
    } catch (error) {
      this.log(error, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, <Error>error);
      return;
    }

    this.sendResponse(response);
  }

  protected async evaluateRequest(
    response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments
  ): Promise<void> {
    try {
      const result: JerryEvalResult = await this._protocolhandler.evaluate(args.expression);
      const value: string = result.subtype === EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK
                            ? result.value
                            : 'Evaluate Error';

      response.body = {
        result: value,
        variablesReference: 0
      };

      this.sendResponse(response);
    } catch (error) {
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
  }

  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments
  ): Promise<void> {
    try {
      const backtrace = await this._protocolhandler.requestBacktrace();
      const stk = backtrace.map((f, i) => new StackFrame(
          1000 + i,
          f.func.name || 'global',
          this.pathToSource(`${this._args.localRoot}/${this.pathToBasename(f.func.sourceName)}`),
          f.line,
          f.func.column
        )
      );

      response.body = {
        stackFrames: stk,
      };

      this.sendResponse(response);
    } catch (error) {
      this.log(error);
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
  }

  protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
    switch (command) {
      case 'sendSource': {
        this._sourceSendingOptions.state = SOURCE_SENDING_STATES.IN_PROGRESS;
        this._protocolhandler.sendClientSource(args.program.name, args.program.source)
          .then(() => {
            this.log('Source has been sent to the engine.', LOG_LEVEL.SESSION);
            this._sourceSendingOptions.state = SOURCE_SENDING_STATES.LAST_SENT;
            this.sendResponse(response);
          })
          .catch(error => {
            this.log(error, LOG_LEVEL.ERROR);
            this._sourceSendingOptions.state = SOURCE_SENDING_STATES.NOP;
            this.sendErrorResponse(response, <Error>error, ErrorDestination.User);
          });
        return;
      }
      default:
        super.customRequest(command, response, args);
    }
  }

  // Overrides.
  protected dispatchRequest(request: DebugProtocol.Request): void {
    const log = `-> ${request.command}Request\n${Util.inspect(request, { depth: Infinity })}\n`;
    this.log(log, LOG_LEVEL.SESSION);

    super.dispatchRequest(request);
  }

  public sendResponse(response: DebugProtocol.Response): void {
    const log = `<- ${response.command}Response\n${Util.inspect(response, { depth: Infinity })}\n`;
    this.log(log, LOG_LEVEL.SESSION);

    super.sendResponse(response);
  }

  public sendEvent(event: DebugProtocol.Event, bypassLog: boolean = false): void {
    if (!bypassLog) {
      const log = `<- ${event.event}Event\n${Util.inspect(event, { depth: Infinity })}\n`;
      this.log(log, LOG_LEVEL.SESSION);
    }

    super.sendEvent(event);
  }

  protected sendErrorResponse(
    response: DebugProtocol.Response,
    error: Error,
    dest?: ErrorDestination
  ): void;

  protected sendErrorResponse(
    response: DebugProtocol.Response,
    codeOrMessage: number | DebugProtocol.Message,
    format?: string,
    variables?: any,
    dest?: ErrorDestination
  ): void;

  protected sendErrorResponse(response: DebugProtocol.Response) {
    if (arguments[1] instanceof Error) {
      const error = arguments[1] as Error & {code?: number | string; errno?: number};
      const dest = arguments[2] as ErrorDestination;

      let code: number;

      if (typeof error.code === 'number') {
        code = error.code as number;
      } else if (typeof error.errno === 'number') {
        code = error.errno;
      } else {
        code = 0;
      }

      super.sendErrorResponse(response, code, error.message, dest);
    } else {
      super.sendErrorResponse(response, arguments[1], arguments[2], arguments[3], arguments[4]);
    }
  }

  // Helper functions for event handling

  private onBreakpointHit(breakpointRef: JerryMessageBreakpointHit, stopType: string): void {
    this.log('onBreakpointHit', LOG_LEVEL.SESSION);

    this.sendEvent(new StoppedEvent(stopType, IotjsDebugSession.THREAD_ID));
  }

  private onExceptionHit(data: JerryMessageExceptionHit): void {
    this.log('onExceptionHit', LOG_LEVEL.SESSION);

    this.sendEvent(new StoppedEvent('exception', IotjsDebugSession.THREAD_ID, data.message));
  }

  private onScriptParsed(data: JerryMessageScriptParsed): void {
    this.log('onScriptParsed', LOG_LEVEL.SESSION);

    this.handleSource(data);
  }

  private async onWaitForSource(): Promise<void> {
    this.log('onWaitForSource', LOG_LEVEL.SESSION);

    if (this._sourceSendingOptions.state === SOURCE_SENDING_STATES.NOP) {
      this._sourceSendingOptions.state = SOURCE_SENDING_STATES.WAITING;
      this.sendEvent(new Event('waitForSource'));
    } else if (this._sourceSendingOptions.state === SOURCE_SENDING_STATES.LAST_SENT) {
      if (!this._sourceSendingOptions.contextReset) {
        this._sourceSendingOptions.state = SOURCE_SENDING_STATES.NOP;
        this._protocolhandler.sendClientSourceControl(CLIENT_PACKAGE.JERRY_DEBUGGER_NO_MORE_SOURCES);
      }
    }
  }

  private onClose(): void {
    this.log('onClose', LOG_LEVEL.SESSION);

    this.sendEvent(new TerminatedEvent());
  }

  // General helper functions

  private handleSource(data: JerryMessageScriptParsed): void {
    const src = this._protocolhandler.getSource(data.id);
    if (src !== '') {
      const path = Path.join(`${this._args.localRoot}`, `${this.pathToBasename(data.name)}`);

      const write = c => Fs.writeSync(Fs.openSync(path, 'w'), c);

      if (Fs.existsSync(path)) {
        const content = Fs.readFileSync(path, {
          encoding: 'utf8',
          flag: 'r'
        });

        if (content !== src) {
          write(src);
        }
      } else {
        write(src);
      }
    }
  }

  private pathToSource(path): Source {
    return new Source(this.pathToBasename(path), path);
  }

  private pathToBasename(path: string): string {
    if (path === '' || path === undefined) path = 'debug_eval.js';
    return Path.basename(path);
  }

  private log(message: any, level: number = LOG_LEVEL.VERBOSE): void {
    if (level === this._debugLog || this._debugLog === LOG_LEVEL.VERBOSE) {
      switch (typeof message) {
        case 'object':
          message = Util.inspect(message, { depth: Infinity });
          break;
        default:
          message = message.toString();
          break;
      }

      this.sendEvent(new OutputEvent(`[${LOG_LEVEL[level]}] ${message}\n`, 'console'), true);
    }
  }
}

DebugSession.run(IotjsDebugSession);
