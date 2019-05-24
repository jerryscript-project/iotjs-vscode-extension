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
  DebugSession, Handles, InitializedEvent, OutputEvent, Thread, Scope, Source,
  StoppedEvent, StackFrame, TerminatedEvent, Event, ErrorDestination
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import * as Fs from 'fs';
import * as Path from 'path';
import * as Util from 'util';
import * as Cp from 'child_process';
import * as NodeSSH from 'node-ssh';
import { IAttachRequestArguments, ILaunchRequestArguments, SourceSendingOptions, TemporaryBreakpoint } from './IotjsDebuggerInterfaces';
import { JerryDebuggerWSClient, JerryDebuggerWSOptions } from './JerryDebuggerWSClient';
import { JerryDebuggerSerialClient, JerryDebuggerSerialOptions } from './JerryDebuggerSerialClient';
import {
  JerryDebugProtocolDelegate, JerryDebugProtocolHandler, JerryMessageScriptParsed, JerryEvalResult,
  JerryMessageExceptionHit, JerryMessageBreakpointHit, JerryBacktraceResult, JerryScopeVariable, JerryScopeChain
} from './JerryProtocolHandler';
import { EVAL_RESULT_SUBTYPE, CLIENT as CLIENT_PACKAGE } from './JerryProtocolConstants';
import { Breakpoint } from './JerryBreakpoints';
import { SOURCE_SENDING_STATES, LOG_LEVEL } from './IotjsDebuggerConstants';

class IotjsDebugSession extends DebugSession {

  // We don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static THREAD_ID = 1;

  private _attachArgs: IAttachRequestArguments;
  private _launchArgs: ILaunchRequestArguments;
  private _iotjsProcess: Cp.ChildProcess;
  private _debugLog: number = 0;
  private _debuggerClient: JerryDebuggerWSClient | JerryDebuggerSerialClient;
  private _protocolhandler: JerryDebugProtocolHandler;
  private _sourceSendingOptions: SourceSendingOptions;
  private _variableHandles = new Handles<string>();

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
    response.body.supportsFunctionBreakpoints = true;
    response.body.supportsEvaluateForHovers = false;
    response.body.supportsStepBack = false;
    response.body.supportsRestartRequest = true;
    response.body.supportsDelayedStackTraceLoading = true;
    response.body.supportsSetVariable = true;

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

    this._attachArgs = args;
    if (args.debugLog in LOG_LEVEL) {
      this._debugLog = args.debugLog;
    } else {
      this.sendErrorResponse(response, new Error('No log level given'));
    }
    this.connectToDebugServer(response, args);
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
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

    this._launchArgs = args;
    if (args.debugLog in LOG_LEVEL) {
      this._debugLog = args.debugLog;
    } else {
      this.sendErrorResponse(response, new Error('No log level given'));
    }

