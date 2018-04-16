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
  LoggingDebugSession, DebugSession, Logger, logger, InitializedEvent, OutputEvent, Thread
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IAttachRequestArguments } from './IotjsDebuggerInterfaces';
import { JerryDebuggerClient, JerryDebuggerOptions } from './JerryDebuggerClient';

class IotjsDebugSession extends LoggingDebugSession {

  // We don't support multiple threads, so we can use a hardcoded ID for the default thread
  private static THREAD_ID = 1;

  private _args: IAttachRequestArguments;
  private _debugLog: boolean = false;
  private _debuggerClient: JerryDebuggerClient;

  public constructor() {
    super('iotjs-debug.txt');

    // The debugger uses zero-based lines and columns.
    this.setDebuggerLinesStartAt1(false);
    this.setDebuggerColumnsStartAt1(false);

    logger.setup(Logger.LogLevel.Verbose, /*logToFile=*/false);
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
  protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
    this.log('initializeRequest');

    // This debug adapter implements the configurationDoneRequest.
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsEvaluateForHovers = false;
    response.body.supportsStepBack = false;
    response.body.supportsRestartRequest = true;

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
    this.log('configurationDoneRequest');

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

    // FIXME: this is just a tmporary check for now.
    this.log(JSON.stringify(this._args));

    this._debuggerClient = new JerryDebuggerClient(<JerryDebuggerOptions>{host: args.address, port: args.port});
    this._debuggerClient.connect().then(() => {
      this.log('Connected....');
    }).catch(error => this.log(error));

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): void {
    this.log('launchRequest');

    this.sendErrorResponse(response, 0, 'Launching is not supported. Use Attach.');
  }

  protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
    this.log('disconnectRequest');

    this.sendResponse(response);
  }

  protected restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments): void {
    this.log('restartRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
    this.log('continueRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
    this.log('nextRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
    this.log('stepInRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
    this.log('stepOutRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
    this.log('pauseRequest: Not implemented yet');

    this.sendResponse(response);
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    this.log('setBreakPointsRequest: Not implemented yet');

    this.sendResponse(response);
  }

  private log(message: string): void {
    if (this._debugLog) {
      this.sendEvent(new OutputEvent(`[DS] ${message}\n`, 'console'));
    }
  }
}

DebugSession.run(IotjsDebugSession);
