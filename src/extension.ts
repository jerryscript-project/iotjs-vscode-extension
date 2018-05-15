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

const walkSync = (dir: string, filelist: string[] = []): string[] => {
  fs.readdirSync(dir).forEach(file => {
    filelist = fs.statSync(path.join(dir, file)).isDirectory()
      ? walkSync(path.join(dir, file), filelist)
      : filelist.concat(path.join(dir, file));
  });

  return filelist.filter(f => path.extname(f).toLowerCase().match(/\.(js)$/i) && f !== '');
};

const getListOfFiles = (): string[] => {
  let wsFiles: string[] = [];

  vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath).forEach(entry => {
    console.log(walkSync(entry));
    wsFiles = [...wsFiles, ...walkSync(entry)];
  });

  return wsFiles;
};

const getProgramName = (): Thenable<string> => {
  return vscode.window.showQuickPick(getListOfFiles(), {
    placeHolder: 'Select a file you want to debug',
    ignoreFocusOut: true
  });
};

const getProgramSource = (path: string): string => {
  return fs.readFileSync(path, {
    encoding: 'utf8',
    flag: 'r'
  });
};

const processCustomEvent = async (e: vscode.DebugSessionCustomEvent): Promise<any> => {
  switch (e.event) {
    case 'waitForSource': {
      if (vscode.debug.activeDebugSession) {
        const path = await getProgramName().then(path => path);
        const source = getProgramSource(path);

        vscode.debug.activeDebugSession.customRequest('sendSource', {
          program: {
            name: path.split('/').pop(),
            source
          }
        });
      }
      return true;
    }
    default:
      return undefined;
  }
};

export const activate = (context: vscode.ExtensionContext) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('iotjs-debug.provideInitialConfigurations', provideInitialConfigurations),
    vscode.debug.onDidReceiveDebugSessionCustomEvent(e => processCustomEvent(e))
  );
};

export const deactivate = () => {
  // Nothing to do.
};
