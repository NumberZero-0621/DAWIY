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

## 4. 今後の課題 (他のVSTがクラッシュする原因)

Vitalは動作しましたが、他のVSTがクラッシュする場合、以下の要因が考えられます。

### スレッドモデル (Threading)

- 現在の実装では `pump_messages()` をバックエンドスレッドで実行していますが、これはメインスレッド (UIスレッド) をブロックする可能性があります。
- Windowsのウィンドウプロシージャ (`wnd_proc`) や `WM_TIMER` イベントの処理が、プラグインの期待するスレッドと異なる可能性があります。
- **解決策**: VSTホスティング専用のスレッドを作成し、メッセージループを独立させる必要があります。

### GUIリソース管理

- `IPlugView` の解放忘れや、ウィンドウハンドル (`HWND`) の所有権問題。
- プラグインが閉じる際 (`delete_view`) にリソースが適切に解放されないと、次回起動時にクラッシュします。

### MIDI入力の実装 (次のステップ)

- **インターフェース**: `IMidiMapping` (必須ではないが便利), `IEventList` (ノート情報), `IParamValueQueue` (オートメーション)。
- **処理**: `process` コールバック内で、オーディオバッファと共にイベントリスト (`EventList`) を渡す必要があります。
- **IID**: `IVstMidiController` などのIIDも、`vst3-sys` と標準で異なる可能性があるため注意が必要です。

## まとめ

VST3ホスト開発においては、「仕様書通りに実装しても動かない」ことが多々あります。
特に **IIDのバイトオーダー** と **QueryInterfaceのログ** は、問題解決のための最も強力な手がかりとなります。
不明なエラー (`E_NOINTERFACE`, `E_NOTIMPL`) に遭遇したら、まずは「相手が何を欲しがっているか」をログで可視化することから始めてください。
