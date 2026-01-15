# DAWIYプラグイン開発ガイド

このディレクトリ (`public/src/DawiyPlugins`) は、DAWIY のカスタム拡張機能とプラグインのホームディレクトリです。  
プラグインを使用すると、DAW の機能を拡張したり、新しいUIツールやジェネレーターを追加したり、アプリケーションの状態を変更したりできます。

## 開発者・AIエージェント向け情報

### AIエージェント、および詳細な技術仕様を確認したい開発者の方へ

詳細なAPI仕様、実装ルール、テンプレートコードについては、同ディレクトリ内の [`AGENTS.md`](./AGENTS.md) を参照してください。

## はじめに (クイックスタート)

1. **プラグインファイルを作成する:**
    このディレクトリまたはサブディレクトリ内に新しい `.ts` ファイルを作成してください。  
    `PluginTemplate.ts` をコピーして開始することをお勧めします。  
    *例:* `public/src/DawiyPlugins/MyAwesomePlugin/MyPlugin.ts`

2. **インターフェースを実装する:**
    クラスは `IDawiyPlugin` インターフェースを実装し、**デフォルトエクスポート (default export)** である必要があります。

    ```typescript
    // 基本的な例
    import App from "../../App"; 
    import { IDawiyPlugin } from "../IDawiyPlugin";

    export default class MyPlugin implements IDawiyPlugin {
        id = "my-plugin";
        name = "My Plugin";
        description = "Sample Plugin";
        // ... (詳細は AGENTS.md または PluginTemplate.ts を参照)
    }
    ```

3. **完了:**
    **手動での登録は不要です。**  
    システムは `public/src/DawiyPlugins` およびそのサブディレクトリ内にあるすべての `.ts` ファイルを自動的に検出して読み込みます。

    ※ `PluginTemplate.ts` や `IDawiyPlugin.ts` は自動的に除外されます。

4. **ビルド/実行:**
    開発サーバー (`npm start`) を再起動するか（新しいファイルが認識されない場合）、ページをリロードして変更を確認します。

[トップのREADMEに戻る](../../../README.md)
