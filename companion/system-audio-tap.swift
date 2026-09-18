// Captures what this Mac is playing — a call in Zoom, WhatsApp, a browser — with a
// Core Audio process tap (macOS 14.2+), no virtual driver, and writes 16 kHz mono
// PCM16 to stdout. Optional argument: a bundle id prefix to tap only that app
// (e.g. us.zoom.xos, or ai.perplexity.comet to catch its helpers too); with none,
// every process except NoteFish's own is tapped.
//
// The callback below runs on Core Audio's realtime thread, and a global tap sits in
// the system's own output path: anything that blocks here stalls every sound the Mac
// is making, which comes out as stuttering and repeating audio. So it allocates
// nothing, takes no locks, and writes to a non-blocking stdout — if the reader is
// behind, these samples are dropped rather than waiting for it. Missing a few
// milliseconds of the call costs a word; blocking costs the whole machine's audio.
//
//   swiftc -O system-audio-tap.swift -o bin/system-audio-tap
//   ./bin/system-audio-tap [bundle.id] | …
//
// macOS asks once for "System Audio Recording" permission for the process that
// runs this (Terminal, or the NoteFish app).
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
    // A prefix, not an exact match: a browser plays a call from "…comet.helper", not "…comet".
    return status == noErr && (value as String).hasPrefix(wanted)
  }
}

/// NoteFish's own audio, which must never come back in as if the caller had said it.
func isOurs(_ object: AudioObjectID) -> Bool {
  var address = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: CFString = "" as CFString
  var size = UInt32(MemoryLayout<CFString>.size)
  let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
  return status == noErr && (value as String).lowercased().contains("notefish")
}

let bundleId = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : nil
let description: CATapDescription
if let bundleId {
  // An app that has just joined a call may not have opened its audio yet. Wait a few
  // seconds for it rather than giving up, which would send us back to tapping the
  // whole Mac and hearing every notification as if the caller had said it.
  var objects = processObjects(matching: bundleId)
  var waited = 0.0
  while objects.isEmpty && waited < 5 { Thread.sleep(forTimeInterval: 0.25); waited += 0.25; objects = processObjects(matching: bundleId) }
  if objects.isEmpty { fail("No running process with bundle id \(bundleId) is producing audio yet.") }
  description = CATapDescription(stereoMixdownOfProcesses: objects)
} else {
  // Everything except NoteFish: the call app's playback, whichever app it is, without
  // our own replies and ringing coming straight back in as the caller's voice.
  description = CATapDescription(stereoGlobalTapButExcludeProcesses: processObjects(matching: nil).filter(isOurs))
}
description.muteBehavior = .unmuted // the person keeps hearing the call
description.name = "NoteFish listening"

var tapId = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(description, &tapId)
if tapStatus != noErr { fail("Could not create the audio tap (\(tapStatus)). Allow System Audio Recording for this app in System Settings › Privacy & Security.") }

// The tap only delivers audio through an aggregate device that lists it.
let aggregateUID = "com.notefish.tap.\(UUID().uuidString)"
let aggregateDescription: [String: Any] = [
  kAudioAggregateDeviceNameKey: "NoteFish tap",
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
//
// Everything the callback touches is allocated once, here, before any audio arrives.
// `scratch` holds the mono mix of one buffer and `converted` the 16 kHz samples; both
// are sized for a buffer far larger than Core Audio ever hands over, and a buffer that
// somehow exceeded them is skipped rather than grown.
let maxFrames = 65536
let scratch = UnsafeMutablePointer<Float>.allocate(capacity: maxFrames)
let converted = UnsafeMutablePointer<Int16>.allocate(capacity: maxFrames)
var phase = 0.0
var last: Float = 0

// stdout never blocks us. When the reader falls behind, the pipe fills, write() returns
// EAGAIN, and those samples are gone — the call loses a syllable. The alternative is
// waiting on the realtime thread, which stalls the audio of every app on the Mac.
// ponytail: drop-on-full, which is right for a live call; a ring buffer and a writer
// thread would ride out longer stalls if the reader ever needs to pause for seconds.
let stdoutFd = Int32(1)
_ = fcntl(stdoutFd, F_SETFL, fcntl(stdoutFd, F_GETFL, 0) | O_NONBLOCK)
// A pipe can accept part of a write and refuse the rest. Stopping on an odd byte would
// leave the reader half a sample out of step for the rest of the call, and every sample
// after it byte-swapped into noise, so one padding byte puts the stream back on an even
// boundary before anything else is sent.
var halfASample = false

var procId: AudioDeviceIOProcID?
let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&procId, aggregateId, nil) { _, inputData, _, _, _ in
  let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
  guard let buffer = buffers.first, let data = buffer.mData else { return }
  let frames = Int(buffer.mDataByteSize) / (isFloat ? 4 : 2) / channels
  if frames == 0 || frames > maxFrames { return }
  if isFloat {
    let samples = data.bindMemory(to: Float.self, capacity: frames * channels)
    for i in 0..<frames { var sum: Float = 0; for c in 0..<channels { sum += samples[i * channels + c] }; scratch[i] = sum / Float(channels) }
  } else {
    let samples = data.bindMemory(to: Int16.self, capacity: frames * channels)
    for i in 0..<frames { var sum: Float = 0; for c in 0..<channels { sum += Float(samples[i * channels + c]) / 32768 }; scratch[i] = sum / Float(channels) }
  }
  var count = 0
  var position = phase
  while position < Double(frames) && count < maxFrames {
    let index = Int(position)
    let fraction = Float(position - Double(index))
    let a = index == 0 ? last : scratch[index - 1]
    let b = scratch[min(index, frames - 1)]
    let value = a + (b - a) * fraction
    converted[count] = Int16(max(-1, min(1, value)) * 32767)
    count += 1
    position += step
  }
  phase = position - Double(frames)
  last = scratch[frames - 1]
  if count == 0 { return }
  if halfASample {
    var pad: UInt8 = 0
    if write(stdoutFd, &pad, 1) != 1 { return } // still blocked; try again next time round
    halfASample = false
  }
  var offset = 0
  let total = count * MemoryLayout<Int16>.size
  converted.withMemoryRebound(to: UInt8.self, capacity: total) { bytes in
    while offset < total {
      let written = write(stdoutFd, bytes + offset, total - offset)
      if written > 0 { offset += written; continue }
      // The reader is behind: let the rest of this buffer go rather than wait for it.
      halfASample = offset % 2 == 1
      return
    }
  }
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
