# NoteFIsh Voice — the virtual microphone

macOS can tap what an app plays (the companion hears the call that way, no driver),
but it has no built-in way for one app to *be* another app's microphone. This is
that piece: a tiny Core Audio Server Plug-in, built on [libASPL](https://github.com/gavv/libASPL)
(MIT), that shows up as a microphone called **NoteFIsh Voice**.

The companion sends the Fish voice into it (48 kHz mono PCM16 over UDP on
127.0.0.1:47321). The call app, with NoteFIsh Voice selected as its mic, hears
only that — your real microphone never reaches the call.

```bash
sh driver/install.sh      # builds, ad-hoc signs, asks for your password to install, restarts Core Audio
```

Then in Zoom / WhatsApp / Meet / FaceTime: **Microphone → NoteFIsh Voice**. Run
`npm run companion -- --watch` as before; it finds the device by name.

Uninstall: `sudo rm -rf /Library/Audio/Plug-Ins/HAL/NoteFishVoice.driver && sudo launchctl kickstart -kp system/com.apple.audio.coreaudiod`.

Why not BlackHole: it is GPL-3, so bundling it would make the whole app GPL. This
driver is ~150 lines and MIT, and it does one thing.

Shipping note: the packaged app must sign the driver with the same Developer ID and
notarize it; `install.sh`'s ad-hoc signature is for a local build only.
