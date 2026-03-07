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
    - `DawiyPluginBase` クラスを継承 (`extends`) すること。
    - `@DAWIYPlugin` デコレーターを使用すること。
    - クラスは必ず **`export default`** すること。

3. **コンストラクタ**:
    - `constructor(app: App)` のシグネチャを持ち、`super(app)` を呼び出すこと。

4. **設定ファイル (plugin.json) [任意]**:
    - メタデータ（名前や説明）を明確に定義する場合に使用します。
    - 外部ライブラリのロードには `this.dynamicImport` を使用してください。依存関係定義は廃止されました。

5. **グループ化 (Grouping) [任意]**:
    - プラグインのグループを指定するには、`group` プロパティを設定します（デフォルトは "General"）。
    - 今後、以下のカテゴリーIDに基づく分類が強化される予定です。

    ```typescript
    group = "generator"; // または "modifier", "analysis", "io", "ui"
    ```

## プラグインカテゴリー定義

プラグインはその機能と役割に応じて以下の5つのカテゴリーに分類されます。

| カテゴリーID | 名称 | 概要 | 実装例 |
| :--- | :--- | :--- | :--- |
| `generator` | **Generator** (生成) | ノート、オーディオ、パターンを生成してトラックに追加する。 | リズム生成、コード進行生成、AIメロディ生成 |
| `modifier` | **Modifier** (加工) | 既存のノートやオーディオデータを選択・加工する。 | クオンタイズ、ベロシティ調整、ヒューマナイズ、一括転調 |
| `analysis` | **Analysis** (解析) | 楽曲情報の可視化・分析を行う。UIへの表示を伴うことが多い。 | スペクトラムアナライザ、コード解析表示、楽曲構造の可視化 |
| `io` | **IO** (入出力) | 外部ファイル形式の読み込み・書き出し機能を追加する。 | MusicXMLインポート、専用譜面データエクスポート、他DAW形式対応 |
| `ui` | **UI** (UI) | 全体的な見た目の変更や言語、ショートカット等の拡張を行う。 | テーマ変更、ダークモード拡張、言語パック、キーバインド変更 |

## 外部ライブラリ (Dynamic Import)

単純化された動的インポート機構を利用します。

```typescript
// 推奨
const module = await this.dynamicImport('https://cdn.jsdelivr.net/npm/tonal/browser/tonal.min.js');
```

## テンプレートコード

以下のテンプレートをベースに実装してください。

```typescript
import App from "../../App"; // 階層に応じてパスを調整
import { DAWIYPlugin } from "../IDawiyPlugin"; // 階層に応じてパスを調整
import DawiyPluginBase from "../DawiyPluginBase";

@DAWIYPlugin
export default class MyAgentPlugin extends DawiyPluginBase {
    // ユニークなID (他のプラグインと被らないように命名)
    id = "my-unique-plugin";
    // UIに表示される名前
    name = "My Unique Plugin";
    // 機能の説明
    description = "ユニークなプラグインです。";

    constructor(app: App) {
        super(app);
    }

    /**
     * 初期化 (HostAPIの受け取り)
     */
    public override onInit(host: any) {
        super.onInit(host);
        
        // サイドバーへの登録例
        /*
        const div = document.createElement("div");
        div.innerText = "Hello Sidebar";
        host.ui.registerSidebarItem("my-sidebar", "bi-star", "My Sidebar", div);
        */
    }

    /**
     * UIの描画 (プラグインマネージャー内のプレビューなどで使用)
     * @param container プラグインに割り当てられた描画領域 (divなど)
     */
    public override render(container: HTMLElement) {
        container.innerHTML = '';
        container.style.padding = "10px";
        container.style.color = "#ecf0f1";

        const title = document.createElement("h3");
        title.textContent = this.name;
        container.appendChild(title);

        const btn = document.createElement("button");
        btn.textContent = "実行";
        btn.className = "btn btn-primary";
        btn.onclick = () => this.doAction();
        container.appendChild(btn);
    }

    /**
     * プラグインが表示された時に呼ばれる
     */
    public override onActivate() {
        // 必要ならイベントリスナー登録など
        console.log("MyPlugin activated");
    }

    /**
     * プラグインが非表示/クローズされた時に呼ばれる
     */
    public override onDeactivate() {
        // クリーンアップ処理
    }

    private async doAction() {
        // HostAPIの使用例
        this.app.hostAPI.ui.showToast("Action executed!");
        
        // ファイルシステムの使用例
        // await this.app.hostAPI.fs.writeFile("test.txt", "Hello World");
    }
}

```

