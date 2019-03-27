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
import * as Cp from 'child_process';

// FIX ME: Change this require to a more consistent solution.
// tslint:disable:no-var-requires
const iotjs = require('./IotjsFunctions.json');
let tizenStudioPath = undefined;
let IoTjsPath = undefined;
let lastModified = {
  filePath: undefined,
  mtime: undefined
};

let sources: string[];
let pathArray = [];
const defaultModules = [{
  link: 'process',
  mod: 'process',
}, {
  link: 'emitter',
  mod: 'events',
}, {
  link: 'timers',
  mod: 'timers',
}];

const JS_MODE: vscode.DocumentFilter = { language: 'javascript', scheme: 'file' };

const initialConfigurations = [{
  name: 'Attach',
  type: 'iotjs',
  request: 'attach',
  address: 'localhost',
  port: 5001,
  localRoot: '${workspaceRoot}',
  stopOnEntry: false,
  debugLog: 0
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

const checkPath = () => {
  fs.stat(lastModified.filePath, async (err, stat) => {
    if (lastModified.mtime < stat.mtime) {
      await setup();
    }
    createTizenProject();
  });
};

const createTizenProject = async() => {
  if (!tizenStudioPath) {
    vscode.window.showErrorMessage('Please specify Tizen Studio path in launch.json');
    return;
  }
  const createPath = path.join(__dirname, 'CreateTizenProject.sh');
  const projectName = await vscode.window.showInputBox({
    placeHolder: 'IoT.js Tizen project name',
    prompt: 'Name your new project please',
    ignoreFocusOut: true
  });
  if (projectName) {
    const projectPath = await vscode.window.showOpenDialog({
      openLabel: 'Set as destination directory',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false
    });
    if (projectPath) {
      Cp.execFileSync(createPath, [projectName, projectPath[0].path, tizenStudioPath]);
      openProject(projectPath[0].path, projectName);
    }
  }
};

const openProject = (path: string, name: string) => {
  const project = vscode.Uri.file(`${path}/${name}`);
  fs.mkdirSync(`${project.path}/.vscode`);
  fs.copyFileSync(lastModified.filePath, `${project.path}/.vscode/launch.json`);
  vscode.commands.executeCommand('vscode.openFolder', project, true);
};

const walkSync = (dir: string, filelist: string[] = []): string[] => {
  fs.readdirSync(dir).forEach(file => {
    filelist = fs.statSync(path.join(dir, file)).isDirectory()
      ? walkSync(path.join(dir, file), filelist)
      : filelist.concat(path.join(dir, file));
  });

  return filelist.filter(f => path.extname(f).toLowerCase().match(/\.(js)$/i) && f !== '' && (fs.statSync(f).size) > 0);
};

const getListOfFiles = (): string[] => {
  let wsFiles: string[] = [];

  vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath).forEach(entry => {
    wsFiles = [...wsFiles, ...walkSync(entry)];
  });

  return wsFiles;
};

const getProgramName = (): Thenable<string[]> => {
  return vscode.window.showQuickPick(getListOfFiles(), {
    placeHolder: 'Select a file you want to debug',
    canPickMany: true,
    ignoreFocusOut: true,
    onDidSelectItem: item => {
      if (pathArray.indexOf(item.toString()) === -1) {
        pathArray.push(item.toString());
      } else {
        pathArray.splice(pathArray.indexOf(item.toString()), 1);
      }
    }
  });
};

const getProgramSource = (path: string[]): string[] => {
  return path.map((p) => {
    return fs.readFileSync(p, {
      encoding: 'utf8',
      flag: 'r'
    });
  });

};

const processCustomEvent = async (e: vscode.DebugSessionCustomEvent): Promise<any> => {
  switch (e.event) {
    case 'readSources': {
      if (vscode.debug.activeDebugSession) {
        await getProgramName().then(path => path);
        sources = getProgramSource(pathArray);
        e.event = 'sendNextSource';
        processCustomEvent(e);
      }
      return true;
    }
    case 'sendNextSource': {
      vscode.debug.activeDebugSession.customRequest('sendSource', {
        program: {
          name: pathArray.pop(),
          source: sources.pop(),
          isLast: sources.length === 0
        }
      });
      return true;
    }
    default:
      return undefined;
  }
};

const lookForModules = (source: string) => {
  const rm = /^(var|let|const)?\s*([a-zA-Z0-9$_]+)\s*=[\s|\n]*require\s*\(\s*['"]([a-zA-Z0-9$_]+)['"]\s*\);?$/;
  return source.split(/\r?\n/g).filter(line => rm.test(line)).map(m => {
    const match = rm.exec(m);

    return {
      link: match[2],
      mod: match[3]
    };
  });
};

const createItems = (document: vscode.TextDocument, position: vscode.Position): Array<vscode.CompletionItem> => {
  const rm = /([a-zA-Z0-9 =]+)\.$/;
  const items: vscode.CompletionItem[] = [];
  const modules = Object.keys(iotjs);
  const textUntilPos = document.getText(document.getWordRangeAtPosition(position));
  const availableModules = defaultModules.concat(lookForModules(textUntilPos));
  const might = (document.lineAt(position.line).text).split(/\s/g).pop().replace(/\./g, '');
  const matchKey = Object.keys(availableModules).find(key => availableModules[key].link === might);

  if (document.lineAt(position.line).text.match(rm)) {
    modules.forEach(mod => {
      if (document.lineAt(position.line).text.includes(availableModules[matchKey].link) &&
      availableModules[matchKey].mod === mod) {
        for (let i in iotjs[mod]) {
          items.push(new vscode.CompletionItem(iotjs[mod][i].label, 2));
          items[i].detail = iotjs[mod][i].detail;
          items[i].insertText = iotjs[mod][i].insertText;
          items[i].documentation = iotjs[mod][i].documentation;
        }
      }
    });
  }
  return items;
};

const createModules = (document: vscode.TextDocument, position: vscode.Position): Array<vscode.CompletionItem> => {
  const rm = /^(var|let|const)?\s*([a-zA-Z0-9$_]+)\s*=[\s|\n]*require\s*\(\s*['"]/;
  const modules = Object.keys(iotjs);

  if (document.lineAt(position.line).text.match(rm)) {
    return modules.map(key => new vscode.CompletionItem(key, 2));
  }
  return [];
};

const createHover = (document: vscode.TextDocument, position: vscode.Position): vscode.Hover => {
  const hoverText = document.getText(document.getWordRangeAtPosition(position));
  const rm = new RegExp(`([a-zA-Z0-9$_ ]+)\\.${hoverText}([a-zA-Z0-9$_ ]*)`);
  const match = rm.exec(document.lineAt(position.line).text);
  const modules = Object.keys(iotjs);
  let hoverContent: vscode.MarkdownString[] = [];
  const availableModules = defaultModules.concat(lookForModules(document.getText()));
  const hoverModule = availableModules.find(mod => mod.link === match[1]).mod;

  modules.forEach(mod => {
    for (let i in iotjs[mod]) {
      if (hoverText === iotjs[mod][i].insertText && hoverModule === mod) {
        hoverContent.push(iotjs[mod][i].documentation);
      }
    }
  });
  return new vscode.Hover(hoverContent);
};

const setup = async () => {
  await getPath();
  if (tizenStudioPath && IoTjsPath) {
    const setupPath = path.join(__dirname, 'setup.sh');
    const setupScript = Cp.spawn(`source ${setupPath}`, [tizenStudioPath.toString(), IoTjsPath.toString()]);
    setupScript.stdout.on('data', setupLog => {
      console.log(setupLog.toString());
    });
  }
};

const getPath = async () => {
  lastModified.filePath = undefined;
  tizenStudioPath = undefined;
  await vscode.workspace.findFiles('**/launch.json')
  .then(files => {
    lastModified.filePath = files[0].fsPath;
    fs.stat(lastModified.filePath, (err, stats) => {
      lastModified.mtime = stats.mtime;
    });
    let config = require(lastModified.filePath);
    config.configurations.forEach(i => {
      if (i.tizenStudioPath) {
        tizenStudioPath = i.tizenStudioPath;
      }
      if (i.IoTjsPath) {
        IoTjsPath = i.IoTjsPath;
      }
    });
    Object.keys(require.cache).forEach((id) => {
      if (/launch.json/.test(id)) {
        delete require.cache[id];
      }
    });
  });

};

export const activate = (context: vscode.ExtensionContext) => {
  getPath();
  context.subscriptions.push(
    vscode.commands.registerCommand('iotjs-debug.provideInitialConfigurations', provideInitialConfigurations),
    vscode.commands.registerCommand('iotjs-debug.createTizenProject', checkPath),
    vscode.debug.onDidReceiveDebugSessionCustomEvent(e => processCustomEvent(e)),
    vscode.languages.registerCompletionItemProvider(JS_MODE, {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        return createModules(document, position);
      }
    }),
    vscode.languages.registerCompletionItemProvider(JS_MODE, {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        return createItems(document, position);
      }
    }, '.'),
    vscode.languages.registerHoverProvider(JS_MODE, {
      provideHover(document: vscode.TextDocument, position: vscode.Position) {
        return createHover(document, position);
      }
    } )
  );
};

export const deactivate = () => {
  // Nothing to do.
};
