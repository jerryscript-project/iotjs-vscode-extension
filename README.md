# IoT.js debug and language extension for VSCode.


[![License](https://img.shields.io/badge/licence-Apache%202.0-brightgreen.svg?style=flat)](LICENSE)
[![Build Status](https://travis-ci.org/Samsung/iotjs-vscode-extension.svg?branch=master)](https://travis-ci.org/Samsung/iotjs-vscode-extension)

- [Introduction](#introduction)
- [Features](#features)
- [Requirements](#requirements)
- [How to use](#how-to-use)
- [Tizen Studio](#tizen-studio)
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
    - Set/Remove breakpoints
    - Set/Remove function breakpoints
    - Call stack display
    - Watch (evaluate expression)
    - Exception hint
    - Handle source receive from the engine
    - Sending source code from the vscode to the engine
    - Automatic IoT.js debug server launch

- Language support
  - Available features:
    - Require module name completer
    - Module's function completer
    - Hover information provider for IoT.js specific module functions


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

These configuration options are required. Manifest:
- `name`: The name which will be visible in the debug view
- `type`: This must be `iotjs` otherwise the debug session wont start
- `request`: Type of the session start
- `address`: IP address on which the server listening. Default is `localhost`
- `port`: Debug port to attach to. Default is `5001`
- `localRoot`: The local source root directoy, most cases this is the `${workspaceRoot}`
- `stopOnEntry`: Autmoatically stop the program after launch, the IoT.js will stop on the first breakpoint for now, no matter that is enabled or not.
- `debugLog`: The type of the debug log, you can choose from 0 to 4:
    - 0: none
    - 1: Error (show errors only)
    - 2: Debug Session related (requests and their responses)
    - 3: Debug Protocol related (communication between the engine and the client)
    - 4: Verbose (each log type included)

You can also define [Launch](#launch) instead of Attach to automate starting debug server.

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
# Launch 
Alternatively you can use LaunchRequest instead of AttachRequest for automatic debug server launch.
In case of IoT.js Debug it looks like this:
```json
 {
    "name": "IoT.js: Launch",
    "type": "iotjs",
    "request": "launch",
    "program": "iotjs",
    "address": "localhost",
    "port": 5001,
    "localRoot": "${workspaceRoot}",
    "stopOnEntry": false,
    "debugLog": 0,
    "args": [
        "--start-debug-server",
        "--debugger-wait-source"
    ]
}
```

These configuration options are required. Manifest:
- `name`: The name which will be visible in the debug view
- `type`: This must be `iotjs` otherwise the debug session wont start
- `request`: Type of the session start
- `program`: Runtime executable for debug server. Default is iotjs. If you debug on desktop use
absolute path to executable (e.g.:/path/to/iotjs/build/x86_64-linux/debug/bin/iotjs)
- `address`: IP address on which the server listening. Default is `localhost`
- `port`: Debug port to attach to. Default is `5001`
- `localRoot`: The local source root directoy, most cases this is the `${workspaceRoot}`
- `stopOnEntry`: Autmoatically stop the program after launch, the IoT.js will stop on the first breakpoint for now, no matter that is enabled or not.
- `debugLog`: The type of the debug log, you can choose from 0 to 4:
    - 0: none
    - 1: Error (show errors only)
    - 2: Debug Session related (requests and their responses)
    - 3: Debug Protocol related (communication between the engine and the client)
    - 4: Verbose (each log type included)
- `args`: Arguments for debug server. In case of IoT.js use --start-debug-server and --debugger-wait-source.


After the engine is running you can start the debug session inside the extension host by pressing the `F5` key or click on the green triangle in the debug panel.
If the client (VSCode extension) is connected then you have to see that file which is running inside the engine or if you started the engine in waiting mode you will get a prompt window where you can select that file what you want to running and then you can see where the execution is stopped. Now you can use the VSCode debug action bar to control the debug session.

***Note:*** If you using the development version of this extension, you have to run the following commands for the first time in the extension directory:
```bash
# Install the node modules
$ npm install

# Compile the extension into the out folder
$ npm run compile
```
If you want to use the development extension just like any other extension in your VSCode then copy the project folder into the VSCode extensions folder:
```bash
# Assume that you are in the extension root folder
# After this just reload the VSCode and the extension will be "installed"
$ cp . ~/.vscode/extensions/ -r
```
# Tizen Studio
Now you can use the extension to debug Tizen applications.
Requirements:
- The latest version of [Tizen Studio with CLI](https://developer.tizen.org/development/tizen-studio/download)

After installing Tizen Studio you can add the following lines of information to launch.json:
```json
{
    "tizenStudioPath": "/absolute/path/to/tizen-studio",
    "IoTjsPath": "/absolute/path/to/iotjs"
}
```
This enables the extension to install required packages for Tizen Studio to be able to create [IoTjsApp native project](#create-tizen-native-project). The installation may take several minutes. 

# Create Tizen Native Project
To create a Tizen Native Project in VSCode you need to simply click the 'Create IoTjs Tizen Project' button on the top right corner of your screen and provide information such as name and destination directory for your new IoTjsApp.

# License
IoT.js VSCode extension is Open Source software under the [Apache 2.0 license](LICENSE). Complete license and copyright information can be found within the code.