    const launchScript = () => {
      const programArgs = args.args || [];
      const cwd = args.localRoot || process.cwd();
      const env = args.env || process.env;
      let ssh = new NodeSSH();

      if (args.address === 'localhost') {
        const localProcess = Cp.spawn(args.program, [...programArgs], {cwd, env});
        localProcess.stdout.on('data', (data: Buffer) => this.sendEvent(new OutputEvent(data + '', 'stdout')));
        localProcess.stderr.on('data', (data: Buffer) => this.sendEvent(new OutputEvent(data + '', 'stderr')));
        localProcess.on('exit', () => this.sendEvent(new TerminatedEvent ()));
        localProcess.on('error', (error: Error) => this.sendEvent(new OutputEvent(error.message + '\n')));
        this._iotjsProcess = localProcess;
      } else {
        ssh.connect({
          host: args.address,
          username: 'root',
          privateKey: `${process.env.HOME}/.ssh/id_rsa`
        })
        .then(() => {
          ssh.execCommand(`${args.program} ${programArgs.join(' ')}`, ).then((result) => {
            this.log(result.stdout);
            this.log(result.stderr);
          });
        });
      }
    };
    if (args.program) {
      launchScript();
    }
    setTimeout(() => {
      this.connectToDebugServer(response, args);
    }, 500);
  }

  private connectToDebugServer(response: DebugProtocol.LaunchResponse | DebugProtocol.AttachResponse,
                               args: ILaunchRequestArguments | IAttachRequestArguments): void {
    const protocolDelegate = <JerryDebugProtocolDelegate>{
      onBreakpointHit: (ref: JerryMessageBreakpointHit, type: string) => this.onBreakpointHit(ref, type),
      onExceptionHit: (data: JerryMessageExceptionHit) => this.onExceptionHit(data),
      onScriptParsed: (data: JerryMessageScriptParsed) => this.onScriptParsed(data),
      onWaitForSource: () => this.onWaitForSource()
    };

    this._protocolhandler = new JerryDebugProtocolHandler(
      protocolDelegate, (message: any, level: number = LOG_LEVEL.VERBOSE) => this.log(message, level)
    );

    if (args.protocol === 'tcp') {
      this._debuggerClient = new JerryDebuggerWSClient(<JerryDebuggerWSOptions>{
        delegate: {
          onMessage: (message: Uint8Array) => this._protocolhandler.onMessage(message),
          onClose: () => this.onClose()
        },
        host: args.address,
        port: args.port
      });
    } else if (args.protocol === 'serial') {
      this._debuggerClient = new JerryDebuggerSerialClient(<JerryDebuggerSerialOptions>{
        delegate: {
          onMessage: (message: Uint8Array) => this._protocolhandler.onMessage(message),
          onClose: () => this.onClose()
        },
        serialConfig: args.serialConfig
      });
    } else {
      this.sendErrorResponse(response, new Error('Unsupported debugger protocol'));
    }

    this._protocolhandler.debuggerClient = this._debuggerClient;

    this._debuggerClient.connect()
    .then(() => {
      if (args.protocol === 'websocket') {
        this.log(`Connected to: ${args.address}:${args.port}`, LOG_LEVEL.SESSION);
      } else {
        this.log(`Connected via serial port`, LOG_LEVEL.SESSION);
      }
      this.sendResponse(response);
    })
    .catch(error => {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, error);
    });
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments
  ): void {
    if (this._iotjsProcess) {
      this._iotjsProcess.kill();
    }
    this._debuggerClient.disconnect();
    this.sendEvent(new TerminatedEvent());
    this.sendResponse(response);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
    this.log('restartRequest', LOG_LEVEL.SESSION);
    try {
      this._protocolhandler.restart();
      this.sendResponse(response);
    } catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
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
          this.log(error.message, LOG_LEVEL.ERROR);
          return <TemporaryBreakpoint>{verified: false, line: breakpoint.line, message: (<Error>error).message};
        }
      }));

      // Get the persisted breakpoints.
      const newBreakpointsLines: number[] = newBreakpoints.map(b => b.line);
      const persistingBreakpoints: TemporaryBreakpoint[] = vscodeBreakpoints
                                    .filter(b => newBreakpointsLines.indexOf(b.line) === -1)
                                    .map(b => ({verified: true, line: b.line}));

      // Get the removable breakpoints.
      const vscodeBreakpointsLines: number[] = vscodeBreakpoints.map(b => b.line);
      const removeBps: Breakpoint[] = activeBps.filter(b => vscodeBreakpointsLines.indexOf(b.line) === -1);

      removeBps.forEach(async b => {
        const jerryBreakpoint = this._protocolhandler.findBreakpoint(scriptId, b.line);
        await this._protocolhandler.updateBreakpoint(jerryBreakpoint, false);
      });

      response.body = { breakpoints: [...persistingBreakpoints, ...newBreakpoints] };
    } catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, <Error>error);
      return;
    }

    this.sendResponse(response);
  }

  protected async setFunctionBreakPointsRequest(
    response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments
  ): Promise<void> {
    const vscodeFunctionBreakpoints: DebugProtocol.FunctionBreakpoint[] = args.breakpoints;

    try {
      let persistingFBreakpoints: TemporaryBreakpoint[] = [];
      let newFBreakpoints: TemporaryBreakpoint[] = [];
      let undefinedFBreakpoins: TemporaryBreakpoint[] = [];

      await Promise.all(this._protocolhandler.getSources().map(async (src, id) => {
        const scriptId = id + 1;
        const inactiveFBps: Breakpoint[] = this._protocolhandler.getInactiveFunctionBreakpointsByScriptId(scriptId);
        const vscodeFunctionBreakpointNames: string[] = vscodeFunctionBreakpoints.map(b => b.name);

        const newFBs = inactiveFBps.filter(b => vscodeFunctionBreakpointNames.indexOf(b.func.name) !== -1);

        // Get the new breakpoints.
        newFBreakpoints = [
          ...newFBreakpoints,
          ...await Promise.all(newFBs.map(async (breakpoint) => {
            try {
              await this._protocolhandler.updateBreakpoint(breakpoint, true);
              return <TemporaryBreakpoint>{verified: true, line: breakpoint.line};
            } catch (error) {
              this.log(error.message, LOG_LEVEL.ERROR);
              return <TemporaryBreakpoint>{verified: false, line: breakpoint.line, message: (<Error>error).message};
            }
          }))
        ];

        // Get the persisted breakpoints.
        const possibleFBs = this._protocolhandler.getPossibleFunctionBreakpointsByScriptId(scriptId);
        persistingFBreakpoints = [
          ...persistingFBreakpoints,
          ...possibleFBs.filter(b => {
            return newFBs.map(b => b.func.name).indexOf(b.func.name) === -1 &&
                  vscodeFunctionBreakpointNames.indexOf(b.func.name) !== -1;
          }).map(b => <TemporaryBreakpoint>{verified: true, line: b.line})
        ];

        // Get the removable breakpoints.
        const activeFBs: Breakpoint[] = this._protocolhandler.getActiveFunctionBreakpointsByScriptId(scriptId);
        const removeBps: Breakpoint[] = activeFBs.filter(b => {
          return vscodeFunctionBreakpointNames.indexOf(b.func.name) === -1;
        });

        removeBps.forEach(async b => {
          const jerryBreakpoint = this._protocolhandler.findBreakpoint(scriptId, b.line);
          await this._protocolhandler.updateBreakpoint(jerryBreakpoint, false);
        });

        undefinedFBreakpoins = [
          ...undefinedFBreakpoins,
          ...vscodeFunctionBreakpoints.filter(b => {
            return possibleFBs.map(p => p.func.name).indexOf(b.name) === -1;
          }).map(b => <TemporaryBreakpoint>{verified: false, message: 'No function found'})
        ];
      }));

      response.body = { breakpoints: [...persistingFBreakpoints, ...newFBreakpoints, ...undefinedFBreakpoins] };
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
      const result: JerryEvalResult = await this._protocolhandler.evaluate(args.expression, 0);
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
      const currentArgs = this._attachArgs || this._launchArgs;
      const backtraceData: JerryBacktraceResult = await this._protocolhandler.requestBacktrace(args.startFrame,
                                                                                               args.levels);
      const stk = backtraceData.backtrace.map((f, i) => new StackFrame(
        1000 + i,
        f.func.name || 'global',
        this.pathToSource(`${currentArgs.localRoot}/${this.pathToBasename(f.func.sourceName)}`),
        f.line,
        f.func.column)
      );

      response.body = {
        stackFrames: stk,
        totalFrames: backtraceData.totalFrames
      };

      this.sendResponse(response);
    } catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
  }


  protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments
  ): Promise<void> {
    try {
      const scopesArray: Array<JerryScopeChain> = await this._protocolhandler.requestScopes();
      const scopes = new Array<Scope>();

      for (const scope of scopesArray) {
        scopes.push(new Scope(scope.name,
                              this._variableHandles.create(scope.variablesReference.toString()),
                              scope.expensive));
      }

      response.body = {
        scopes: scopes
      };

      this.sendResponse(response);
    }  catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse,
                                   args: DebugProtocol.VariablesArguments
  ): Promise<void> {
    try {
      const variables = new Array<DebugProtocol.Variable>();
      const id = this._variableHandles.get(args.variablesReference);
      const scopeVariables: Array<JerryScopeVariable> = await this._protocolhandler.requestVariables(Number(id));

      for (const variable of scopeVariables) {
        variables.push({name: variable.name,
                        evaluateName: variable.name,
                        type: variable.type,
                        value: variable.value,
                        variablesReference: 0});
      }

      response.body = {
        variables: variables
      };
      this.sendResponse(response);
    }  catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
      this.sendErrorResponse(response, 0, (<Error>error).message);
    }
  }

  protected async setVariableRequest(response: DebugProtocol.SetVariableResponse,
                                     args: DebugProtocol.SetVariableArguments
  ): Promise <void> {
    try {
      const expression = args.name + '=' + args.value;
      const scope_index = Number(this._variableHandles.get(args.variablesReference));
      const result: JerryEvalResult = await this._protocolhandler.evaluate(expression, scope_index);
      const value: string = result.subtype === EVAL_RESULT_SUBTYPE.JERRY_DEBUGGER_EVAL_OK
                            ? result.value
                            : 'Evaluate Error';

      response.body = {
        value: value,
        variablesReference: 0
      };
      this.sendResponse(response);
    }  catch (error) {
      this.log(error.message, LOG_LEVEL.ERROR);
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
            this._sourceSendingOptions.state = SOURCE_SENDING_STATES.WAITING;
            if (args.program.isLast) {
              this._sourceSendingOptions.state = SOURCE_SENDING_STATES.LAST_SENT;
            }
            this.sendResponse(response);
          })
          .catch(error => {
            this.log(error.message, LOG_LEVEL.ERROR);
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
      await this.sendEvent(new Event('readSources'));
      this._sourceSendingOptions.state = SOURCE_SENDING_STATES.WAITING;
    } else if (this._sourceSendingOptions.state === SOURCE_SENDING_STATES.WAITING) {
      this.sendEvent(new Event('sendNextSource'));
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
    const currentArgs = this._attachArgs || this._launchArgs;
    if (src !== '') {
      const path = Path.join(`${currentArgs.localRoot}`, `${this.pathToBasename(data.name)}`);
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
      this.sendEvent(new InitializedEvent());
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
