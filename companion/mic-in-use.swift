// Prints "1" when any app is using the default microphone, "0" otherwise, then exits.
// The companion compiles this once (swiftc) and polls it: a microphone in use is the
// one signal every call app shares, whatever its name.
import CoreAudio
import Foundation

func defaultInputDevice() -> AudioDeviceID? {
  var device = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
  return status == noErr && device != 0 ? device : nil
}

func isRunningSomewhere(_ device: AudioDeviceID) -> Bool {
  var running = UInt32(0)
  var size = UInt32(MemoryLayout<UInt32>.size)
  var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running)
  return status == noErr && running != 0
}

if let device = defaultInputDevice() {
  print(isRunningSomewhere(device) ? "1" : "0")
} else {
  print("0")
}
