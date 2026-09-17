// NoteFish for Mac: the desk in a window, a pill under the menu bar, a menu-bar
// menu with the current call, recent calls and the caption language, and a
// system-wide push-to-talk key. The Node server (server/index.mjs) does the work;
// this shell finds it on 127.0.0.1:3001 or starts it, then hosts the same web UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Listener as _, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_shell::ShellExt;
#[cfg(target_os = "macos")]
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, ManagerExt as _, WebviewWindowExt as _};

const DESK: &str = "http://127.0.0.1:3001";
const HELP: &str = "https://github.com/GHGuide/NoteFish#readme";
/// Caption languages offered in the menu; the desk's Setup page has the full catalog.
const MENU_LANGUAGES: [&str; 15] = ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "tr", "ar", "hi", "zh", "ja", "ko", "ru"];

/// Where the NoteFish checkout lives: NOTEFISH_ROOT, else the folder above src-tauri (dev), else ~/NoteFish.
fn notefish_root() -> PathBuf {
    if let Ok(root) = std::env::var("NOTEFISH_ROOT") {
        return PathBuf::from(root);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    if dev.join("server/index.mjs").exists() {
        return dev;
    }
    dirs_home().join("NoteFish")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
}

fn desk_is_up() -> bool {
    TcpStream::connect_timeout(&"127.0.0.1:3001".parse().unwrap(), Duration::from_millis(300)).is_ok()
}

/// Starts `node server/index.mjs` from the checkout when nothing answers on the port.
fn ensure_desk(app: &tauri::AppHandle) {
    if desk_is_up() {
        return;
    }
    let root = notefish_root();
    let server = root.join("server/index.mjs");
    if !server.exists() {
        eprintln!("NoteFish server not found at {}. Set NOTEFISH_ROOT.", server.display());
        return;
    }
    let shell = app.shell();
    let command = shell
        .command("node")
        .args([server.to_string_lossy().to_string()])
        .current_dir(root);
    match command.spawn() {
        Ok(_) => {
            for _ in 0..40 {
                if desk_is_up() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
        Err(error) => eprintln!("Could not start the NoteFish server: {error}"),
    }
}

/// One local HTTP call to the desk server. Local requests need no password; the
/// Origin header is what the server checks on writes.
fn http(method: &str, path: &str, body: Option<&str>) -> Option<serde_json::Value> {
    let mut stream = TcpStream::connect_timeout(&"127.0.0.1:3001".parse().ok()?, Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:3001\r\nOrigin: {DESK}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let text = String::from_utf8_lossy(&response);
    let (_, body) = text.split_once("\r\n\r\n")?;
    serde_json::from_str(body).ok()
}

/// Seconds since the epoch for the server's "2026-09-17T14:15:30.123Z" stamps.
fn epoch(iso: &str) -> Option<i64> {
    let field = |from: usize, to: usize| iso.get(from..to)?.parse::<i64>().ok();
    let (y, m, d) = (field(0, 4)?, field(5, 7)?, field(8, 10)?);
    let (hh, mm, ss) = (field(11, 13)?, field(14, 16)?, field(17, 19)?);
    let (y, m) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146097 + doe - 719468) * 86400 + hh * 3600 + mm * 60 + ss)
}

fn clock(seconds: i64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

/// The companion that watches for calls (Zoom, WhatsApp, Meet…) while "Listen for calls" is on.
struct Listener(Mutex<Option<Child>>);

fn listening(app: &tauri::AppHandle) -> bool {
    let state = app.state::<Listener>();
    let mut guard = state.0.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *guard = None; // it exited on its own
        }
    }
    guard.is_some()
}

fn toggle_listener(app: &tauri::AppHandle) {
    let state = app.state::<Listener>();
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        return;
    }
    let root = notefish_root();
    let log = File::create(root.join("companion/listen.log")).ok();
    let mut command = Command::new("node");
    command.arg("companion/index.mjs").arg("--watch").current_dir(&root);
    if let Some(log) = log {
        if let Ok(err) = log.try_clone() {
            command.stdout(log).stderr(err);
        }
    }
    match command.spawn() {
        Ok(child) => *guard = Some(child),
        Err(error) => eprintln!("Could not start the companion: {error}"),
    }
}

/// What the menu shows; rebuilt whenever it changes.
#[derive(Default, PartialEq, Clone)]
struct Snapshot {
    status: String,
    recent: Vec<(String, String)>,
    languages: Vec<(String, String)>,
    language: String,
    listening: bool,
}