## API アクセスと操作 (HostAPI)

`this.app.hostAPI` を通じて、UI構築、ファイル操作、インポート/エクスポートなどの拡張機能にアクセスできます。

### UI 拡張 (`hostAPI.ui`)

- **`hostAPI.ui.registerSidebarItem(id, iconClass, label, element)`**:
  サイドバーに新しいタブを追加します。
  - `iconClass`: Bootstrap Icons クラス (例: "bi-star")
  - `element`: パネルの中身となる HTMLElement
- **`hostAPI.ui.showToast(message, isError?)`**: トースト通知を表示します。
- **`hostAPI.ui.openWindow(title, content)`**: フローティングウィンドウを開きます (実験的)。

### ファイルシステム (`hostAPI.fs`)

Tauri環境とWeb環境の両方で動作する抽象化レイヤーです。

- **`hostAPI.fs.readFile(path?)`**: テキストファイルを読み込みます。Webではファイルピッカーが開きます。
- **`hostAPI.fs.writeFile(path, content)`**: ファイルを保存します。Webではダウンロードになります。
- **`hostAPI.fs.showOpenDialog(options)`**: ファイル選択ダイアログを開きます (Tauriのみ)。

### I/O 拡張 (`hostAPI.io`)

- **`hostAPI.io.registerImporter(extension, callback)`**:
  特定の拡張子 (`.sampletext` など) に対するドラッグ＆ドロップ動作を定義します。
  - `callback`: `async (file: File) => void`
- **`hostAPI.io.registerExporter(name, callback)`**:
  エクスポートメニューに項目を追加します。
  - `callback`: `async () => void`
- **`hostAPI.io.renderMasterAudio()`**:
  マスター出力をレンダリングして `AudioBuffer` を返します。
  - カスタムエクスポート形式のプラグイン（MP3エンコーダなど）を実装する際に使用します。
  - `const buffer = await this.app.hostAPI.io.renderMasterAudio();`

### プロジェクト情報 (`hostAPI.project`)

- **`hostAPI.project.getProjectName()`**: 現在のプロジェクト名を取得します。
- `hostAPI.project.getProjectName()`: プロジェクト名を取得します。
- `hostAPI.project.getTracks()`: すべてのトラックの情報を取得します（非同期）。
- `hostAPI.project.createTrack(name?)`: 新しいトラックを作成します（非同期）。
  - 使用例: `const newTrack = await hostAPI.project.createTrack("My New Track");`
- `hostAPI.project.updateTrack(trackId, updates)`: トラックの情報（名前、色など）を更新します（非同期）。
- `hostAPI.project.getSelectedRegion()`: 現在エディタで選択されているリージョンオブジェクトを返します。
- `hostAPI.project.getRegions(trackId)`: 指定したトラックに含まれる全ての MIDI リージョンの配列を返します。
- `hostAPI.project.addNotes(trackId, notes)`: 指定したトラックにノートを一括追加します。
  - **重要**: ノートの範囲をカバーする `MIDIRegion` を**自動的に新規作成**して追加します。
  - **重要 (引数)**: 各ノートオブジェクトには **`start` (ms単位の開始位置)**、`pitch`、`duration` が必須です。`start` を忘れると配置に失敗します。
