// NoteFIsh for Mac: the desk in a window, a pill under the menu bar, and a
// system-wide push-to-talk key. The Node server (server/index.mjs) does the work;
// this shell finds it on 127.0.0.1:3001 or starts it, then hosts the same web UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_shell::ShellExt;

const DESK: &str = "http://127.0.0.1:3001";

/// Where the NoteFIsh checkout lives: NOTEFISH_ROOT, else the folder above src-tauri (dev), else ~/NoteFIsh.
fn notefish_root() -> PathBuf {
    if let Ok(root) = std::env::var("NOTEFISH_ROOT") {
        return PathBuf::from(root);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    if dev.join("server/index.mjs").exists() {
        return dev;
    }
    dirs_home().join("NoteFIsh")
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
        eprintln!("NoteFIsh server not found at {}. Set NOTEFISH_ROOT.", server.display());
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
        Err(error) => eprintln!("Could not start the NoteFIsh server: {error}"),
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The pill: a small always-on-top strip under the menu bar showing call state and the last caption.
fn toggle_pill(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("pill") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
        return;
    }
    let url = format!("{DESK}/pill").parse().expect("pill url");
    if let Ok(window) = WebviewWindowBuilder::new(app, "pill", WebviewUrl::External(url))
        .title("NoteFIsh")
        .inner_size(420.0, 64.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .build()
    {
        let _ = window.move_window(Position::TopCenter);
    }
}

fn main() {
    tauri::Builder::default()
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
        .setup(|app| {
            ensure_desk(app.handle());
            let ptt = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            if let Err(error) = app.global_shortcut().register(ptt) {
                eprintln!("Push-to-talk key not registered: {error}");
            }
            let open = MenuItem::with_id(app, "open", "Open desk", true, None::<&str>)?;
            let pill = MenuItem::with_id(app, "pill", "Show / hide pill", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit NoteFIsh", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &pill, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "pill" => toggle_pill(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event))
                .build(app)?;
            toggle_pill(app.handle());
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
        .expect("NoteFIsh could not start");
}
