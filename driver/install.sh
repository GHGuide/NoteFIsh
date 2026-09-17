#!/bin/sh
# Builds and installs the NoteFish Voice virtual microphone. Needs CMake and Xcode's
# command-line tools; asks for your password once to copy the driver into
# /Library/Audio/Plug-Ins/HAL and restart Core Audio (a second of silence).
set -e
cd "$(dirname "$0")"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
# Ad-hoc signature is enough for a local install; a shipped app signs with its Developer ID.
codesign --force --deep --sign - build/NoteFishVoice.driver
echo "Installing NoteFish Voice (password needed):"
sudo rm -rf /Library/Audio/Plug-Ins/HAL/NoteFishVoice.driver
sudo cp -R build/NoteFishVoice.driver /Library/Audio/Plug-Ins/HAL/
sudo killall coreaudiod  # launchd restarts it; kickstart is blocked by SIP
echo "Done. Pick “NoteFish Voice” as the microphone in your call app; the companion speaks into it."