- `hostAPI.project.addNotesToRegion(region, notes)`: **既存のリージョン内**にノートを追記します。
  - ノートがリージョンの末尾を超える場合、リージョンの長さは自動的に拡張されます。
  - 使用例: `const reg = this.app.hostAPI.project.getSelectedRegion(); if (reg) { this.app.hostAPI.project.addNotesToRegion(reg, [...]); }`
- `hostAPI.project.getSelectedNotes()`: ピアノロールで選択されているノートを `{ note: MIDINote, region: MIDIRegion, globalStart: number }[]` の形式で取得します。
- `hostAPI.project.updateNotes(updates)`: ノートの情報を更新します。`{ region, note, pitch?, start?, duration?, velocity? }[]` を受け取ります。
  - **重要**: ノートはイミュータブルなため、内部的に削除と再生成が行われ、UI も即座に更新されます。
  - 使用例: `const notes = this.app.hostAPI.project.getSelectedNotes(); this.app.hostAPI.project.updateNotes(notes.map(n => ({ ...n, velocity: 127 })));`

---

### MIDI & リージョンの生成・操作 (`MIDI` & `MIDINote`)

ノートやリージョンの操作時に以下の仕様を厳守してください。

1. **MIDINote クラス**:
    - プロパティ: `note` (pitch), `velocity` (0-1), `channel`, `duration` (ms)
    - **注意**: `clone()` メソッドはありません。新しいノートを作るには `new MIDINote(note, velocity, channel, duration)` を使用してください。
    - **イミュータブル**: `MIDINote` のプロパティの多くは `readonly` です。値を変更する場合は、常に新しいインスタンスを生成してください。

2. **MIDI クラス**:
    - プロパティ: `duration` (全体の長さms), `instant_duration` (解像度), `notes` (全ノートの配列)
    - 生成: `MIDI.fromNotes(notesArray, instantDuration, totalDuration)` を使用。
    - **注意**: 長さを示すプロパティ名は **`duration`** です。

3. **リージョンへの反映**:
    - `MIDIRegion` インスタンスの `midi` プロパティに作成した `MIDI` オブジェクトを代入することで反映されます。

### コーディング規約 (厳守)

- **NULL 安全**: TypeScript の厳格なモードが有効です。`getElementById` や `querySelector`、`element.closest` で取得した DOM 要素をプロパティや引数として使用する際は、必ず `if (element)` によるチェックを行うか、非 null アサーション (`!`) を適切に使用してください。
- **型アサーション**: `e.target` などから要素を扱う際は `(e.target as HTMLInputElement)` のように明示的にキャストしてください。

---

### コアコンポーネントへのアクセス (`this.app`)

`this.app` を通じて DAW の内部コントローラーに直接アクセスすることも可能です（上級者向け）。

- **`app.tracksController`**: トラック管理
- **`app.regionsController`**: リージョン管理
- **`app.host`**: 再生・トランスポート管理 (`play()`, `pause()`, `transportPosition`)

---

## 直接操作 (直接実行モード) のガイドライン

AI アシスタントがプロンプトに応じて `typescript-exec` コードブロックを生成し、楽曲を直接操作する場合、以下のルールを遵守してください。

1. **非同期処理の await 徹底**:
    - `hostAPI.project.getTracks()`
    - `hostAPI.project.createTrack()`
    - `hostAPI.project.updateTrack()`
    - `hostAPI.project.updateNotes()`
    - これらを含む、Promise を返す全てのメソッド呼び出しには必ず **`await`** を付けてください。`await` を忘れると、データが空（空配列など）として扱われ、操作に失敗します。

2. **安全な配列アクセス**:
    - 「3番目のトラック」のようにインデックスで指定された場合、アクセス前に必ず `length` が足りているか確認してください。
    - 例: `if (tracks.length >= 3) { ... } else { hostAPI.ui.showToast("トラックが見つかりません", true); }`

3. **ユーザーへのフィードバック**:
    - 操作の成功や失敗をユーザーに知らせるため、必ず `hostAPI.ui.showToast(message, isError?)` を使用してください。
    - 成功時だけでなく、条件（トラックが見つからない等）に合致しなかった場合も通知を出してください。

