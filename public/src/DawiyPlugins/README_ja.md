# DAWIY プラグイン開発ガイド

このディレクトリ (`public/src/DawiyPlugins`) は、DAWIY のカスタム拡張機能とプラグインのホームディレクトリです。
プラグインを使用すると、DAW の機能を拡張したり、新しいUIツールやジェネレーターを追加したり、アプリケーションの状態を変更したりできます。

## はじめに

1. **プラグインファイルを作成する:**
`PluginTemplate.ts` を新しいファイル (例: `MyCoolPlugin.ts`) にコピーします。

2. **インターフェースを実装する:**
クラスは `IDawiyPlugin` インターフェースを実装する必要があります。
```typescript
import { IDawiyPlugin } from "./IDawiyPlugin";
// ... imports

export default class MyCoolPlugin implements IDawiyPlugin {
id = "my-cool-plugin"; // 一意である必要があります
name = "My Cool Plugin";
description = "何かクールなことをします。";

constructor(app: App) {
this.app = app;
}

render(container: HTMLElement) {
// 標準の DOM API を使用してここで UI を構築します
const btn = document.createElement("button");
btn.textContent = "Click Me";
container.appendChild(btn);
}
}
```

3. **プラグインを登録する:**
現在、プラグインはコントローラーに手動で登録する必要があります。
`public/src/Controllers/DawiyPluginController.ts` を開き、以下を実行します。

a. プラグインをインポートします。
```typescript
import MyCoolPlugin from "../DawiyPlugins/MyCoolPlugin";
```

b.コンストラクターの `installedExtensions` 配列にこれを追加します。
```typescript
constructor(app: App) {
this.app = app;
this.installedExtensions = [
new StochasticGeneratorPlugin(app),
new MyCoolPlugin(app) // <-- この行を追加
];
}
```

4. **ビルド/実行:**
開発サーバーを再起動し (`public` フォルダー内の `npm start` を実行)、変更内容を確認します。

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