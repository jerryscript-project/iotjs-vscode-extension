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

import * as vscode from 'vscode';

const initialConfigurations = [{
  name: 'Attach',
  type: 'iotjs',
  request: 'attach',
  address: 'localhost',
  port: 5001,
  localRoot: '${workspaceRoot}',
  stopOnEntry: false,
  debugLog: false
}];

const provideInitialConfigurations = (): string => {
  const config = JSON.stringify(initialConfigurations, null, '\t').split('\n')
                                                                  .map(line => '\t' + line)
                                                                  .join('\n').trim();

  return [
    '{',
    '\t"version": "0.2.0",',
    `\t"configurations": ${config}`,
    '}'
  ].join('\n');
};

export const activate = (context: vscode.ExtensionContext) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('iotjs-debug.provideInitialConfigurations', provideInitialConfigurations)
  );
};

export const deactivate = () => {
  // Nothing to do.
};
