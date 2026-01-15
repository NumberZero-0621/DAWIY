# スタートガイド（Docker）

## Dockerで実行

1. まだインストールしてない場合はマシンにDockerをインストール
2. リポジトリをローカルに複製
3. ルートディレクトリに移動
4. `docker-compose up`を実行してDockerで起動
5. Dockerは[`docker-compose.yml`](docker-compose.yml)を読み取ってコンテナを構築＆実行する
6. [`docker-compose.yml`](docker-compose.yml)内で次の変数を設定
   - `HTTPS`･･･ HTTPSを有効にする場合はこれを`true`に設定
     - `true`の場合は証明書を作成し変数`SSL_CRT_FILE`と`SSL_KEY_FILE`を設定する必要あり
   - `BACKEND_URL`･･･ バックエンドのURL（例：`http://localhost:6002`）
   - `BANK_PLUGIN_URL`･･･ バンクプラグインのURL（例：`http://localhost:7002`）
   - `STORAGE_DIR`･･･ バックエンドがデータを保存するディレクトリ（ボリューム内）（例：`/data/storage`）
   - `ADMIN_PASSWORD`･･･ 管理者のパスワード
   - `JWT_SECRET`･･･ JSON Web Token (JWT) のシークレット

（※サーバーとプラグインバンクは他の場所でホストできる その場合`public`フォルダの[`.env`](/public/.env)か[`docker-compose.yml`](docker-compose.yml)でURLの提供が必要）

以上でアプリケーションが実行されるはず  
ブラウザで [http://localhost:5002](http://localhost:5002) にてフロントエンドにアクセスできる  
(自分で[`docker-compose.yml`](docker-compose.yml)の`ports`を変更した場合は、`http://localhost:[任意のPORT]`になるので注意)
