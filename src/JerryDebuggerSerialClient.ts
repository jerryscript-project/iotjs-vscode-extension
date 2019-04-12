/*
 * Copyright 2019-present Samsung Electronics Co., Ltd. and other contributors
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

import * as SerialPort from 'serialport';

export interface JerryDebuggerSerialOptions {
  delegate: JerryDebuggerDelegate;
  serialConfig?: string;
}

export interface JerryDebuggerDelegate {
  onMessage: (message: Uint8Array) => void;
  onClose?: () => void;
}

export class JerryDebuggerSerialClient {
  readonly serialConfig: string;
  readonly protocol: string;
  private serialport?: SerialPort;
  private connectPromise?: Promise<void>;
  private delegate: JerryDebuggerDelegate;
  private buffer: ArrayBuffer;

  constructor(options: JerryDebuggerSerialOptions) {
    this.delegate = options.delegate;
    this.serialConfig = options.serialConfig;
    this.buffer = new ArrayBuffer(0);
    this.protocol = 'serial';
  }

  public async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    let portsList = [];

    await SerialPort.list().then(
      ports => ports.forEach((port) => {
        portsList.push(port.comName);
      })
    );

     /* config parameters for serial port (port,baud,databits,parity,stopbits) */
    const config = this.serialConfig.split(',', 5);

    this.connectPromise = new Promise((resolve, reject) => {
      if (config.length !== 5) {
        reject(new Error('Invalid serial configuration!'));
        return;
      }

      let openOptions: SerialPort.OpenOptions = {};
      const portID = config[0];
      if (!portsList.includes(portID)) {
        reject(new Error(`Invalid portID (${portID}) for serial configuration!`));
        return;
      }

      openOptions.baudRate = parseInt(config[1], 10);

      switch (config[2]) {
        case '5':
          openOptions.dataBits = 5;
          break;
        case '6':
          openOptions.dataBits = 6;
          break;
        case '7':
          openOptions.dataBits = 7;
          break;
        case '8':
          openOptions.dataBits = 8;
          break;
        default:
          reject(new Error(`Invalid data bit (${config[2]}) for serial configuration!`));
          return;
      }

      switch (config[3]) {
        case 'N':
          openOptions.parity = 'none';
          break;
        case 'O':
          openOptions.parity = 'odd';
          break;
        case 'E':
          openOptions.parity = 'even';
          break;
        default:
          reject(new Error(`Invalid parity (${config[3]}) for serial configuration!`));
          return;
      }

      switch (config[4]) {
        case '1':
          openOptions.stopBits = 1;
          break;
        case '2':
          openOptions.stopBits = 2;
          break;
        default:
          reject(new Error(`Invalid stop bits (${config[4]}) for serial configuration!`));
          return;
      }

      this.serialport = new SerialPort(portID, openOptions);

      if (!this.serialport) {
        reject(new Error('Invalid serial port!'));
        return;
      }

      this.serialport.on('open', () => {
        this.serialport.write('c');
        this.serialport.on('close', () => this.onClose());
        this.serialport.on('data', (data) => this.onMessage(data));
      });

      this.serialport.on('error', (err) => {
        reject(err);
      });
      resolve();
    });

    return this.connectPromise;
  }

  public disconnect(): void {
    if (this.serialport) {
      this.serialport.close();
      this.serialport = undefined;
    }
  }

  private onMessage(data: ArrayBuffer): void {
    let arrayBufferConcat = require('arraybuffer-concat');
    this.buffer = arrayBufferConcat(this.buffer, data);

    let size = new Uint8Array(this.buffer)[0];

    while (size + 1 <= this.buffer.byteLength) {
      const msg = this.buffer.slice(1, size + 1);
      this.delegate.onMessage(new Uint8Array(msg));
      this.buffer = this.buffer.slice(size + 1);
      size = new Uint8Array(this.buffer)[0];
    }
  }

  private onClose(): void {
    if (this.delegate.onClose) {
      this.delegate.onClose();
    }
  }

  public send(data: any): boolean {
    let arrayBufferToBuffer = require('arraybuffer-to-buffer');
    this.serialport!.write(arrayBufferToBuffer(data), () => {
      return false;
    });

    return true;
  }
}
