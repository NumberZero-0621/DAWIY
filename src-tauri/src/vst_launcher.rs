// VST Standalone Launcher
// VSTプラグインのスタンドアロン版を起動する

use std::process::{Child, Command};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use once_cell::sync::Lazy;

// 起動されたプロセスを追跡
static LAUNCHED_PROCESSES: Lazy<Mutex<Vec<Child>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// スタンドアロンVSTの検索パス
fn find_standalone_exe(plugin_name: &str, plugin_path: &str) -> Option<String> {
    let mut candidates = vec![
        // VSTプラグインと同じ場所の同名exe (SAVIHostでリネームした場合)
        Path::new(plugin_path)
            .parent()
            .map(|p| p.join(format!("{}.exe", plugin_name)).to_string_lossy().to_string())
            .unwrap_or_default(),
            
        // プラグイン固有のインストール場所
        format!("C:\\Program Files\\{}\\{}.exe", plugin_name, plugin_name),
        format!("C:\\Program Files (x86)\\{}\\{}.exe", plugin_name, plugin_name),
        // VSTStandaloneフォルダ（SAVIHostで作成したもの用）
        format!("C:\\VSTStandalone\\{}.exe", plugin_name),
    ];
    
    // 空文字列を除外
    candidates.retain(|p| !p.is_empty());
    
    for path in candidates {
        if Path::new(&path).exists() {
            return Some(path);
        }
    }
    
    None
}

