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
  StoppedEvent, ContinuedEvent, StackFrame, TerminatedEvent, Event, ErrorDestination
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as Fs from 'fs';
import * as Path from 'path';
import { IAttachRequestArguments, SourceSendingOptions, TemporaryBreakpoint } from './IotjsDebuggerInterfaces';
import { JerryDebuggerClient, JerryDebuggerOptions } from './JerryDebuggerClient';
import {
  JerryDebugProtocolDelegate, JerryDebugProtocolHandler, JerryMessageScriptParsed, JerryEvalResult,
  JerryMessageExceptionHit
} from './JerryProtocolHandler';
import { EVAL_RESULT_SUBTYPE, CLIENT as CLIENT_PACKAGE } from './JerryProtocolConstants';
import { Breakpoint } from './JerryBreakpoints';

enum SOURCE_SENDING_STATES {
  NOP = 0,
  WAITING = 1,
  IN_PROGRESS = 2,
  LAST_SENT = 3
}

class IotjsDebugSession extends DebugSession {

  // We don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static THREAD_ID = 1;

  private _args: IAttachRequestArguments;
  private _debugLog: boolean = false;
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
        new Thread(IotjsDebugSession.THREAD_ID, 'thread 1')
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
    this.log('initializeRequest');

    // This debug adapter implements the configurationDoneRequest.
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsEvaluateForHovers = false;
    response.body.supportsStepBack = false;
    response.body.supportsRestartRequest = true;

    this._sourceSendingOptions = <SourceSendingOptions>{
      contextReset: false,
      state: SOURCE_SENDING_STATES.NOP
    };

    this.sendResponse(response);
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.log('configurationDoneRequest');

