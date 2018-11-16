# Changelog

## Version 0.10.0
- Added supports for debugging:
  - Update debugger version to accommodate changes in IoT.js
  - Support the scope and variables requests
    - Retrieve the list of variables at the current scope and show them under the variables pane
  - Support SetVariable request
    - Set the variable with the given name in the variable container to a new value
    - Add `copy value`, `copy as expression` and `add to watch` options for variables

- Added features:
  - Support restart functionality also in IoT.js

- Updates and fixes:
  - Update the IoT.js module functions
  - Fix incorrect .vscode directory creation inside Tizen projects
  - Call InitializedEvent after source is sent to get persisted breakpoints

## Version 0.9.0
 - Added features:
   - Restart function (only supported with JerryScript yet)
   - Automate debug server launch and Tizen Studio package installation
   - Added a 'Create IoTjs Tizen Project' option to extension
   - Support delayed stack trace loading

## Version 0.8.0
- Added features:
  - Completion Provider for module names and functions

## Version 0.7.0
- Added support for debugging:
  - Control commands:
    - Continue command
    - Pause command
    - Step-over command
    - Step-in command
    - Step-out command
    - Disconnect command

  - Features:
    - Set/Remove breakpoints
    - Set/Remove function breakpoints
    - Call stack display
    - Watch (evaluate expression)
    - Exception hint
    - Handle source receive from the engine
    - Sending source code from the vscode to the engine
