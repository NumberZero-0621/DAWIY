# `.env`ファイルについて

## [public](/public/.env)

- `PORT`･･･ フロントエンドが実行されるポート番号（例：`5002`）
- `HTTPS`･･･ HTTPSを有効にする場合はこれを`true`に設定
  - `true`の場合は証明書を作成し変数`SSL_CRT_FILE`と`SSL_KEY_FILE`を設定する必要あり
- `BACKEND_URL`･･･ バックエンドのURL（例：`http://localhost:6002`）
- `BANK_PLUGIN_URL`･･･ バンクプラグインのURL（例：`http://localhost:6002`）
- （オプション）`BROWSER`･･･ 起動時、自動的に開くブラウザ（例：`Google Chrome` or `firefox`）
  - MacOSにて、デフォルトに設定しているブラウザで開かない問題が発生したため、念の為実装 書かなければ基本的にデフォルトのブラウザが使用される
- 記述例（元々あった[`.env.example`](/public/.env.example)参考 とりあえずこれで動くはず）：

     ```env
     PORT=5002
     HTTPS=false
     BACKEND_URL=http://localhost:6002
     BANK_PLUGIN_URL=http://localhost:6002
     SONGS_FILE_URL=http://localhost:6002
     HTTPS_DEV=false
     ```

## [bank](/bank/.env)

- `PORT`･･･ バックエンドが実行されるポート番号（例：`6002`）
- `STORAGE_DIR`･･･ バックエンドがデータを保存するディレクトリ（例：`storage`）
- `ADMIN_PASSWORD`･･･ 管理者のパスワード
- `JWT_SECRET`･･･ JSON Web Token (JWT) のシークレット
- `NODE_ENV`･･･ バックエンドが実行されている環境（例：`development`）
- `ENABLE_HEARTBEAT_SHUTDOWN`･･･ ブラウザでDAWのページを開いていない状態で30秒以上経過した時に、自動的にターミナルを終了するかどうか（例：`false`）
- 記述例（元々あった[`.env.example`](/bank/.env.example)参考 とりあえずこれで動くはず）：

    ```env
    PORT=6002
    STORAGE_DIR=storage
    ADMIN_PASSWORD=123456
    JWT_SECRET=123456
    NODE_ENV=development
    HTTPS=false
    BANKURL=http://localhost:6002
    ENABLE_HEARTBEAT_SHUTDOWN=false
    ```
