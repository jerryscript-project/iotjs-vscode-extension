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

#usage: setup.sh [path/to/tizen-studio] [path/to/iotjs]

[ "$#" -ne 2 ] && { echo "Usage: $0 <tizen-studio-path> <iotjs-path>"; exit 1; }

TIZEN_STUDIO=$1
IOTJS=$2

if [ -e $TIZEN_STUDIO/platforms/tizen-4.0/iot-headless/ ]; then
    exit 0
fi
iotjs_folder=/platforms/tizen-4.0/iot-headless/rootstraps
cd $TIZEN_STUDIO/package-manager
./package-manager-cli.bin install MOBILE-4.0-NativeAppDevelopment-CLI --accept-licence
./package-manager-cli.bin install IOT-Headless-4.0 --accept-licence
cp -r $IOTJS/config/tizen/template/IoTjsApp $TIZEN_STUDIO/platforms/tizen-4.0/iot-headless/samples/Template/Native/
mkdir $TIZEN_STUDIO$iotjs_folder/iot-headless-4.0-device.core/usr/include/iotjs
cp $IOTJS/src/platform/tizen/iotjs_tizen_service_app.h $TIZEN_STUDIO$iotjs_folder/iot-headless-4.0-device.core/usr/include/iotjs/
cd $IOTJS
IOTJS_BUILD_OPTION=--jerry-debugger
./config/tizen/gbsbuild.sh
cp ~/GBS-ROOT/local/BUILD-ROOTS/scratch.armv7l.0/home/abuild/rpmbuild/BUILD/iotjs-1.0.0/build/noarch-tizen/release/lib/libiotjs.so $TIZEN_STUDIO$iotjs_folder/iot-headless-4.0-device.core/lib/
sed '29i \    \<include_path>/usr/include/iotjs</include_path>' $TIZEN_STUDIO$iotjs_folder/info/iot-headless-4.0-device.core.dev.xml > $TIZEN_STUDIO$iotjs_folder/info/temp.xml
sed '95i \    \<library>libiotjs.so</library>' $TIZEN_STUDIO$iotjs_folder/info/temp.xml > $TIZEN_STUDIO$iotjs_folder/info/temp2.xml
cat $TIZEN_STUDIO$iotjs_folder/info/temp2.xml > $TIZEN_STUDIO$iotjs_folder/info/iot-headless-4.0-device.core.dev.xml
rm $TIZEN_STUDIO$iotjs_folder/info/temp*
export PATH=$PATH:$TIZEN_STUDIO/tools/ide/bin
export PATH=$PATH:$TIZEN_STUDIO/tools
