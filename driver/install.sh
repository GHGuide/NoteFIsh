#!/bin/sh
# Builds and installs the NoteFIsh Voice virtual microphone. Needs CMake and Xcode's
# command-line tools; asks for your password once to copy the driver into
# /Library/Audio/Plug-Ins/HAL and restart Core Audio (a second of silence).
set -e
cd "$(dirname "$0")"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
# Ad-hoc signature is enough for a local install; a shipped app signs with its Developer ID.
codesign --force --deep --sign - build/NoteFishVoice.driver
echo "Installing NoteFIsh Voice (password needed):"
sudo rm -rf /Library/Audio/Plug-Ins/HAL/NoteFishVoice.driver
sudo cp -R build/NoteFishVoice.driver /Library/Audio/Plug-Ins/HAL/
sudo launchctl kickstart -kp system/com.apple.audio.coreaudiod
echo "Done. Pick “NoteFIsh Voice” as the microphone in your call app; the companion speaks into it."
