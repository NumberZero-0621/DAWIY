# スタートガイド（手動）

## ローカルで実行

0. DAWIYでは、2つ（フロントエンド\バックエンド）のターミナルを同時に走らせてウェブアプリを動作させる方式を取っています  
まず、VScode等で、ターミナルを2つ立ち上げます  
以下に各ターミナルで実行する内容を記述します  
※ DAWIYを動かしている間、ターミナルは**どちらも閉じないで**下さい！

### フロントエンド(`public`)

1. `cd public`を実行して`public`フォルダに移動
2. `npm install`を実行して依存関係をインストール
3. `public`フォルダ直下に`.env`ファイルを作成
4. `.env`内で以下の変数を設定
   - `PORT`･･･ フロントエンドが実行されるポート番号（例：`5002`）
   - `HTTPS`･･･ HTTPSを有効にする場合はこれを`true`に設定
     - `true`の場合は証明書を作成し変数`SSL_CRT_FILE`と`SSL_KEY_FILE`を設定する必要あり
   - `BACKEND_URL`･･･ バックエンドのURL（例：`http://localhost:6002`）
   - `BANK_PLUGIN_URL`･･･ バンクプラグインのURL（例：`http://localhost:6002`）
   - 記述例（元々あった`.env.example`参考 とりあえずこれで動くはず）：

        ```env
        PORT=5002
        HTTPS=false
        BACKEND_URL=http://localhost:6002
        BANK_PLUGIN_URL=http://localhost:6002
        SONGS_FILE_URL=http://localhost:6002
        HTTPS_DEV=false
        ```

   - 現時点では操作の簡略化のため予め`.env`ファイルを用意しています
     - 変数を変更する必要がありましたら適宜書き換えて下さい

5. `npm start`を実行してフロントエンドを起動

### バックエンド(`bank`)

1. `cd bank`を実行して`bank`フォルダに移動
2. `npm install`を実行して依存関係をインストール
3. `bank`フォルダ直下に`.env`ファイルを作成
4. `.env`内で以下の変数を設定
   - `PORT`･･･ バックエンドが実行されるポート番号（例：`6002`）
   - `STORAGE_DIR`･･･ バックエンドがデータを保存するディレクトリ（例：`storage`）
   - `ADMIN_PASSWORD`･･･ 管理者のパスワード
   - `JWT_SECRET`･･･ JSON Web Token (JWT) のシークレット
   - `NODE_ENV`･･･ バックエンドが実行されている環境（例：`development`）
   - 記述例（元々あった`.env.example`参考 とりあえずこれで動くはず）：

        ```env
        PORT=6002
        STORAGE_DIR=storage
        ADMIN_PASSWORD=123456
        JWT_SECRET=123456
        NODE_ENV=development
        HTTPS=false
        BANKURL=http://localhost:6002
        ```

   - 現時点では操作の簡略化のため予め`.env`ファイルを用意しています
     - 変数を変更する必要がありましたら適宜書き換えて下さい
5. `npm start`を実行してバックエンドを起動

以上でアプリケーションが実行されるはず  
ブラウザで`http://localhost:5002`にてフロントエンドにアクセスできる
