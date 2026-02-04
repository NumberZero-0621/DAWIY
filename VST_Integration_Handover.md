# VST統合機能：開発履歴と技術ガイド

このドキュメントは、DAWIYにおけるVST3プラグイン対応の全履歴、直面した技術的課題、現在の解決策、そして将来的な開発のための実験的手順をまとめたものです。

---

## 1. プロジェクトの現状 (The Stable Way)

現在、DAWIYは外部ツールと連携することでVST3プラグインの再生を実現しています。

- **アーキテクチャ**:
  - **Frontend**: `VstPluginController` が `SAVIHost` (外部exe) を子プロセスとして起動。
  - **Backend**: Rust (`vst_launcher.rs`, `midi.rs`) がプロセス管理とMIDI出力を担当。
  - **通信**: Rustの `midir` クレートを使用し、仮想MIDIケーブル（例: loopMIDI）経由で `SAVIHost` に演奏データを送信。
- **メリット**: 安定して音が出る。プラグインのGUIが確実に表示される。
- **デメリット**: プラグインが別ウィンドウになる。事前の環境構築（loopMIDI等）が必要。

---

## 2. 過去の挑戦：ネイティブ・ホスティング (The Hard Way)

プロジェクト初期〜中期にかけて、DAWIYウィンドウ内にVST3 GUIを直接埋め込む「ネイティブ実装」が試みられました。
コードは `src-tauri/src/vst_host.rs` に残されています。

### 2.1 実装アプローチ

- `libloading` クレートを使用し、`.vst3` (DLL) を動的にロード。
- `vst3-sys` 等の外部クレートを使わず、Rustコード内でCOM (Component Object Model) インターフェース (`IPluginFactory`, `IComponent`, `IEditController`) を手動で定義・実装。
- `winit` で作成した親ウィンドウのハンドル (HWND) をプラグインに渡し、`IPlugView::attached` でGUIを描画させる。

### 2.2 直面した壁と失敗の原因

実験は難航し、以下の技術的障壁により一時凍結されました。

1. **COM/ABIの不整合 (The "offset" hell)**
    - VST3はC++の多重継承 (`class EditController : public IEditController, public IPluginBase`) を多用します。
    - RustからのFFI呼び出しでは、インターフェースごとの `this` ポインタのズレ（オフセット）を手動で計算する必要がありましたが、正しいVTBL（仮想関数テーブル）を引き当てられず、関数呼び出し時にクラッシュや誤動作が多発しました。
    - ログには `DEBUG: object[1] looks like a pointer!` といった、メモリレイアウトを手探りで解析した苦闘の跡が残っています。

2. **GetPluginFactoryのシグネチャ問題**
    - 初期の実装では `DllGetClassObject` 形式のシグネチャを使っていましたが、VST3規格では `extern "C" IPluginFactory* GetPluginFactory()` が正解であり、入り口から躓いていました（後に修正されましたが、その先で新たな壁に当たりました）。

3. **スレッドモデルとGUI**
    - `createView` 呼び出し時にメモリアクセス違反が発生。VST3プラグインはGUIスレッド（メインスレッド）での初期化を強く要求しますが、Tauriのイベントループとの統合が複雑で、適切なスレッドコンテキストを提供できていなかった可能性があります。

---

## 3. 実験的ガイド：ネイティブ実装に戻すには

「それでもネイティブ実装に挑みたい」「`vst_host.rs` の修正を試したい」という開発者のために、現在の安定版から実験版（ネイティブモード）へ切り替える手順を記します。

### ステップ1: Frontendの切り替え

`public/src/Controllers/VstPluginController.ts` を開き、プラグイン起動メソッドを書き換えます。

```typescript
// public/src/Controllers/VstPluginController.ts

// 【現状】SAVIHost起動モード
public async launchVstStandalone(pluginPath: string): Promise<void> {
    if (!isDesktop()) return;
    try {
        this.app.showToast("Launching VST standalone...");
        // SAVIHostランチャーを呼び出す
        const result = await invoke<string>("launch_vst_standalone", { pluginPath });
        console.log("[VST] Launch result:", result);
    } catch (e) {
        // ...
    }
}
```

これを以下のように書き換えます：

```typescript
// 【実験】ネイティブホスト起動モード
public async launchVstStandalone(pluginPath: string): Promise<void> {
    if (!isDesktop()) return;
    try {
        this.app.showToast("Opening Native Editor (Experimental)...");
        // ネイティブホスト機能を呼び出す
        // ※このコマンドは lib.rs にまだ残っており実装されています
        const result = await invoke<string>("open_vst_editor", { path: pluginPath }); 
        console.log("Native Editor Result:", result);
    } catch (e) {
        console.error("Native Editor Crash:", e);
        this.app.showToast("Native Editor Failed: " + e, true);
    }
}
```

### ステップ2: 実行とデバッグ

- アプリをリロードし、VSTプラグインを開こうとすると、バックエンドの `vst_host.rs/load_and_open` が走ります。
- ほぼ確実にクラッシュするか、エラーログが出力されます。
- ターミナルのログを確認し、`vst_host.rs` の修正を行ってください。

### ステップ3: 復旧（SAVIHostモードに戻す）

- `VstPluginController.ts` の変更を元に戻すだけです。
- バックエンドのコード (`vst_host.rs`) は、呼び出されなければ無害なので、そのままで構いません。

---

## 4. 将来への提言

もし将来的にネイティブ実装を完成させるなら、現在の `vst_host.rs` （手動COM定義の塊）をベースにするよりも、以下の最新のRustエコシステムを活用して**ゼロから書き直す**ことを強く推奨します。

- **[windows-rs](https://github.com/microsoft/windows-rs)**: COMの実装が非常に容易かつ安全になります (`IUnknown` などを手書きする必要がありません)。
- **[vst3-sys](https://crates.io/crates/vst3-sys)**: VST3の公式SDKから生成されたRustバインディング。ABIの不整合に悩まされるリスクが激減します。
- **[imgui-rs](https://github.com/imgui-rs/imgui-rs)** などのGUIライブラリと組み合わせて、プラグインのパラメータだけを表示する（Generic Editor）アプローチも、完全なGUIホスティングよりは近道かもしれません。

---
*Document updated on 2026-02-04*
