#!/bin/sh

# Copyright 2018-present Samsung Electronics Co., Ltd. and other contributors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# usage: CreateTizenProject.sh [projectName] [/path/to/destination/directory] [/path/to/tizen/studio]

[ "$#" -ne 3 ] && { echo "Usage: $0 <project-name> <destination-directory> <tizen-studio>"; exit 1; }

TIZEN_PROJECT=$1
PROJECT_DIRECTORY=$2
TIZEN_STUDIO=$3
export PATH=$PATH:$TIZEN_STUDIO/tools/ide/bin
tizen create native-project -p iot-headless-4.0 -t IoTjsApp -n $TIZEN_PROJECT -- $PROJECT_DIRECTORY
tizen build-native -r iot-headless-4.0-device.core -- $PROJECT_DIRECTORY/$TIZEN_PROJECT