fn snapshot(app: &tauri::AppHandle) -> Snapshot {
    let mut snap = Snapshot { listening: listening(app), status: "Desk offline".into(), ..Default::default() };
    let Some(settings) = http("GET", "/api/settings", None) else { return snap };
    snap.language = settings["settings"]["agentLanguage"].as_str().unwrap_or("en").to_string();
    let catalog = http("GET", "/api/languages", None).unwrap_or_default();
    let name = |code: &str| {
        catalog["languages"]
            .as_array()
            .and_then(|list| list.iter().find(|l| l["code"] == code))
            .and_then(|l| l["name"].as_str())
            .unwrap_or(code)
            .to_string()
    };
    snap.languages = MENU_LANGUAGES.iter().map(|code| (code.to_string(), name(code))).collect();
    if !MENU_LANGUAGES.contains(&snap.language.as_str()) {
        snap.languages.push((snap.language.clone(), name(&snap.language)));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let calls = http("GET", "/api/calls", None).unwrap_or_default();
    let mut ended: Vec<&serde_json::Value> = Vec::new();
    snap.status = if snap.listening { "No call · listening for Zoom, WhatsApp, Meet…".into() } else { "No call".into() };
    for call in calls["calls"].as_array().into_iter().flatten() {
        let from = call["from"].as_str().unwrap_or("Caller");
        let started = call["startedAt"].as_str().and_then(epoch).unwrap_or(now);
        match call["state"].as_str().unwrap_or("") {
            "ended" => ended.push(call),
            "ringing" => snap.status = format!("Ringing · {from}"),
            _ => snap.status = format!("On a call · {from} · {}", clock(now - started)),
        }
    }
    ended.sort_by_key(|call| std::cmp::Reverse(call["startedAt"].as_str().unwrap_or("")));
    for call in ended.into_iter().take(5) {
        let from = call["from"].as_str().unwrap_or("Caller");
        let started = call["startedAt"].as_str().and_then(epoch);
        let finished = call["endedAt"].as_str().and_then(epoch);
        let length = match (started, finished) {
            (Some(a), Some(b)) if b >= a => clock(b - a),
            _ => "—".into(),
        };
        let language = call["customerLanguage"].as_str().map(name).unwrap_or_default();
        snap.recent.push((call["id"].as_str().unwrap_or("").to_string(), format!("{from} · {length} · {language}")));
    }
    snap
}

fn build_menu(app: &tauri::AppHandle, snap: &Snapshot) -> tauri::Result<Menu<Wry>> {
    let status = MenuItem::with_id(app, "status", snap.status.as_str(), false, None::<&str>)?;
    let recent: Vec<MenuItem<Wry>> = snap
        .recent
        .iter()
        .map(|(id, label)| MenuItem::with_id(app, format!("call:{id}"), label.as_str(), true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let recent_refs: Vec<&dyn IsMenuItem<Wry>> = recent.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();
    let recent_menu = Submenu::with_id_and_items(app, "recent", "Recent calls", !recent.is_empty(), &recent_refs)?;
    let open = MenuItem::with_id(app, "open", "Open desk", true, None::<&str>)?;
    let pill = MenuItem::with_id(app, "pill", "Show the pill", true, None::<&str>)?;
    let listen = CheckMenuItem::with_id(app, "listen", "Listen for calls (Zoom, WhatsApp, Meet…)", true, snap.listening, None::<&str>)?;
    let talk = MenuItem::with_id(app, "talk", "Hold ⌥ Space anywhere to talk", false, None::<&str>)?;
    let languages: Vec<CheckMenuItem<Wry>> = snap
        .languages
        .iter()
        .map(|(code, name)| CheckMenuItem::with_id(app, format!("lang:{code}"), name.as_str(), true, code == &snap.language, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let language_refs: Vec<&dyn IsMenuItem<Wry>> = languages.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();
    let language_menu = Submenu::with_id_and_items(app, "languages", "Captions in", true, &language_refs)?;
    let help = MenuItem::with_id(app, "help", "Help", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit NoteFish", true, Some("CmdOrCtrl+Q"))?;
    Menu::with_items(
        app,
        &[
            &status,
            &recent_menu,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &pill,
            &listen,
            &PredefinedMenuItem::separator(app)?,
            &talk,
            &language_menu,
            &PredefinedMenuItem::separator(app)?,
            &help,
            &quit,
        ],
    )
}

fn refresh_menu(app: &tauri::AppHandle, snap: Snapshot) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let (Ok(menu), Some(tray)) = (build_menu(&handle, &snap), handle.tray_by_id("main")) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Which look the pill gets: the island in the notch, or the strip under the menu bar
/// (Windows, and Macs without a notch). Measured once, on the main thread.
#[derive(Clone, Copy, Default)]
struct PillMode {
    notch: Option<(f64, f64)>, // (width, height) of the notch in logical px
}

#[cfg(target_os = "macos")]
fn measure_notch() -> Option<(f64, f64)> {
    use objc2_app_kit::NSScreen;
    let mtm = objc2::MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let insets = screen.safeAreaInsets();
    if insets.top <= 0.0 {
        return None;
    }
    let frame = screen.frame();
    let (left, right) = unsafe { (screen.auxiliaryTopLeftArea(), screen.auxiliaryTopRightArea()) };
    let width = frame.size.width - left.size.width - right.size.width;
    (width > 0.0).then_some((width, insets.top))
}
#[cfg(not(target_os = "macos"))]
fn measure_notch() -> Option<(f64, f64)> {
    None
}

/// The pill: a transparent window that starts hidden; its page shows it when a call needs
/// attention and sizes it to what it draws. On macOS it becomes a non-activating panel
/// above the menu bar, so answering from it never pulls the call app out of front.
fn create_pill(app: &tauri::AppHandle) {
    if app.get_webview_window("pill").is_some() {
        return;
    }
    app.manage(PillMode { notch: measure_notch() });
    let url = format!("{DESK}/pill").parse().expect("pill url");
    if let Ok(window) = WebviewWindowBuilder::new(app, "pill", WebviewUrl::External(url))
        .title("NoteFish")
        .inner_size(360.0, 100.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .accept_first_mouse(true)
        .build()
    {
        #[cfg(target_os = "macos")]
        if let Ok(panel) = window.to_panel() {
            panel.set_level(25); // NSMainMenuWindowLevel + 1: over the menu bar, where the notch is
            panel.set_style_mask(1 << 7); // NSWindowStyleMaskNonActivatingPanel
            panel.set_collection_behaviour(NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary);
            panel.set_has_shadow(false);
            panel.set_accepts_mouse_moved_events(true); // hover works without the panel ever becoming key
        }
        let _ = window.move_window(Position::TopCenter);
    }
}

/// Sent by the pill's page with the size of what it drew. Growing keeps the
/// horizontal centre still; `recenter` puts it back under the menu bar's middle.
fn pill_layout(app: &tauri::AppHandle, width: f64, height: f64, recenter: bool) {
    // AppKit traps on window calls off the main thread; the page's events arrive on a worker.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || pill_layout_now(&handle, width, height, recenter));
}
fn pill_layout_now(app: &tauri::AppHandle, width: f64, height: f64, recenter: bool) {
    let Some(window) = app.get_webview_window("pill") else { return };
    #[cfg(debug_assertions)]
    eprintln!("pill {width}x{height}{}", if recenter { " (recenter)" } else { "" });
    let scale = window.scale_factor().unwrap_or(1.0);
    let before = window.outer_size().ok().map(|size| size.to_logical::<f64>(scale));
    let position = window.outer_position().ok().map(|point| point.to_logical::<f64>(scale));
    let _ = window.set_size(LogicalSize::new(width.max(80.0), height.max(40.0)));
    let notch = app.try_state::<PillMode>().map(|mode| mode.notch).unwrap_or(None);
    if notch.is_some() {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let scale = monitor.scale_factor();
            let origin = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            let _ = window.set_position(LogicalPosition::new(origin.x + (size.width - width) / 2.0, origin.y));
        }
    } else if recenter {
        let _ = window.move_window(Position::TopCenter);
    } else if let (Some(before), Some(position)) = (before, position) {
        let _ = window.set_position(LogicalPosition::new(position.x + (before.width - width) / 2.0, position.y));
    }
}

/// Tells the pill's page when the cursor is over it. WebKit only reports hover to a key
/// window, and this panel never becomes key, so the shell watches the cursor instead.
fn watch_cursor(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut inside = false;
        loop {
            let window = handle.get_webview_window("pill");
            let visible = window.as_ref().map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
            let now_inside = visible
                && window
                    .as_ref()
                    .and_then(|w| Some((w.outer_position().ok()?, w.outer_size().ok()?, handle.cursor_position().ok()?)))
                    .map(|(pos, size, cursor)| cursor.x >= pos.x as f64 && cursor.x <= (pos.x + size.width as i32) as f64 && cursor.y >= pos.y as f64 && cursor.y <= (pos.y + size.height as i32) as f64)
                    .unwrap_or(false);
            if now_inside != inside {
                inside = now_inside;
                #[cfg(debug_assertions)]
                if let Some(w) = window.as_ref() { eprintln!("hover {inside} cursor={:?} window={:?} {:?}", handle.cursor_position().ok(), w.outer_position().ok(), w.outer_size().ok()); }
                let _ = handle.emit("pill-hover", inside);
            }
            std::thread::sleep(Duration::from_millis(if visible { 80 } else { 300 }));
        }
    });
}

fn pill_visible(app: &tauri::AppHandle, show: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if let Ok(panel) = handle.get_webview_panel("pill") {
            if show { panel.show() } else { panel.order_out(None) }
            return;
        }
        if let Some(window) = handle.get_webview_window("pill") {
            let _ = if show { window.show() } else { window.hide() };
        }
    });
}

/// The pill's page speaks to this shell over events, which the capability already allows.
fn listen_to_pill(app: &tauri::App) {
    let handle = app.handle().clone();
    app.listen("pill-layout", move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            #[cfg(debug_assertions)]
            eprintln!("layout for {}", v["why"].as_str().unwrap_or("?"));
            pill_layout(&handle, v["width"].as_f64().unwrap_or(360.0), v["height"].as_f64().unwrap_or(100.0), v["recenter"].as_bool().unwrap_or(false));
        }
    });
    let handle = app.handle().clone();
    app.listen("pill-visible", move |event| {
        let show = serde_json::from_str::<serde_json::Value>(event.payload()).ok().and_then(|v| v["show"].as_bool()).unwrap_or(false);
        pill_visible(&handle, show);
    });
    let handle = app.handle().clone();
    app.listen("open-desk", move |_| show_main(&handle));
    let handle = app.handle().clone();
    app.listen("pill-hello", move |_| {
        let notch = handle.try_state::<PillMode>().map(|mode| mode.notch).unwrap_or(None);
        let payload = match notch {
            Some((width, height)) => serde_json::json!({ "kind": "notch", "notch": width, "bar": height }),
            None => serde_json::json!({ "kind": "pill" }),
        };
        let _ = handle.emit("pill-mode", payload);
    });
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Hold ⌥Space anywhere: pressed starts recording on the desk, released sends.
                    let pressed = matches!(event.state(), ShortcutState::Pressed);
                    let _ = app.emit("ptt", pressed);
                })
                .build(),
        )
        .manage(Listener(Mutex::new(None)))
        .setup(|app| {
            ensure_desk(app.handle());
            let ptt = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            if let Err(error) = app.global_shortcut().register(ptt) {
                eprintln!("Push-to-talk key not registered: {error}");
            }
            let menu = build_menu(app.handle(), &Snapshot { status: "Starting…".into(), ..Default::default() })?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "open" => show_main(app),
                        "pill" => {
                            let _ = app.emit("pill-peek", ());
                        }
                        "listen" => {
                            toggle_listener(app);
                            refresh_menu(app, snapshot(app));
                        }
                        "help" => {
                            let _ = app.shell().open(HELP, None);
                        }
                        "quit" => {
                            let _ = app.state::<Listener>().0.lock().unwrap().take().map(|mut child| child.kill());
                            app.exit(0);
                        }
                        _ if id.starts_with("lang:") => {
                            let body = format!("{{\"agentLanguage\":\"{}\"}}", &id[5..]);
                            http("PATCH", "/api/settings", Some(&body));
                            refresh_menu(app, snapshot(app));
                        }
                        _ if id.starts_with("call:") => show_main(app),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event))
                .build(app)?;
            create_pill(app.handle());
            listen_to_pill(app);
            watch_cursor(app.handle());
            // Keep the menu current: the live call's timer, recent calls, the caption language.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last = Snapshot::default();
                loop {
                    let snap = snapshot(&handle);
                    if snap != last {
                        last = snap.clone();
                        refresh_menu(&handle, snap);
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the desk window keeps the app (and the pill) alive in the menu bar.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("NoteFish could not start");
}
