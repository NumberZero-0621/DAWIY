# DAWIY プラグイン開発ガイド

このディレクトリ (`public/src/DawiyPlugins`) は、DAWIY のカスタム拡張機能とプラグインのホームディレクトリです。
プラグインを使用すると、DAW の機能を拡張したり、新しいUIツールやジェネレーターを追加したり、アプリケーションの状態を変更したりできます。

## はじめに

1.  **プラグインファイルを作成する:**
    このディレクトリまたはサブディレクトリ内に新しい `.ts` ファイルを作成してください。
    `PluginTemplate.ts` をコピーして開始することをお勧めします。
    *例:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2.  **インターフェースを実装する:**
    クラスは `IDawiyPlugin` インターフェースを実装し、**デフォルトエクスポート (default export)** である必要があります。

    ```typescript
    import { IDawiyPlugin } from "../IDawiyPlugin"; // サブディレクトリにいる場合はパスを調整してください
    import App from "../../App"; // サブディレクトリにいる場合はパスを調整してください

    export default class MyCoolPlugin implements IDawiyPlugin {
        id = "my-cool-plugin"; // すべてのプラグインで一意である必要があります
        name = "My Cool Plugin";
        description = "何かクールなことをします。";

        private app: App;

        constructor(app: App) {
            this.app = app;
        }

        render(container: HTMLElement) {
            // 標準の DOM API を使用してここで UI を構築します
            const btn = document.createElement("button");
            btn.textContent = "Click Me";
            btn.onclick = () => alert("Hello from MyCoolPlugin!");
            container.appendChild(btn);
        }
    }
    ```

3.  **自動読み込み:**
    **手動での登録は不要です。**
    システムは `public/src/DawiyPlugins` およびそのサブディレクトリ内にあるすべての `.ts` ファイルを自動的に検出して読み込みます。

    *注意: `IDawiyPlugin.ts` と `PluginTemplate.ts` は自動的に除外されます。*

4.  **ビルド/実行:**
    開発サーバー (`npm start`) を再起動するか（新しいファイルが認識されない場合）、ページをリロードして変更を確認します。

## LLM (AIアシスタント) / サードパーティ開発者向け

AIアシスタントや開発者がプラグインを作成する場合、互換性を保つために以下のルールに従ってください：

1.  **ファイルの場所:** プラグインファイルは `public/src/DawiyPlugins/<プラグイン名>/<メインファイル>.ts` に配置してください。
2.  **デフォルトエクスポート:** プラグインクラスは必ず **デフォルトエクスポート** (`export default class ...`) してください。
3.  **インターフェース:** クラスは必ず `IDawiyPlugin` を実装してください。
4.  **コンストラクタ:** コンストラクタは必ず `app: App` を第一引数として受け取ってください。
5.  **コンテキスト:** `App` インスタンスを通じて DAW の状態を操作できます。
    - `app.tracksController`: トラックへのアクセス。
    - `app.host`: トランスポート（再生/停止）へのアクセス。
6.  **手動登録不要:** `DawiyPluginController.ts` を編集する必要はありません。ファイルを作成するだけで認識されます。

## API とヒント

- `App` インスタンスにアクセスして、以下の操作を行えます。
  - `app.tracksController`: トラックや選択範囲などの管理
  - `app.regionsController`: リージョン（ノート/オーディオ）の追加/削除
  - `app.host`: トランスポート制御（再生/一時停止、再生ヘッドの位置）
- 状態の変更（ノートやリージョンの追加など）は、`app.doIt(undoable, redo, undo)` を使用して、Undo/Redo 機能をサポートするようにしてください。
- UI は、`render()` に渡される `container` 内に収めてください。