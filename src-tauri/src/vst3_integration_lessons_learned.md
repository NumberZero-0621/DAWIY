# VST3実装とデバッグの知見 (Vital統合からの学び)

このドキュメントは、Vitalプラグインの統合成功に至る過程で得られた技術的知見、ハマりポイント、および今後の開発に向けた注意点をまとめたものです。

## 1. IID (Interface Identifier) の不一致問題

最も大きな障壁となったのは、`IConnectionPoint` インターフェースのIID定義が標準と異なる点でした。

- **標準的なVST3 SDK**: `AB0CFFBF-497A-47C7-B026-4493D8DD9EFA`
- **vst3-sysクレート / Vital**: `70A4156F-6E6E-4026-9891-48BFAA60D8D1`

### 現象

- `IConnectionPoint::Connect` (ハンドシェイク) が `E_NOINTERFACE` で失敗する。
- 双方 (ComponentとController) が互いのインターフェースを認識できず、接続が確立されない。

### 対処法

- Rustコード側で定義するIIDを、プラグインが実際に要求/実装しているIIDに合わせる必要があります。
- 「診断コード」(`QueryInterface` を総当たりで実行して結果を見る) を実装し、プラグインがどのIIDに反応するかを確認するのが確実です。

## 2. 必須インターフェースの実装 (IComponentHandler3)

一部の高度なプラグイン (Vitalなど) は、初期化時に特定のインターフェースをホスト側に要求します。

- **IComponentHandler3**: コンテキストメニューの作成 (`create_context_menu`) などを担当。
- **IPlugFrame**: ウィンドウのリサイズ (`resize_view`) を担当。

### 現象

- `IComponentHandler3` が実装されていないと、Vitalは初期化プロセスを中断したり、GUIの作成を拒否 (`create_view` が NULL を返す) したりします。

### 知見

- ホスト側 (`UnifiedHost`) は、可能な限り多くのハンドラインターフェース (`Handler`, `Handler2`, `Handler3`) を実装すべきです。
- メソッドの中身は `kNotImplemented` や `NULL` を返すスタブであっても、「インターフェース自体が存在する」こと (`QueryInterface` が成功すること) が重要です。

## 3. 初期化シーケンスとクラッシュ回避

VST3プラグインのライフサイクルには厳密な順序があります。

### 正しい順序

1. **Initialize**: ComponentとControllerの初期化。
2. **Connect**: `IConnectionPoint` による接続。
3. **Sync**: `Component::get_state` -> `Controller::set_component_state` (状態同期)。
4. **Activate**: `Component::set_active(true)`。
5. **Scan Parameters**: パラメータ数の取得やGUIの作成。

### バグの例 (Activation Order)

- `set_active(true)` を `set_component_state` の **前** に実行した場合、Vitalは `get_state` 呼び出し時にクラッシュしました (`Access Violation`)。
- 一部のプラグインは、非アクティブ状態でないと状態のセットアップを受け付けない設計になっているようです。

## 4. スレッドモデルとアーキテクチャ (STA)

VitalやVoisonaなどの一部のVSTは、**スレッドアフィニティ** (特定のスレッドでのみ実行されること) に強く依存しています。

### 現象

- 複数のVSTインスタンスを異なるスレッドで開くと、GUIがフリーズする (メッセージループの競合やデッドロック)。
- "Channel closed" エラーが発生する (メッセージキューの破棄タイミングの問題)。

### 解決策: シングルスレッドアーキテクチャ (STA)

全てのVSTインスタンスの管理とメッセージループを **単一の専用スレッド (Coordinator Thread)** に集約しました。

1. **Coordinator**: グローバルなスレッド (`VstCoordinator`) が起動し、`PeekMessage` ループを回し続ける。
2. **Channel Comm**: 各VSTのロード要求は `std::sync::mpsc` チャンネルを通じてCoordinatorに送られる。
3. **Non-Blocking**: `create_vst_instance` はブロックせず、生成されたインスタンスへのハンドル (`VstInstance`) を即座に返す。
4. **Cleanup**: ウィンドウが閉じられた際 (`WM_DESTROY`)、`wnd_proc` から `WM_VST_DROP_INSTANCE` メッセージをCoordinatorに投げて、安全にインスタンスを破棄する。

## 5. DLLの参照カウントと初期化 (InitDll / ExitDll)

Windows上のVST3 (特にJUCE製) は、DLLのエントリーポイントとして `InitDll` と `ExitDll` を提供する場合があります。

### 現象

- 同じDLLから複数のインスタンスを生成する際、インスタンスごとに `InitDll` を呼ぶと内部状態が破損し、フリーズやクラッシュが発生する。

### 対処法

- `LOADED_LIBRARIES` という静的なマップ (`Lazy<Mutex<HashMap<isize, usize>>>`) を導入し、ロードされたDLLのハンドル (`HMODULE`) ごとに参照カウントを管理。
- **InitDll**: 参照カウントが 0 -> 1 になるときだけ呼ぶ。
- **ExitDll**: 参照カウントが 1 -> 0 になるときだけ呼ぶ。
- 参照カウントが残っている間は `FreeLibrary` を呼ばない。

## 6. ウィンドウ管理とゴースト現象

### クラッシュ回避 (0xc000041d)

- `DestroyWindow` は `FreeLibrary` の **前** に呼ぶ必要があります。
- 逆にしてしまうと、ウィンドウ破棄中のメッセージ処理 (`WM_NCDESTROY` 等) で、既にアンロードされたDLL内のコードを実行しようとしてクラッシュします。

### GUIゴースト (描画残像)

- 固定サイズのVSTウィンドウをリサイズ・最大化した際、GUIの外側の領域に前の描画が残る (ゴースト) 現象が発生。
- **解決策**: ウィンドウクラス (`WNDCLASSW`) の `hbrBackground` に `BLACK_BRUSH` を設定することで、未描画領域を黒で塗りつぶすように修正。

## 7. ヘッドレスVSTの対応

GUIを持たないVST (例: `metronome.vst3`) への対応。

### 知見

- `IEditController::create_view` が `NULL` を返した場合、それをエラーとして扱わず、「ヘッドレスモード」として続行する。
- ウィンドウタイトルに `(No GUI)` と表示し、ビューの作成リトライループに入らないようにする。

## まとめ

VST3ホスト開発においては、「仕様書通りに実装しても動かない」ことが多々あります。
特に **スレッドモデル (STA)** と **DLLのライフサイクル管理 (参照カウント)** は、安定したホストを実現するための重要な鍵となります。
不明なエラー (`E_NOINTERFACE`, `E_NOTIMPL`) に遭遇したら、まずは「相手が何を欲しがっているか」をログで可視化することから始めてください。
