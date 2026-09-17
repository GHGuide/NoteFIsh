// NoteFish Voice — a virtual microphone for macOS built on libASPL (MIT).
//
// Call apps (Zoom, WhatsApp, Meet in a browser, FaceTime…) pick "NoteFish Voice" as
// their microphone. The companion sends the Fish voice to this driver as 48 kHz
// mono PCM16 over UDP on 127.0.0.1:47321; whatever arrives is what the call hears.
// Nothing else ever reaches the call: no real microphone is involved.
#include <aspl/Driver.hpp>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

namespace {

constexpr Float64 kSampleRate = 48000.0;
constexpr UInt32 kChannels = 1;
constexpr uint16_t kPort = 47321;
constexpr size_t kRingFrames = 48000 * 4; // four seconds of buffer, plenty for a paced sender

/** Single-producer / single-consumer ring of Float32 frames. */
class Ring {
public:
    Ring() : buffer_(kRingFrames, 0.0f) {}
    void Push(const int16_t* samples, size_t count) {
        size_t write = write_.load(std::memory_order_relaxed);
        for (size_t i = 0; i < count; i++) {
            buffer_[write % kRingFrames] = samples[i] / 32768.0f;
            write++;
        }
        write_.store(write, std::memory_order_release);
    }
    void Pop(float* out, size_t count) {
        size_t read = read_.load(std::memory_order_relaxed);
        const size_t write = write_.load(std::memory_order_acquire);
        for (size_t i = 0; i < count; i++) {
            out[i] = read < write ? buffer_[read % kRingFrames] : 0.0f; // silence when nothing is being said
            if (read < write) read++;
        }
        read_.store(read, std::memory_order_release);
    }
private:
    std::vector<float> buffer_;
    std::atomic<size_t> read_{0};
    std::atomic<size_t> write_{0};
};

/** Receives PCM16 mono 48 kHz packets from the companion. */
class Receiver {
public:
    explicit Receiver(Ring& ring) : ring_(ring), thread_([this] { Run(); }) {}
    ~Receiver() { running_ = false; if (socket_ >= 0) close(socket_); if (thread_.joinable()) thread_.join(); }
private:
    void Run() {
        socket_ = ::socket(AF_INET, SOCK_DGRAM, 0);
        if (socket_ < 0) return;
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(kPort);
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        int reuse = 1;
        setsockopt(socket_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        if (bind(socket_, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) return;
        std::vector<int16_t> packet(4096);
        while (running_) {
            const ssize_t bytes = recv(socket_, packet.data(), packet.size() * sizeof(int16_t), 0);
            if (bytes <= 0) { if (!running_) break; continue; }
            ring_.Push(packet.data(), static_cast<size_t>(bytes) / sizeof(int16_t));
        }
    }
    Ring& ring_;
    std::atomic<bool> running_{true};
    int socket_ = -1;
    std::thread thread_;
};

/** Hands the ring's samples to whoever opened the microphone. */
class Handler : public aspl::IORequestHandler {
public:
    explicit Handler(Ring& ring) : ring_(ring) {}
    void OnReadClientInput(const std::shared_ptr<aspl::Client>&, const std::shared_ptr<aspl::Stream>&, Float64, Float64, void* bytes, UInt32 bytesCount) override {
        ring_.Pop(static_cast<float*>(bytes), bytesCount / sizeof(float));
    }
private:
    Ring& ring_;
};

std::shared_ptr<aspl::Driver> CreateDriver() {
    static Ring ring;
    static Receiver receiver(ring);

    auto context = std::make_shared<aspl::Context>();

    aspl::DeviceParameters deviceParams;
    deviceParams.Name = "NoteFish Voice";
    deviceParams.Manufacturer = "NoteFish";
    deviceParams.DeviceUID = "com.notefish.voice";
    deviceParams.ModelUID = "com.notefish.voice.model";
    deviceParams.SampleRate = kSampleRate;
    deviceParams.ChannelCount = kChannels;
    deviceParams.EnableRealtimeTracing = false;
    auto device = std::make_shared<aspl::Device>(context, deviceParams);

    aspl::StreamParameters streamParams;
    streamParams.Direction = aspl::Direction::Input;
    streamParams.Format.mSampleRate = kSampleRate;
    streamParams.Format.mFormatID = kAudioFormatLinearPCM;
    streamParams.Format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    streamParams.Format.mBitsPerChannel = 32;
    streamParams.Format.mChannelsPerFrame = kChannels;
    streamParams.Format.mBytesPerFrame = 4 * kChannels;
    streamParams.Format.mFramesPerPacket = 1;
    streamParams.Format.mBytesPerPacket = 4 * kChannels;
    device->AddStreamWithControlsAsync(streamParams);
    device->SetIOHandler(std::make_shared<Handler>(ring));

    auto plugin = std::make_shared<aspl::Plugin>(context);
    plugin->AddDevice(device);
    return std::make_shared<aspl::Driver>(context, plugin);
}

} // namespace

extern "C" void* NoteFishVoiceEntryPoint(CFAllocatorRef, CFUUIDRef typeUUID) {
    if (!CFEqual(typeUUID, kAudioServerPlugInTypeUUID)) return nullptr;
    static std::shared_ptr<aspl::Driver> driver = CreateDriver();
    return driver->GetReference();
}
