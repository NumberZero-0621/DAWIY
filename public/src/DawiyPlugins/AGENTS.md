# AIエージェントおよび開発者向け DAWIY プラグイン仕様書

このドキュメントは、`public/src/DawiyPlugins` ディレクトリにおけるプラグイン生成と管理を行うAIエージェント、および開発者向けの詳細仕様です。
このディレクトリ以下の情報のみでプラグインが機能するように、必要なコンテキストとルールを以下に定義します。

## ディレクトリ構造とロードの仕組み

- **パス**: `public/src/DawiyPlugins/`
- **自動ロード**: システムはこのディレクトリおよびサブディレクトリ内のすべての `.ts` ファイルをスキャンします。
- **除外対象**: `PluginTemplate.ts` および `IDawiyPlugin.ts` はシステムによって自動的に無視されます。
- **手動登録不要**: ファイルを作成するだけで認識されます。`DawiyPluginController.ts` などの他ファイルを編集する必要はありません。

## 実装プロトコル (厳守)

プラグインを生成する際は、以下の構成ルールに従ってください。

1. **ファイル配置**:
    - 推奨: `public/src/DawiyPlugins/<PluginName>/<MainFile>.ts`
    - 整理のためにサブディレクトリを作成することを強く推奨します。

2. **クラス定義**:
    - `IDawiyPlugin` インターフェースを実装 (`implements`) すること。
    - クラスは必ず **`export default`** すること。

3. **コンストラクタ**:
    - `constructor(app: App)` のシグネチャを持ち、`App` インスタンスを保持すること。

## テンプレートコード

以下のテンプレートをベースに実装してください。

```typescript
import App from "../../App"; // 階層に応じてパスを調整: ../../App
import { IDawiyPlugin } from "../IDawiyPlugin"; // 階層に応じてパスを調整: ../IDawiyPlugin

export default class MyAgentPlugin implements IDawiyPlugin {
    // ユニークなID (他のプラグインと被らないように命名)
    id = "my-agent-plugin";
    // UIに表示される名前
    name = "My Agent Plugin";
    // 機能の説明
    description = "AIエージェントによって生成されたプラグインです。";

    private app: App;
    private container: HTMLElement | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * UIの描画
     * @param container プラグインに割り当てられた描画領域 (divなど)
     */
    public render(container: HTMLElement) {
        this.container = container;
        container.innerHTML = ''; // 再描画のためにクリア
        
        // スタイリング (インラインスタイル推奨、またはクラス定義)
        container.style.padding = "10px";
        container.style.color = "#ecf0f1";
        container.style.overflowY = "auto";

        const title = document.createElement("h3");
        title.textContent = this.name;
        container.appendChild(title);

        const btn = document.createElement("button");
        btn.textContent = "実行";
        btn.onclick = () => this.doAction();
        container.appendChild(btn);
    }

    /**
     * プラグインが表示された時に呼ばれる
     */
    public onActivate() {
        // 必要ならイベントリスナー登録など
    }

    /**
     * プラグインが非表示/クローズされた時に呼ばれる
     */
    public onDeactivate() {
        // クリーンアップ処理
    }

    private doAction() {
        console.log("Action executed by " + this.name);
        // ここで this.app を通じて DAW を操作する
    }
}
```

## API アクセスと操作 (Context)

保持している `this.app` (Appクラスのインスタンス) を通じて DAW の主要コンポーネントにアクセスできます。

### 主要コントローラー

- **`app.tracksController`**: トラック管理
  - `app.tracksController.selectedTrack`: 現在選択されているトラック
  - `app.tracksController.trackList`: トラックの配列
  - `app.tracksController.createAudioTrack()`: 新規トラック作成など (メソッド名は実装を確認すること)
- **`app.regionsController`**: リージョン (オーディオクリップやMIDIノート) 管理
- **`app.host`**: 再生・トランスポート管理
  - `app.host.play()`: 再生
  - `app.host.pause()`: 一時停止
  - `app.host.transportPosition`: 現在の再生位置

### 状態変更 (Undo/Redo)

DAW の状態を変更する操作 (トラック追加、ノート移動など) は、可能な限り `app.doIt(command)` パターンを経由することが推奨されますが、単純な読み取りや一時的な操作であれば直接コントローラーにアクセスしても構いません。

### 注意事項

- UI は必ず引数で渡された `container` 内に構築してください。グローバルな `document.body` などに直接 append しないでください。

### 自己メンテナンスプロトコル

**重要:** `AGENTS.md` は **生きたドキュメント** です。

- **更新時期:**
  1. **アーキテクチャの変更:** 単なるDAWIYプラグインの開発に留まらない、DAWIYプラグインを開発する際に参照すべき、システム構造を変更する主要な機能を実装した場合。
  2. **エラーリカバリ:** ここで古い手順に従ったためにバグが発生した場合は、コードを修正した後、**ドキュメントを修正** してください。
  3. **発見:** ドキュメントには記載されていないが重要な、隠れた規約や「落とし穴」を見つけた場合は、すぐにここに記録してください。
- **目標:** これらのファイルをプロジェクトの長期記憶として扱ってください。システムの内部動作に関するドキュメントの改善は、ユーザーの許可を待たずに行ってください。