    super.configurationDoneRequest(response, args);
    this.sendResponse(response);
  }

  protected attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments): void {
    this.log('attachRequest');

    if (!args.address || args.address === '') {
      this.sendErrorResponse(response, 0, 'Must specify an address');
      return;
    }

    if (!args.port || args.port <= 0 || args.port > 35535) {
      this.sendErrorResponse(response, 0, 'Must specify a valid port');
      return;
    }

    if (!args.localRoot || args.localRoot === '') {
      this.sendErrorResponse(response, 0, 'Must specify a localRoot');
      return;
    }

    this._args = args;
    this._debugLog = args.debugLog || false;

    const onBreakpointHit = (breakpointRef, stopType) => {
      this.log('onBreakpointHit');
      this.sendEvent(new StoppedEvent(stopType, IotjsDebugSession.THREAD_ID));
    };

    const onExceptionHit = (data: JerryMessageExceptionHit) => {
      this.log('onExceptionHit');
      this.sendEvent(new StoppedEvent('exception', IotjsDebugSession.THREAD_ID, data.message));
    };

    const onResume = () => {
      this.log('onResume');

      this.sendEvent(new ContinuedEvent(IotjsDebugSession.THREAD_ID));
    };

    const onScriptParsed = data => {
      this.log('onScriptParsed');
      this.handleSource(data);
    };

    const onClose = () => {
      this.log('onClose');
      this.sendEvent(new TerminatedEvent());
    };

    const onWaitForSource = async () => {
      this.log('onWaitForSource');
      if (this._sourceSendingOptions.state === SOURCE_SENDING_STATES.NOP) {
        this._sourceSendingOptions.state = SOURCE_SENDING_STATES.WAITING;
        this.sendEvent(new Event('waitForSource'));
      } else if (this._sourceSendingOptions.state === SOURCE_SENDING_STATES.LAST_SENT) {
        if (!this._sourceSendingOptions.contextReset) {
          this._sourceSendingOptions.state = SOURCE_SENDING_STATES.NOP;
          this._protocolhandler.sendClientSourceControl(CLIENT_PACKAGE.JERRY_DEBUGGER_NO_MORE_SOURCES);
        }
      }
    };

    const protocolDelegate = <JerryDebugProtocolDelegate>{
      onBreakpointHit,
      onExceptionHit,
      onResume,
      onScriptParsed,
      onWaitForSource
    };

    this._protocolhandler = new JerryDebugProtocolHandler(protocolDelegate, message => this.log(message));
    this._debuggerClient = new JerryDebuggerClient(<JerryDebuggerOptions>{
      delegate: {
        onMessage: (message: Uint8Array) => this._protocolhandler.onMessage(message),
        onClose
      },
      host: args.address,
      port: args.port
    });
    this._protocolhandler.debuggerClient = this._debuggerClient;

    this._debuggerClient.connect()
      .then(() => {
        this.log(`Connected to: ${args.address}:${args.port}`);
        this.sendResponse(response);
      })
      .catch(error => {
        this.log(error);
        this.sendErrorResponse(response, 0, error.message);
      })
      .then(() => {
        this.sendEvent(new InitializedEvent());
      });
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
    this.log('launchRequest');

    this.sendErrorResponse(response, 0, 'Launching is not supported. Use Attach.');
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments
  ): void {
    this.log('disconnectRequest');

    this._debuggerClient.disconnect();

    this.sendEvent(new TerminatedEvent());
    this.sendResponse(response);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
    this.log('restartRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
    this.log('continueRequest');

    this._protocolhandler.resume()
      .then(() => {
        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
    this.log('nextRequest');

    this._protocolhandler.stepOver()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
    this.log('stepInRequest');

    this._protocolhandler.stepInto()
      .then(() => {
        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
    this.log('stepOutRequest');

    this._protocolhandler.stepOut()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
    this.log('pauseRequest');

    this._protocolhandler.pause()
    .then(() => {
      this.sendResponse(response);
    })
    .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected async setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments
  ): Promise<void> {
    this.log('setBreakPointsRequest');

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
          this.log(error);
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
      this.log(error);
      this.sendErrorResponse(response, 0, (<Error>error).message);
      return;
    }

    this.sendResponse(response);
  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    this.log('evaluateRequest');

    this._protocolhandler.evaluate(args.expression)
      .then((result: JerryEvalResult) => {
        const value = result.subtype === EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK ? result.value : 'Evaluate Error';

        response.body = {
          result: value,
          variablesReference: 0
        };

        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments
  ): void {
    this.log('stackTraceRequest');

    this._protocolhandler.requestBacktrace()
      .then(backtrace => {
        const stk = backtrace.map((f, i) => new StackFrame(
            i,
            f.func.name || 'global',
            this.pathToSource(`${this._args.localRoot}/${this.pathToBasename(f.func.sourceName)}`),
            f.line,
            f.func.column
          )
        );

        response.body = {
          stackFrames: stk,
          totalFrames: stk.length,
        };

        this.sendResponse(response);
      })
      .catch(error => this.sendErrorResponse(response, 0, (<Error>error).message));
  }

  protected customRequest(command: string, response: DebugProtocol.Response, args: any): void {
    this.log('customRequest');

    switch (command) {
      case 'sendSource': {
        this._sourceSendingOptions.state = SOURCE_SENDING_STATES.IN_PROGRESS;
        this._protocolhandler.sendClientSource(args.program.name, args.program.source)
          .then(() => {
            this.log('Source has been sent to the engine.');
            this._sourceSendingOptions.state = SOURCE_SENDING_STATES.LAST_SENT;
            this.sendResponse(response);
          })
          .catch(error => {
            this.log(error);
            this._sourceSendingOptions.state = SOURCE_SENDING_STATES.NOP;
            this.sendErrorResponse(response, 0, (<Error>error).message, null, ErrorDestination.User);
          });
        return;
      }
      default:
        super.customRequest(command, response, args);
    }
  }

  private handleSource(data: JerryMessageScriptParsed): void {
    const path = `${this._args.localRoot}/${this.pathToBasename(data.name)}`;
    const src = this._protocolhandler.getSource(data.id);

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

  private pathToSource(path): Source {
    return new Source(this.pathToBasename(path), path);
  }

  private pathToBasename(path: string): string {
    if (path === '' || path === undefined) path = 'debug_eval.js';
    return Path.basename(path);

  }

  private log(message: any): void {
    if (this._debugLog) {
      switch (typeof message) {
        case 'object':
          message = JSON.stringify(message, null, 2);
          break;
        default:
          message = message.toString();
          break;
      }

      this.sendEvent(new OutputEvent(`[DS] ${message}\n`, 'console'));
    }
  }
}

DebugSession.run(IotjsDebugSession);
