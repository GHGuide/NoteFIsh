// Captures what this Mac is playing — a call in Zoom, WhatsApp, a browser — with a
// Core Audio process tap (macOS 14.2+), no virtual driver, and writes 16 kHz mono
// PCM16 to stdout. Optional argument: a bundle id to tap only that app
// (e.g. us.zoom.xos); with none, every process except this one is tapped.
//
//   swiftc -O system-audio-tap.swift -o bin/system-audio-tap
//   ./bin/system-audio-tap [bundle.id] | …
//
// macOS asks once for "System Audio Recording" permission for the process that
// runs this (Terminal, or the NoteFIsh app).
import CoreAudio
import AudioToolbox
import Foundation

let targetRate = 16000.0

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(2)
}

func processObjects(matching bundleId: String?) -> [AudioObjectID] {
  var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size = UInt32(0)
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
  var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &list) == noErr else { return [] }
  guard let wanted = bundleId else { return list }
  return list.filter { object in
    var bundleAddress = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: CFString = "" as CFString
    var valueSize = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &value) { pointer in AudioObjectGetPropertyData(object, &bundleAddress, 0, nil, &valueSize, pointer) }
    return status == noErr && (value as String) == wanted
  }
}

let bundleId = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : nil
let description: CATapDescription
if let bundleId {
  let objects = processObjects(matching: bundleId)
  if objects.isEmpty { fail("No running process with bundle id \(bundleId) is producing audio yet.") }
  description = CATapDescription(stereoMixdownOfProcesses: objects)
} else {
  // Everything except us: the call app's playback, whichever app it is.
  description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
}
description.muteBehavior = .unmuted // the person keeps hearing the call
description.name = "NoteFIsh listening"

var tapId = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(description, &tapId)
if tapStatus != noErr { fail("Could not create the audio tap (\(tapStatus)). Allow System Audio Recording for this app in System Settings › Privacy & Security.") }

// The tap only delivers audio through an aggregate device that lists it.
let aggregateUID = "com.notefish.tap.\(UUID().uuidString)"
let aggregateDescription: [String: Any] = [
  kAudioAggregateDeviceNameKey: "NoteFIsh tap",
  kAudioAggregateDeviceUIDKey: aggregateUID,
  kAudioAggregateDeviceIsPrivateKey: true,
  kAudioAggregateDeviceIsStackedKey: false,
  kAudioAggregateDeviceTapAutoStartKey: true,
  kAudioAggregateDeviceSubDeviceListKey: [] as [[String: Any]],
  kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
]
var aggregateId = AudioObjectID(kAudioObjectUnknown)
let aggregateStatus = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateId)
if aggregateStatus != noErr { fail("Could not create the capture device (\(aggregateStatus)).") }

// What the tap produces: read its format so the resampler knows the input rate.
var formatAddress = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var format = AudioStreamBasicDescription()
var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
if AudioObjectGetPropertyData(tapId, &formatAddress, 0, nil, &formatSize, &format) != noErr { fail("Could not read the tap format.") }
let inputRate = format.mSampleRate > 0 ? format.mSampleRate : 48000
let channels = max(1, Int(format.mChannelsPerFrame))
let isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
let step = inputRate / targetRate

// Mix to mono, resample linearly to 16 kHz, write PCM16 little-endian.
var phase = 0.0
var last: Float = 0
let output = FileHandle.standardOutput
var procId: AudioDeviceIOProcID?
let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&procId, aggregateId, nil) { _, inputData, _, _, _ in
  let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
  guard let buffer = buffers.first, let data = buffer.mData else { return }
  let frames = Int(buffer.mDataByteSize) / (isFloat ? 4 : 2) / channels
  if frames == 0 { return }
  var mono = [Float](repeating: 0, count: frames)
  if isFloat {
    let samples = data.bindMemory(to: Float.self, capacity: frames * channels)
    for i in 0..<frames { var sum: Float = 0; for c in 0..<channels { sum += samples[i * channels + c] }; mono[i] = sum / Float(channels) }
  } else {
    let samples = data.bindMemory(to: Int16.self, capacity: frames * channels)
    for i in 0..<frames { var sum: Float = 0; for c in 0..<channels { sum += Float(samples[i * channels + c]) / 32768 }; mono[i] = sum / Float(channels) }
  }
  var out = [Int16]()
  out.reserveCapacity(Int(Double(frames) / step) + 2)
  var position = phase
  while position < Double(frames) {
    let index = Int(position)
    let fraction = Float(position - Double(index))
    let a = index == 0 ? last : mono[index - 1]
    let b = mono[min(index, frames - 1)]
    let value = a + (b - a) * fraction
    out.append(Int16(max(-1, min(1, value)) * 32767))
    position += step
  }
  phase = position - Double(frames)
  last = mono[frames - 1]
  out.withUnsafeBufferPointer { pointer in output.write(Data(buffer: pointer)) }
}
if ioStatus != noErr { fail("Could not attach to the capture device (\(ioStatus)).") }
if AudioDeviceStart(aggregateId, procId) != noErr { fail("Could not start capturing.") }
FileHandle.standardError.write("tapping \(bundleId ?? "system audio") at \(Int(inputRate)) Hz → 16000 Hz mono\n".data(using: .utf8)!)

signal(SIGINT) { _ in exit(0) }
signal(SIGTERM) { _ in exit(0) }
atexit {
  if let procId { AudioDeviceStop(aggregateId, procId); AudioDeviceDestroyIOProcID(aggregateId, procId) }
  AudioHardwareDestroyAggregateDevice(aggregateId)
  AudioHardwareDestroyProcessTap(tapId)
}
RunLoop.main.run()