/// プラグイン名をパスから抽出
fn extract_plugin_name(plugin_path: &str) -> String {
    Path::new(plugin_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

/// スタンドアロンVSTを起動（Tauriコマンド）
#[tauri::command]
pub fn launch_vst_standalone(plugin_path: String) -> Result<String, String> {
    let plugin_name = extract_plugin_name(&plugin_path);
    
    println!("[TAURI] Looking for standalone version of: {}", plugin_name);
    
    // スタンドアロン版を検索
    if let Some(standalone_path) = find_standalone_exe(&plugin_name, &plugin_path) {
        println!("[TAURI] Found standalone at: {}", standalone_path);
        launch_process(&standalone_path, &plugin_name)
    } else {
        // 見つからない場合、SAVIHostを使って自動作成を試みる
        match ensure_standalone_exe(&plugin_name, &plugin_path) {
            Ok(created_path) => {
                println!("[TAURI] Created standalone executable: {}", created_path);
                launch_process(&created_path, &plugin_name)
            },
            Err(e) => {
                // 自動作成も失敗した場合のメッセージ
                Err(format!(
                    "Standalone version of '{}' not found and auto-creation failed: {}\n\
                    \n\
                    Please try manually:\n\
                    1. Download SAVIHost (savihost.exe)\n\
                    2. Place it next to your plugin: {}\n\
                    3. Rename it to {}.exe",
                    plugin_name, e, plugin_path, plugin_name
                ))
            }
        }
    }
}

// プロセスを起動して記録するヘルパー関数
fn launch_process(exe_path: &str, name: &str) -> Result<String, String> {
    let child = Command::new(exe_path)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", name, e))?;
    
    if let Ok(mut processes) = LAUNCHED_PROCESSES.lock() {
        processes.push(child);
    }
    
    Ok(format!("Launched {} from {}", name, exe_path))
}



// SAVIHostのexeを探してコピーする
fn ensure_standalone_exe(plugin_name: &str, plugin_path: &str) -> Result<String, String> {
    // Current Directoryを取得して絶対パス解決を試みる
    let current_dir = std::env::current_dir().unwrap_or_else(|_| Path::new(".").to_path_buf());
    println!("[TAURI] Current directory: {:?}", current_dir);

    // プラグインの種類を判定
    let is_vst3 = plugin_path.to_lowercase().ends_with(".vst3");
    
    // マスターとなるsavihost.exeの候補場所
    let mut master_candidates: Vec<std::path::PathBuf> = Vec::new();
    
    if is_vst3 {
        // VST3用ホスト（savihost3x64）を優先
        master_candidates.push(current_dir.join("savihost\\savihost3x64\\savihost.exe"));
        master_candidates.push(current_dir.join("src-tauri\\resources\\savihost3x64\\savihost.exe"));
        // フォールバック
        master_candidates.push(current_dir.join("savihost.exe"));
    } else {
        // VST2用ホスト（savihostx64）を優先
        master_candidates.push(current_dir.join("savihost\\savihostx64\\savihost.exe"));
        master_candidates.push(current_dir.join("src-tauri\\resources\\savihostx64\\savihost.exe"));
        master_candidates.push(current_dir.join("savihost.exe"));
    }

    // 共通のバックアップパス（固定パス）
    master_candidates.push(Path::new("C:\\VSTStandalone\\savihost.exe").to_path_buf());
    master_candidates.push(Path::new("C:\\Users\\jotar\\Desktop\\savihost.exe").to_path_buf());
    
    // 最初に見つかったパスを使用
    let master_path = master_candidates.iter()
        .find(|p| p.exists())
        .ok_or_else(|| {
            let search_paths = master_candidates.iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("\n- ");
            
            if is_vst3 {
                format!("SAVIHost (VST3 version) not found.\nSearched at:\n- {}", search_paths)
            } else {
                format!("SAVIHost (VST2 version) not found.\nSearched at:\n- {}", search_paths)
            }
        })?;
        
    // ターゲットパスの決定：VST3バンドル対応
    let path_obj = Path::new(plugin_path);
    let mut target_dir = path_obj.parent().ok_or("Invalid plugin path")?;
    
    // もしパスが .vst3 フォルダそのものでなく、その中身（Contents/...）を指している場合、または
    // .vst3パス自体がディレクトリとして扱われるべき場合（バンドル）
    // 通常のSAVIHostの使い方は、.vst3バンドルフォルダの「隣」にexeを置くこと
    
    // パスの中に ".vst3" が含まれていて、かつ現在地がその中にある場合
    let path_str = plugin_path.to_string();
    if let Some(idx) = path_str.to_lowercase().rfind(".vst3") {
        let vst3_root_end = idx + 5; // ".vst3".len() == 5
        if vst3_root_end <= path_str.len() {
            let vst3_root = &path_str[..vst3_root_end];
            // バンドルの親ディレクトリを取得
            if let Some(parent) = Path::new(vst3_root).parent() {
                target_dir = parent;
                println!("[TAURI] VST3 Bundle detected. Adjusting target dir to: {:?}", target_dir);
            }
        }
    }

    let target_path = target_dir.join(format!("{}.exe", plugin_name));
        
    println!("[TAURI] Copying SAVIHost from {:?} to {:?}", master_path, target_path);
    
    std::fs::copy(master_path, &target_path)
        .map_err(|e| format!("Failed to copy savihost.exe from {:?}: {}", master_path, e))?;
        
    Ok(target_path.to_string_lossy().to_string())
}

/// すべての起動したプロセスを終了（Tauriコマンド）
#[tauri::command]
pub fn stop_all_vst() -> Result<(), String> {
    if let Ok(mut processes) = LAUNCHED_PROCESSES.lock() {
        for process in processes.iter_mut() {
            let _ = process.kill();
        }
        processes.clear();
        println!("[TAURI] All VST processes stopped");
    }
    Ok(())
}

/// 任意の実行ファイルを直接起動（Tauriコマンド）
#[tauri::command]
pub fn launch_executable(exe_path: String) -> Result<String, String> {
    if !Path::new(&exe_path).exists() {
        return Err(format!("Executable not found: {}", exe_path));
    }
    
    let child = Command::new(&exe_path)
        .spawn()
        .map_err(|e| format!("Failed to launch: {}", e))?;
    
    if let Ok(mut processes) = LAUNCHED_PROCESSES.lock() {
        processes.push(child);
    }
    
    Ok(format!("Launched: {}", exe_path))
}
