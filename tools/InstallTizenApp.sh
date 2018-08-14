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

# usage: InstallTizenApp.sh [/path/to/tizen-studio] [/path/to/tizenproject] [targetDeviceIP]

[ "$#" -ne 3 ] && { echo "Usage: $0 <tizen-studio-path> <tizen-project-path> <device-ip>"; exit 1; }

TIZEN_STUDIO=$1
TIZEN_PROJECT=$2
DEVICE_IP=$3
export PATH=$PATH:$TIZEN_STUDIO/tools/ide/bin
export PATH=$PATH:$TIZEN_STUDIO/tools
sed -i '/peripheralio/d' $TIZEN_PROJECT/tizen-manifest.xml
tizen cli-config "profiles.path=$TIZEN_STUDIO-data/profile/profiles.xml"
tizen build-native -C Debug -a arm -c gcc -r iot-headless-4.0-device.core -- $TIZEN_PROJECT/
cd $TIZEN_PROJECT/Debug
tizen package -t tpk
PACKAGE="$(find $TIZEN_PROJECT/Debug/ -iname '*.tpk')"
sdb connect $DEVICE_IP
sdb install $PACKAGE
