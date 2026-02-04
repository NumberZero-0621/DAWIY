use midir::{MidiOutput, MidiOutputConnection};
use std::sync::Mutex;
use once_cell::sync::Lazy;

// グローバルなMIDI接続状態
// 一度に1つの出力ポートに接続するシンプルな設計
static MIDI_CONNECTION: Lazy<Mutex<Option<MidiOutputConnection>>> = Lazy::new(|| Mutex::new(None));

/// 利用可能なMIDI出力ポートの名前リストを返す
#[tauri::command]
pub fn list_midi_outputs() -> Result<Vec<String>, String> {
    let midi_out = MidiOutput::new("DAWIY_List").map_err(|e| format!("{}", e))?;
    let ports = midi_out.ports();
    
    let mut names = Vec::new();
    for port in ports {
        if let Ok(name) = midi_out.port_name(&port) {
            names.push(name);
        }
    }
    
    Ok(names)
}

/// 指定した名前のポートを開く
#[tauri::command]
pub fn open_midi_output(port_name: String) -> Result<String, String> {
    // 既存の接続があれば閉じる
    close_midi_output()?;

    let midi_out = MidiOutput::new("DAWIY_Out").map_err(|e| format!("{}", e))?;
    let ports = midi_out.ports();
    
    // ポート名が一致するものを探す
    let port = ports.into_iter()
        .find(|p| midi_out.port_name(p).unwrap_or_default() == port_name)
        .ok_or(format!("MIDI Output port '{}' not found", port_name))?;

    // 接続
    let conn = midi_out.connect(&port, "DAWIY_Connection")
        .map_err(|e| format!("Failed to connect to MIDI port: {}", e))?;
        
    // 接続を保存
    if let Ok(mut connection) = MIDI_CONNECTION.lock() {
        *connection = Some(conn);
    }
    
    println!("[TAURI] Connected to MIDI Output: {}", port_name);
    Ok(format!("Connected to {}", port_name))
}

/// MIDI接続を閉じる
#[tauri::command]
pub fn close_midi_output() -> Result<(), String> {
    if let Ok(mut connection) = MIDI_CONNECTION.lock() {
        if let Some(conn) = connection.take() {
            conn.close(); // 明示的に閉じる（dropでも閉じられるが）
            println!("[TAURI] MIDI Output closed");
        }
    }
    Ok(())
}

/// MIDIメッセージを送信する
#[tauri::command]
pub fn send_midi_message(message: Vec<u8>) -> Result<(), String> {
    if let Ok(mut connection) = MIDI_CONNECTION.lock() {
        if let Some(conn) = connection.as_mut() {
            // eprintln!("[MIDI Debug] Sending: {:?}", message);
            conn.send(&message).map_err(|e| format!("Failed to send MIDI message: {}", e))?;
            return Ok(());
        }
    }
    // 接続がない場合はエラーにせず無視する（頻繁に呼び出されるため）
    // Err("No MIDI Output connected".to_string())
    Ok(())
}
