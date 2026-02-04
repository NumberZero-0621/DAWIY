// Carla VST Host Integration
// CarlaをOSC APIで制御してVSTプラグインを読み込みGUIを表示する

use std::net::UdpSocket;
use std::process::{Child, Command};
use std::path::Path;
use rosc::{OscMessage, OscPacket, OscType};
use rosc::encoder;

// Carlaのデフォルト設定
const CARLA_OSC_HOST: &str = "127.0.0.1";
const CARLA_OSC_PORT: u16 = 22752;  // CarlaのデフォルトOSCポート

/// Carlaプロセス管理構造体
pub struct CarlaHost {
    process: Option<Child>,
    osc_socket: Option<UdpSocket>,
    carla_path: String,
}

impl CarlaHost {
    /// 新しいCarlaホストインスタンスを作成
    pub fn new(carla_path: &str) -> Self {
        CarlaHost {
            process: None,
            osc_socket: None,
            carla_path: carla_path.to_string(),
        }
    }
    
    /// Carlaプロセスを起動
    pub fn start(&mut self) -> Result<(), String> {
        // Carla実行ファイルのパスを確認
        if !Path::new(&self.carla_path).exists() {
            return Err(format!("Carla not found at: {}", self.carla_path));
        }
        
        // Carlaを起動（OSCモード有効）
        let child = Command::new(&self.carla_path)
            .arg("--osc-gui=22752")  // OSC GUIポートを指定
            .spawn()
            .map_err(|e| format!("Failed to start Carla: {}", e))?;
        
        self.process = Some(child);
        
        // OSCソケットを作成
        let socket = UdpSocket::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to create OSC socket: {}", e))?;
        
        self.osc_socket = Some(socket);
        
        println!("[TAURI] Carla started with OSC on port {}", CARLA_OSC_PORT);
        Ok(())
    }
    
    /// プラグインを読み込み
    pub fn load_plugin(&self, plugin_path: &str) -> Result<u32, String> {
        let msg = OscMessage {
            addr: "/Carla/add".to_string(),
            args: vec![OscType::String(plugin_path.to_string())],
        };
        
        self.send_osc_message(msg)?;
        
        // プラグインIDを返す（Carlaからの応答を待つ必要があるが、今は簡略化）
        Ok(0)
    }
    
    /// プラグインGUIを表示
    pub fn show_plugin_gui(&self, plugin_id: u32) -> Result<(), String> {
        let msg = OscMessage {
            addr: format!("/Carla/{}/set_option", plugin_id),
            args: vec![
                OscType::String("ShowGui".to_string()),
                OscType::Int(1),
            ],
        };
        
        self.send_osc_message(msg)
    }
    
    /// OSCメッセージを送信
    fn send_osc_message(&self, msg: OscMessage) -> Result<(), String> {
        let socket = self.osc_socket.as_ref()
            .ok_or("OSC socket not initialized")?;
        
        let packet = OscPacket::Message(msg);
        let buf = encoder::encode(&packet)
            .map_err(|e| format!("Failed to encode OSC message: {:?}", e))?;
        
        let addr = format!("{}:{}", CARLA_OSC_HOST, CARLA_OSC_PORT);
        socket.send_to(&buf, &addr)
            .map_err(|e| format!("Failed to send OSC message: {}", e))?;
        
        Ok(())
    }
    
    /// Carlaプロセスを停止
    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(ref mut process) = self.process {
            process.kill()
                .map_err(|e| format!("Failed to kill Carla: {}", e))?;
        }
        self.process = None;
        self.osc_socket = None;
        Ok(())
    }
    
    /// Carlaが実行中かどうか
    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }
}

impl Drop for CarlaHost {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// グローバルなCarlaホストインスタンス（Mutexで保護）
use std::sync::Mutex;
use once_cell::sync::Lazy;

pub static CARLA_HOST: Lazy<Mutex<Option<CarlaHost>>> = Lazy::new(|| Mutex::new(None));

/// Carlaを使ってVSTプラグインを開く（Tauriコマンド）
#[tauri::command]
pub fn open_vst_with_carla(
    plugin_path: String,
    carla_path: Option<String>,
) -> Result<String, String> {
    // Carlaのパスを決定（指定がない場合は一般的なパスを試す）
    let carla_exe = carla_path.unwrap_or_else(|| {
        // 一般的なCarlaの場所を順に試す
        let candidates = vec![
            "C:\\Program Files\\Carla-2.5.10-win64\\Carla.exe".to_string(),
            "C:\\Program Files\\Carla\\Carla.exe".to_string(),
            "C:\\Program Files (x86)\\Carla\\Carla.exe".to_string(),
        ];
        
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                return path.clone();
            }
        }
        
        // デフォルト
        candidates[0].clone()
    });
    
    let mut host_guard = CARLA_HOST.lock().unwrap_or_else(|e| e.into_inner());
    
    // Carlaがまだ起動していなければ起動
    if host_guard.is_none() {
        let mut host = CarlaHost::new(&carla_exe);
        host.start()?;
        *host_guard = Some(host);
    }
    
    // プラグインを読み込んでGUIを表示
    if let Some(ref host) = *host_guard {
        let plugin_id = host.load_plugin(&plugin_path)?;
        host.show_plugin_gui(plugin_id)?;
        Ok(format!("Plugin loaded with ID: {}", plugin_id))
    } else {
        Err("Carla host not available".to_string())
    }
}

/// Carlaを停止（Tauriコマンド）
#[tauri::command]
pub fn stop_carla() -> Result<(), String> {
    let mut host_guard = CARLA_HOST.lock().unwrap_or_else(|e| e.into_inner());
    
    if let Some(ref mut host) = *host_guard {
        host.stop()?;
    }
    *host_guard = None;
    
    Ok(())
}