4. **変数名の明快さ**:
    - 実行内容がデベロッパーコンソールに出力されるため、可読性の高いコードを記述してください。

### 直接操作の成功例 (Snippet)

```typescript
// 3番目のトラックの名前を変更する場合
const tracks = await hostAPI.project.getTracks(); // await が必須
if (tracks.length >= 3) {
    const target = tracks[2];
    await hostAPI.project.updateTrack(target.id, { name: "New Name" });
    hostAPI.ui.showToast(`トラック「${target.name}」の名前を変更しました。`);
} else {
    hostAPI.ui.showToast("3番目のトラックが見つかりませんでした。", true);
}

// 新規トラックを作成してメロディ（ド・レ・ミ）を追加する場合
const newTrack = await hostAPI.project.createTrack("Melody Track"); // 新規作成
const notes = [
    { pitch: 60, start: 0, duration: 500 },   // ド (startが必須)
    { pitch: 62, start: 500, duration: 500 }, // レ
    { pitch: 64, start: 1000, duration: 500 } // ミ
];
await hostAPI.project.addNotes(newTrack.id, notes);
hostAPI.ui.showToast("新規トラックにメロディを作成しました。");
```

---

### 注意事項

- UI は必ず引数で渡された `container` 内に構築してください。グローバルな `document.body` などに直接 append しないでください。

## データ管理機能

プラグインは2種類のデータを管理できます。それぞれの用途に合わせてメソッドを実装してください。

### 1. ユーザーデータ (User Data) - グローバル設定

- **用途**: プラグイン全体の設定、APIキー、UIの好みなど。
- **寿命**: プロジェクトが変わっても保持されます (`localStorage` に保存)。ユーザーがプラグインを**アンインストールすると削除**されます。
- **実装**: `getUserData` / `setUserData`

```typescript
// ユーザーデータの取得（保存時に呼ばれる）
getUserData(): any {
    return {
        theme: this.theme,
        apiKey: this.apiKey
    };
}

// ユーザーデータの復元（プラグインロード時に呼ばれる）
setUserData(data: any): void {
    if (data) {
        this.theme = data.theme;
        this.apiKey = data.apiKey;
    }
}
```

### 2. プロジェクトデータ (Project Data) - プロジェクト固有

- **用途**: その楽曲（プロジェクト）固有の状態、シーケンスデータ、パラメータなど。

- **寿命**: `.dawiy` プロジェクトファイルと一緒に保存・ロードされます。
- **実装**: `getProjectData` / `setProjectData`

```typescript
// プロジェクトデータの取得（プロジェクト保存時に呼ばれる）
getProjectData(): any {
    return {
        sequence: this.sequenceData,
        parameters: this.currentParams
    };
}

// プロジェクトデータの復元（プロジェクトロード時に呼ばれる）
setProjectData(data: any): void {
    if (data) {
        this.sequenceData = data.sequence || [];
        this.currentParams = data.parameters || {};
        this.refreshUI(); // データを反映して再描画
    }
}
```

### 自己メンテナンスプロトコル

**重要:** `AGENTS.md` は **生きたドキュメント** です。

- **更新時期:**
  1. **アーキテクチャの変更:** 単なるDAWIYプラグインの開発に留まらない、DAWIYプラグインを開発する際に参照すべき、システム構造を変更する主要な機能を実装した場合。
  2. **エラーリカバリ:** ここで古い手順に従ったためにバグが発生した場合は、コードを修正した後、**ドキュメントを修正** してください。
  3. **発見:** ドキュメントには記載されていないが重要な、隠れた規約や「落とし穴」を見つけた場合は、すぐにここに記録してください。
- **目標:** これらのファイルをプロジェクトの長期記憶として扱ってください。システムの内部動作に関するドキュメントの改善は、ユーザーの許可を待たずに行ってください。
