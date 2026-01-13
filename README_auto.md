# Automation Scripts Guide / 自動化スクリプトガイド

This project includes automation scripts to simplify setup and execution on both Mac/Linux and Windows.
本プロジェクトには、Mac/LinuxおよびWindowsでのセットアップと実行を簡略化する自動化スクリプトが含まれています。

## Mac / Linux

### 1. Setup / セットアップ
Installs dependencies for both `public` and `bank` apps.
`public`と`bank`アプリの依存関係をインストールします。

```bash
./setup.sh
```
*Note: You may be prompted for your password as it uses `sudo`.*
*注意: `sudo`を使用しているため、パスワードの入力を求められる場合があります。*

### 2. Run / 実行
Starts both applications in separate Terminal windows.
両方のアプリケーションを別々のターミナルウィンドウで起動します。

```bash
./run_dev.sh
```

---

## Windows

### 1. Setup / セットアップ
Installs dependencies for both `public` and `bank` apps.
`public`と`bank`アプリの依存関係をインストールします。

Double-click `setup.bat` or run in Command Prompt:
`setup.bat`をダブルクリックするか、コマンドプロンプトで実行してください:

```cmd
setup.bat
```

### 2. Run / 実行
Starts both applications in separate Command Prompt windows.
両方のアプリケーションを別々のコマンドプロンプトウィンドウで起動します。

Double-click `run_dev.bat` or run in Command Prompt:
`run_dev.bat`をダブルクリックするか、コマンドプロンプトで実行してください:

```cmd
run_dev.bat
```
