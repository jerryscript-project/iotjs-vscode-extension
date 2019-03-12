/*
 * Copyright 2019-present Samsung Electronics Co., Ltd. and other contributors
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
// tslint:disable: no-var-requires

import * as fs from 'fs';
import * as unpack from 'all-unpacker';
import * as path from 'path';
import * as cp from 'child_process';
import * as rmrf from 'rimraf';
import * as vscode from 'vscode';
const fsp = require('fs').promises;

const requiredPackages = [
  'IOT-Headless-5.0',
  'MOBILE-5.0-NativeAppDevelopment-CLI'
];

const buildOptions = [
  '-C Debug',
  '-a arm',
  '-c gcc',
  '-r iot-headless-5.0-device.core'
];

let cert: string;

export const setupEnv = async (tizenPath: string, rpmPath: string) => {

  const targetPath = path.dirname(rpmPath.toString()).normalize();
  let pkgInstall;
  if (process.platform === 'win32') {
    pkgInstall = cp.spawn(`${tizenPath}/package-manager/package-manager-cli.exe`,
                               ['install', ...requiredPackages, '--accept-licence'],
                               {shell: true});
  } else {
    pkgInstall = cp.spawn(`${tizenPath}/package-manager/package-manager-cli.bin`,
                               ['install', ...requiredPackages, '--accept-licence'],
                               {shell: true});
  }
  pkgInstall.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  pkgInstall.stderr.on('data', (data) => {
    console.error(data.toString());
  });
  pkgInstall.on('exit', (code) => {
    if (code === 0) {
      unzip(rpmPath, targetPath, tizenPath);
      createTizenProject(tizenPath);
    }
  });
};

const unzip = (source: string, dest: string, tizen: string) => {
  unpack.unpack(source, {targetDir: dest}, (error) => {
    if (error) {
      console.error(error);
      return;
    }
    unpack.unpack(`${dest}/iotjs.cpio`, {targetDir: dest}, async (error)  => {
      if (error) {
        console.error(error);
        return;
      }
      const libsource = (await walk(`${dest}/usr`)).filter(f => f.includes('libiotjs.so'));
      const libdest = (await walk(tizen)).filter(f => f.includes('libiotjs.so'));
      fs.copyFile(libsource[0], libdest[0], (err) => {
        if (err) {
          console.error(err);
          return;
        }
        rmrf(`${dest}/{iotjs.cpio,usr}`, (err) => {
          if (err) {
            console.error(err);
            return;
          }
        });
      });
    });
  });
};

const walk = async (dir, filelist = []) => {
  const files = await fsp.readdir(dir);

  for (let file of files) {
    const filepath = path.join(dir, file);
    const stat = await fsp.stat(filepath);

    if (stat.isDirectory()) {
      filelist = await walk(filepath, filelist);
    } else {
      filelist.push(path.join(dir, file));
    }
  }
  return filelist;
};

export const createTizenProject = async (tizenPath: string) => {
  if (!tizenPath) {
    vscode.window.showErrorMessage('Please specify Tizen Studio path in launch.json');
    return;
  }
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
      createProject(projectName, projectPath[0].fsPath, tizenPath);
    }
  }
};

const createProject = async (projectName: string, projectPath: string, tizenPath: string) => {
  vscode.window.showInformationMessage('Creating new project...');
  process.env.PATH += `:${tizenPath}/tools/ide/bin/`;
  const createProject = cp.spawn('tizen',
                                ['create native-project',
                                '-p iot-headless-5.0',
                                '-t IoTjsApp',
                                `-n ${projectName}`,
                                `-- ${projectPath}`],
                                {shell: true});
  createProject.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  createProject.stderr.on('data', (data) => {
    console.error(data.toString());
  });
  createProject.on('exit', (code) => {
    if (code === 0) {
      openProject(projectName, projectPath);
    }
  });
};

const openProject = (projectName: string, projectPath: string) => {
  const project = vscode.Uri.file(path.join(projectPath, projectName));
  fs.mkdir(`${project.fsPath}/.vscode`, (err) => {
    if (err) {
      console.error(err);
      return;
    }
    fs.copyFile(`${vscode.workspace.workspaceFolders[0].uri.fsPath}/.vscode/launch.json`,
                `${project.fsPath}/.vscode/launch.json`,
    (err) => {
      if (err) {
        console.error(err);
        return;
      }
      vscode.commands.executeCommand('vscode.openFolder', project, true);
    });
  });
};

export const buildProject = async (tizenPath: string, address: string) => {
  process.env.PATH += `:${tizenPath}/tools/ide/bin/:${tizenPath}/tools/`;
  if (!cert) {
    cert = await vscode.window.showInputBox({
      placeHolder: 'Certificate name',
      prompt: 'Enter your certificate author:',
      ignoreFocusOut: true,
      validateInput: (text: string): string | undefined => {
        if (!text || text.trim().length === 0) {
          return 'Author name cannot be empty';
        } else {
          return undefined;
        }
      }
    });
  }
  if (!(fs.existsSync(`${tizenPath}-data/keystore/author/${cert}.p12`))) {
    await createCertificate(tizenPath, cert);
  }
  vscode.window.showInformationMessage('Building project...');
  const sdbConnect = cp.spawn('sdb', ['connect', address]);
  sdbConnect.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  sdbConnect.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  const projectPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const buildProject = cp.spawn('tizen',
                               ['build-native',
                                ...buildOptions,
                                `-- ${projectPath}`],
                                {shell: true});
  buildProject.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  buildProject.stderr.on('data', (data) => {
    console.error(data.toString());
  });
  buildProject.on('exit', (code) => {
    if (code === 0) {
      const packageTpk = cp.spawn('tizen',
      ['package',
        '-t tpk',
        `-s ${cert}`],
      {cwd: `${projectPath}/Debug`,
       shell: true});
      packageTpk.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      packageTpk.stderr.on('data', (data) => {
        console.error(data.toString());
      });
      packageTpk.on('exit', async (code) => {
        if (code === 0) {
          const pkg = (await walk(projectPath)).filter(
            f => path.extname(f).toLowerCase().match(/\.(tpk)$/i) && f !== '' && (fs.statSync(f).size) > 0);
          const install = cp.spawn('sdb', ['install',
                                              `${pkg[0]}`],
                                            {cwd: `${projectPath}/Debug`,
                                              shell: true});
          install.stdout.on('data', (data) => {
            console.log(data.toString());
          });
          install.stderr.on('data', (data) => {
            console.error(data.toString());
          });
          install.on('exit', (code) => {
            if (code === 0) {
              vscode.window.showInformationMessage('Remote install completed...');
            }
          });
        } else {
          cert = undefined;
        }
      });
    }
  });
};

const createCertificate = async (tizenPath, author): Promise<any> => {
  const password = await vscode.window.showInputBox({
    placeHolder: 'Certificate password',
    prompt: 'Enter your certificate password:',
    ignoreFocusOut: true,
    validateInput: (text: string): string | undefined => {
      if (!text || text.trim().length < 8) {
        return 'Password must be a minimum of 8 characters';
      } else {
        return undefined;
      }
    }
  });
  if (author && password) {
    const certificate = cp.spawnSync('tizen', ['certificate',
                                 `-a ${author}`,
                                 `-f ${author}`,
                                 `-p ${password}`],
                                  {shell: true});
    console.log(certificate.stdout.toString());
    console.error(certificate.stderr.toString());
    console.log(certificate.status);
    if (certificate.status === 0) {
      const addProfile = cp.spawnSync('tizen', ['security-profiles', 'add',
      '-A',
      `-a ${tizenPath}-data/keystore/author/${author}.p12`,
      `-c ${tizenPath}/tools/certificate-generator/certificates/developer/tizen-developer-ca.cer`,
      `-d ${tizenPath}/tools/certificate-generator/certificates/distributor/sdk-platform/tizen-distributor-signer.p12`,
      `-dc ${tizenPath}/tools/certificate-generator/certificates/distributor/sdk-platform/tizen-distributor-ca.cer`,
      `-n ${author}`,
      `-p ${password}`],
      {shell: true});
      console.log(addProfile.stdout.toString());
      console.error(addProfile.stderr.toString());
    }
  }
};
