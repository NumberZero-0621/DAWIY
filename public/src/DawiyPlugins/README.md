# DAWIYプラグイン開発ガイド

このディレクトリ (`public/src/DawiyPlugins`) は、DAWIY のカスタム拡張機能とプラグインのホームディレクトリです。  
プラグインを使用すると、DAW の機能を拡張したり、新しいUIツールやジェネレーターを追加したり、アプリケーションの状態を変更したりできます。

## はじめに

1. **プラグインファイルを作成する:**
`PluginTemplate.ts` を新しいファイル (例: `MyCoolPlugin.ts`) にコピーします。

2. **インターフェースを実装する:**
    クラスは `IDawiyPlugin` インターフェースを実装する必要があります。  
    以下は `PluginTemplate.ts` に基づいた、より包括的な実装例です。

    ```typescript
    import App from "../App";
    import { IDawiyPlugin } from "./IDawiyPlugin";

    export default class MyCoolPlugin implements IDawiyPlugin {
        // プラグインの一意なID（小文字とハイフン推奨）
        id = "my-cool-plugin";
        
        // UIに表示される名前
        name = "My Cool Plugin";
        
        // プラグインの説明
        description = "何かクールなことをします。";

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
    ファイルを保存すると、自動的にDAWIYに読み込まれます。
    （`DawiyPluginController` がこのフォルダ内の `.ts` ファイルを自動的にスキャンします）

    ※ `PluginTemplate.ts` や `IDawiyPlugin.ts` は自動的に除外されます。

4. **ビルド/実行:**
    開発サーバーを再起動し (`public` フォルダー内の `npm start` を実行)、変更内容を確認します。
    （既に起動している場合は、自動的にリロードされるはずです）

## ファイル構造

- `IDawiyPlugin.ts`: すべてのプラグインが準拠する必要があるインターフェースを定義します。
- `PluginTemplate.ts`: 開始を支援するコメント付きテンプレートです。
- `StochasticGeneratorPlugin.ts`: ランダムなメロディーを生成するサンプルプラグインです。

## API とヒント

- `App` インスタンスにアクセスして、以下の操作を行えます。
  - `app.tracksController`: トラックや選択範囲などの管理
  - `app.regionsController`: リージョン（ノート/オーディオ）の追加/削除
  - `app.host`: トランスポート制御（再生/一時停止、再生ヘッドの位置）
- 状態の変更（ノートやリージョンの追加など）は、`app.doIt(undoable, redo, undo)` を使用して、Undo/Redo 機能をサポートするようにしてください。
- UI は、`render()` に渡される `container` 内に収めてください。

[トップREADMEに戻る](../../../README.md)
