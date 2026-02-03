# VST統合機能 引き継ぎドキュメント

## 1. 現状の到達点

### Frontend (完了)

- **VST Proxy WAM (`VstProxy`)**: 実装完了。
  - `vst://` プロトコルをフックして仮想的にWAMとしてロードされます。
  - UI上の「Open VST Interface」ボタンが機能し、バックエンドへ `open_vst_editor` コマンドを送信します。
- **Plugin Scanning**: 実装完了。
  - Rustバックエンドの `scan_plugins` を呼び出し、結果を `WamPluginController` に登録してUIに表示できています。

### Backend (Rust) (プロトタイプ段階)

- **Module**: `src-tauri/src/vst_host.rs`
- **機能**:
  - 指定されたDLL(`.vst3`)をロード。
  - `winit` (v0.29) を使用してウィンドウを作成。
  - VST3プラグインのインスタンス化とアタッチを試行。
- **依存関係**:
  - `vst3-sys` クレートは使用せず、`vst_host.rs` 内に手動でCOM/VST3インターフェース定義を記述しています（依存関係エラー回避のため）。

## 2. 現在発生している問題

**症状:**

- アプリは起動し、ボタンを押すとバックエンド呼び出しまで成功する。
- しかしVSTウィンドウの中身が表示されず、以下のエラーログが出る。

  ```
  [TAURI] VST Host Error: Failed to get IPluginFactory
  ```

**原因分析 (重要):**

- `vst_host.rs` 内での `GetPluginFactory` 関数のシグネチャ定義が誤っている可能性が高いです。
- **現在の実装**: `unsafe extern "system" fn(factory: *mut *mut ...) -> i32` (COMの `DllGetClassObject` スタイル)
- **正しいVST3仕様**: `extern "C" IPluginFactory* GetPluginFactory ()` (戻り値として直接ポインタを返す)

## 3. 次のエージェントへの指示 (To-Do)

1. **`src-tauri/src/vst_host.rs` の修正**:
    - `GetPluginFactory` の型定義を修正してください。

      ```rust
      // 修正前
      type GetPluginFactory = unsafe extern "system" fn(factory: *mut *mut *mut IPluginFactoryVTable) -> i32;
      
      // 修正案 (ABIがCであることを確認)
      type GetPluginFactory = unsafe extern "C" fn() -> *mut *mut IPluginFactoryVTable;
      ```

    - 呼び出し部分のロジックを、戻り値チェックからポインタ取得に変更してください。

2. **ウィンドウハンドル (HWND) の受け渡し確認**:
    - 現在 `winit` から `raw_window_handle` 経由で HWND を取得していますが、これが `attached` メソッドに正しく渡されているか（ポインタのキャストなどが適切か）確認してください。

3. **イベントループの挙動確認**:
    - 現在別スレッドで `event_loop` を回していますが、VST3プラグインによってはメインスレッドでのGUI作成を要求するものがあります（macOSでは必須、Windowsでは多くの場合許容されるがプラグインによる）。動作が不安定な場合、メインスレッドへのディスパッチを検討してください（ただしTauriとの兼ね合いが難易度高）。

4. **`Initialize` の実装**:
    - 現在 `component.initialize(ptr::null())` をスキップしていますが、一部のプラグインはこれを必須とします。必要であればダミーの `IHostApplication` を実装して渡してください。

## 4. 関連ファイル

- `c:\Documents\UnivFukuchiyama\DAWIY\src-tauri\src\vst_host.rs`: VST3ホスティングの全ロジック
- `c:\Documents\UnivFukuchiyama\DAWIY\src-tauri\src\lib.rs`: コマンド登録部
- `c:\Documents\UnivFukuchiyama\DAWIY\bank\plugins\VstProxy\index.js`: フロントエンドの呼び出し元
