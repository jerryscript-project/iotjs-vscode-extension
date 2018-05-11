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
import * as fs from 'fs';
import * as path from 'path';

const initialConfigurations = [{
  name: 'Attach',
  type: 'iotjs',
  request: 'attach',
  address: 'localhost',
  port: 5001,
  localRoot: '${workspaceRoot}',
  stopOnEntry: false,
  debugLog: false,
  program: '${command:AskForProgramName}'
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

const getListOfFiles = (): Array<string> => {
  let wsFolders = Array<string>();
  let wsFiles = Array<string>();

  vscode.workspace.workspaceFolders.forEach(folder => {
    wsFolders.push(folder.uri.fsPath);
  });

  wsFolders.forEach(entry => {
    fs.readdirSync(entry).forEach(file => {
      if ((fs.statSync(`${entry}/${file}`)).isFile()) {
        if (path.extname(file).toLowerCase().match(/\.(js)$/i)) {
          wsFiles.push(file);
        }
      }
    });
  });
  return wsFiles;
};

const getProgramName = (): Thenable<string> => {
  return vscode.window.showQuickPick(getListOfFiles(), {
    placeHolder: 'Select a file you want to debug or press Enter if you are in normal mode'
  });
};

export const activate = (context: vscode.ExtensionContext) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('iotjs-debug.provideInitialConfigurations', provideInitialConfigurations),
    vscode.commands.registerCommand('iotjs-debug.getProgramName', getProgramName)
  );
};

export const deactivate = () => {
  // Nothing to do.
};
