# IoT.js debug and language extension for VSCode.

[![License](https://img.shields.io/badge/licence-Apache%202.0-brightgreen.svg?style=flat)](LICENSE)

- [Introduction](#introduction)
- [Features](#features)
- [Requirements](#requirements)
- [How to use](#how-to-use)
- [License](#license)

# Introduction
`IoT.js VSCode Extension` is a debugger and language (like intelliSense, hover, ...) extension for [Visual Studio Code](https://code.visualstudio.com/) that lets you debug the code which is running on a device, lets you upload your code to the device, directly from the VSCode over websocket communication and helps you to write code with [IoT.js](https://github.com/Samsung/iotjs).

# Features
- Debugger
  - Available Control commands:
    - Continue command
    - Pause command
    - Step-over command
    - Step-in command
    - Step-out command
    - Disconnect command

  - Available features:
    - Set/Remove breakpoint
    - Call stack display
    - Watch (evaluate expression)
    - Handle source receive from the engine
    - Sending source code from the vscode to the engine

# Requirements
- The latest Vscode which is available [here](https://code.visualstudio.com/Download).
- An [IoT.js](https://github.com/Samsung/iotjs) or a [JerryScript](https://github.com/jerryscript-project/jerryscript) as an engine to run your code.

- (For development) Requires [node.js](https://nodejs.org/en/) v8.x.x or higher (latest one is recommended) and [npm](https://www.npmjs.com) 5.x.x or higher to be able to work properly.

# How to use
You have to open (or create a new) project folder where you have to define a `launch.json` configuration file inside the `.vscode` folder. In case of IoT.js Debug this configuration looks like this:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "IoT.js: Attach",
      "type": "iotjs",
      "request": "attach",
      "address": "localhost",
      "port": 5001,
      "localRoot": "${workspaceRoot}",
      "stopOnEntry": false,
      "debugLog": 0
    },
  ]
}
```

Now you can connect to a running engine.
If you are using IoT.js you have to do the following:

```sh
# Open up a new terminal window and navigate into the IoT.js root folder
$ cd path/to/the/iotjs

# Build the IoT.js with the following switches
$ ./tools/build.py --buildtype=debug --jerry-debugger

# If you want to debug the IoT.js javascript modules
# then you have to turn off the snapshot in the IoT.js build
$ ./tools/build.py --buildtype=debug --jerry-debugger --no-snapshot

# Run the IoT.js with the following switches
$ ./build/x86_64-linux/debug/bin/iotjs --start-debug-server {file}

# To run with diferent port (the default is 5001)
$ ./build/x86_64-linux/debug/bin/iotjs --start-debug-server --jerry-debugger-port={number} {file}

# To run with show opcodes
$ ./build/x86_64-linux/debug/bin/iotjs --start-debug-server --show-opcodes {file}

# To run with source waiting mode (allows the on-the-fly source code sending)
# NOTE: This is not fully supported for now
$ ./build/x86_64-linux/debug/bin/iotjs --start-debug-server --debugger-wait-source
```

If you are using only JerryScript you have to do the following:

```sh
# Open up a new terminal window and navigate into the JerryScript root folder
$ cd path/to/the/jerryscript

# Build the JerryScript with the following command
$ ./tools/build.py --jerry-debugger ON --jerry-libc OFF

# To build without default port.
$ ./tools/build.py --jerry-debugger ON --jerry-libc OFF --jerry-port-default OFF

# Run JerryScript with the following switches
# The --log-level 3 is strongly recommended to see what is happening on server side
$ ./build/bin/jerry --start-debug-server --log-level 3 {files}

# To run with diferent port
$ ./build/bin/jerry --start-debug-server --debug-port {number} {file}

# To run with source waiting mode (allows on-the-fly source code sending)
# NOTE: This is not fully supported for now
$ ./build/bin/jerry --start-debug-server --debugger-wait-source
```

After the engine is running you can start the debug session inside the extension host by pressing the `F5` key or click on the green triangle in the debug panel.
If the client (VSCode extension) is connected then you have to see that file which is running inside the engine in the vscode editor and you have to see where the execution is stopped. Now you can use the VSCode debug action bar to control the debug session.

# License
IoT.js Code is Open Source software under the [Apache 2.0 license](LICENSE). Complete license and copyright information can be found within the code.
