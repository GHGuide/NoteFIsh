// Prints the bundle id of every process this Mac is currently capturing audio for,
// one per line, then exits. The companion polls it to know whether a call is actually
// happening: a browser holds its microphone for as long as you are in the meeting and
// lets go the moment you leave, whatever the tab's URL still says.
//
// This replaced a probe that watched the default input device. That could not work
// here, because a call set up for NoteFish has its microphone pointed at the NoteFish
// Voice driver, not at the Mac's own microphone — so the real one never runs and the
// call looked, to the old probe, like nothing at all.
//
//   swiftc -O audio-activity.swift -o bin/audio-activity
//   ./bin/audio-activity
//
// Needs macOS 14.2 or newer, the same as the audio tap next to it.
import CoreAudio
import Foundation

func processObjects() -> [AudioObjectID] {
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size = UInt32(0)
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
  var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &list) == noErr else { return [] }
  return list
}

func bundleId(_ object: AudioObjectID) -> String {
  var address = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
  return status == noErr ? (value as String) : ""
}

func isCapturing(_ object: AudioObjectID) -> Bool {
  var address = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyIsRunningInput, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value = UInt32(0)
  var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr && value != 0
}

for object in processObjects() where isCapturing(object) {
  let id = bundleId(object)
  if !id.isEmpty { print(id) }
}
