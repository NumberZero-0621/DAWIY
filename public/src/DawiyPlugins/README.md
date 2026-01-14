# DAWIYプラグイン開発ガイド

このディレクトリ (`public/src/DawiyPlugins`) は、DAWIY のカスタム拡張機能とプラグインのホームディレクトリです。  
プラグインを使用すると、DAW の機能を拡張したり、新しいUIツールやジェネレーターを追加したり、アプリケーションの状態を変更したりできます。

## はじめに

1. **プラグインファイルを作成する:**
    このディレクトリまたはサブディレクトリ内に新しい `.ts` ファイルを作成してください。  
    `PluginTemplate.ts` をコピーして開始することをお勧めします。  
    *例:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2. **インターフェースを実装する:**
    クラスは `IDawiyPlugin` インターフェースを実装し、**デフォルトエクスポート (default export)** である必要があります。

    ```typescript
    import App from "../../App"; // サブディレクトリにいる場合はパスを調整してください
    import { IDawiyPlugin } from "../IDawiyPlugin"; // サブディレクトリにいる場合はパスを調整してください

    export default class MyCoolPlugin implements IDawiyPlugin {
        id = "my-cool-plugin"; // すべてのプラグインで一意である必要があります
        name = "My Cool Plugin"; // UIに表示される名前
        description = "何かクールなことをします。"; // プラグインの説明

        private app: App;
        private container: HTMLElement | null = null;

        constructor(app: App) {
            this.app = app;
        }

        /**
         * プラグインのUIを構築します。
         * @param container UIを構築する対象のHTML要素
         */
        public render(container: HTMLElement) {
            this.container = container;
            
            // コンテナをクリア
            container.innerHTML = '';
            
            // 基本的なスタイルを適用
            this.applyContainerStyles(container);

            // 標準の DOM API を使用して UI を構築
            const title = document.createElement("h3");
            title.textContent = this.name;
            container.appendChild(title);

            const button = document.createElement("button");
            button.textContent = "Click Me";
            // ボタンクリック時の動作
            button.onclick = () => this.doSomething();
            btn.onclick = () => alert("Hello from MyCoolPlugin!");
            container.appendChild(button);
        }

        /**
         * オプション: プラグインがアクティブ化（表示）された時に呼ばれます。
         */
        public onActivate() {
            console.log(`${this.name} activated`);
        }

        /**
         * オプション: プラグインが非アクティブ化（非表示/閉じる）された時に呼ばれます。
         * イベントリスナーの削除など、クリーンアップ処理に使用します。
         */
        public onDeactivate() {
            console.log(`${this.name} deactivated`);
        }

        /**
         * 独自のロジックを実装するメソッド例
         */
        private doSomething() {
            console.log("Button clicked!");
            
            // アプリケーションの状態にアクセスする例
            const track = this.app.tracksController.selectedTrack;
            if (track) {
                // track.element.name でトラック名を取得できます
                alert(`Selected track: ${track.element.name}`);
            } else {
                alert("No track selected.");
            }
        }

        /**
         * コンテナのスタイルを整えるヘルパーメソッド
         */
        private applyContainerStyles(container: HTMLElement) {
            container.style.color = "#eee";
            container.style.padding = "10px";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "10px";
            container.style.overflowY = "auto";
            container.style.height = "100%";
        }
    }
    ```

3. **完了:**
    **手動での登録は不要です。**  
    システムは `public/src/DawiyPlugins` およびそのサブディレクトリ内にあるすべての `.ts` ファイルを自動的に検出して読み込みます。

    ※ `PluginTemplate.ts` や `IDawiyPlugin.ts` は自動的に除外されます。

4. **ビルド/実行:**
    開発サーバー (`npm start`) を再起動するか（新しいファイルが認識されない場合）、ページをリロードして変更を確認します。

## LLM (AIアシスタント) / サードパーティ開発者向け

AIアシスタントや開発者がプラグインを作成する場合、互換性を保つために以下のルールに従ってください：

1. **ファイルの場所:** プラグインファイルは `public/src/DawiyPlugins/<プラグイン名>/<メインファイル>.ts` に配置してください。
2. **デフォルトエクスポート:** プラグインクラスは必ず **デフォルトエクスポート** (`export default class ...`) してください。
3. **インターフェース:** クラスは必ず `IDawiyPlugin` を実装してください。
4. **コンストラクタ:** コンストラクタは必ず `app: App` を第一引数として受け取ってください。
5. **コンテキスト:** `App` インスタンスを通じて DAW の状態を操作できます。
    - `app.tracksController`: トラックへのアクセス。
    - `app.host`: トランスポート（再生/停止）へのアクセス。
6. **手動登録不要:** `DawiyPluginController.ts` を編集する必要はありません。ファイルを作成するだけで認識されます。

## API とヒント

- `App` インスタンスにアクセスして、以下の操作を行えます。
  - `app.tracksController`: トラックや選択範囲などの管理
  - `app.regionsController`: リージョン（ノート/オーディオ）の追加/削除
  - `app.host`: トランスポート制御（再生/一時停止、再生ヘッドの位置）
- 状態の変更（ノートやリージョンの追加など）は、`app.doIt(undoable, redo, undo)` を使用して、Undo/Redo 機能をサポートするようにしてください。
- UI は、`render()` に渡される `container` 内に収めてください。

[トップのREADMEに戻る](../../../README.md)
