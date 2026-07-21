import os
import glob
import torch
import numpy as np
import pretty_midi
from torch.utils.data import Dataset, DataLoader
import torch.nn as nn

# cnn_gan.py からモデルをインポート
from cnn_gan import Generator, Discriminator, LATENT_DIM, TIME_STEPS, PITCH_RANGE

# サンプリング周波数 (1秒間に何回サンプリングするか)
# 例: 4に設定すると1ステップ = 0.25秒(16分音符相当/BPM120換算)
FS = 4

class MaestroPianoRollDataset(Dataset):
    def __init__(self, midi_dir, max_files=100):
        """
        MAESTROデータセットのMIDIファイルを読み込み、64ステップごとのピアノロール行列を抽出するデータセット。
        ※MAESTROは非常に巨大なため、最初は max_files で読み込む数を制限しています。
        """
        super().__init__()
        self.samples = []
        
        # ディレクトリ内のMIDIファイルを検索
        midi_files = glob.glob(os.path.join(midi_dir, "**/*.midi"), recursive=True)
        midi_files.extend(glob.glob(os.path.join(midi_dir, "**/*.mid"), recursive=True))
        
        print(f"見つかったMIDIファイル数: {len(midi_files)}")
        midi_files = midi_files[:max_files]
        print(f"うち、{len(midi_files)}曲を学習データとして読み込みます...")

        for file_path in midi_files:
            try:
                # pretty_midiで読み込み
                pm = pretty_midi.PrettyMIDI(file_path)
                
                # ピアノロールを取得。shapeは (128ピッチ, 時間ステップ)
                # 値はベロシティ(0〜127)なので、0〜1に正規化する
                piano_roll = pm.get_piano_roll(fs=FS)
                piano_roll = piano_roll / 127.0
                
                # GANの入力層はSigmoidなので、音が鳴っている部分を明確にするために
                # ある程度強い音(例:0.1以上)を1にする(二値化)と学習が安定しやすいです。
                piano_roll = np.where(piano_roll > 0.1, 1.0, 0.0)

                # 時間軸(横)が長すぎるので、TIME_STEPS(64) ごとに切り出して1つのサンプルとする
                total_steps = piano_roll.shape[1]
                for start in range(0, total_steps - TIME_STEPS, TIME_STEPS):
                    chunk = piano_roll[:, start : start + TIME_STEPS]
                    # chunk の形は (128, 64) なので、PyTorch用に (1, 64, 128) に変換 (チャンネル, 時間, ピッチ)
                    chunk = chunk.T # (64, 128) に転置
                    chunk_tensor = torch.tensor(chunk, dtype=torch.float32).unsqueeze(0) # (1, 64, 128)
                    self.samples.append(chunk_tensor)
                    
            except Exception as e:
                print(f"読み込みエラー {file_path}: {e}")
                
        print(f"データセットの準備が完了しました！ 総サンプル数(チャンク数): {len(self.samples)}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]

if __name__ == "__main__":
    # MAESTROデータセットのパス (環境に合わせて変更)
    maestro_path = r"C:\Documents\UnivFukuchiyama\maestro-v3.0.0-midi\maestro-v3.0.0\2004"
    
    # データセットとデータローダーの作成
    dataset = MaestroPianoRollDataset(maestro_path, max_files=100)
    
    if len(dataset) == 0:
        print("有効な学習データが見つかりませんでした。パスを確認してください。")
        exit()

    dataloader = DataLoader(dataset, batch_size=32, shuffle=True, drop_last=True)

    # デバイスの準備 (GPUがあればGPUを使う)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"学習に使用するデバイス: {device}")

    # モデルの準備
    generator = Generator().to(device)
    discriminator = Discriminator().to(device)
    
    adversarial_loss = nn.BCELoss()
    optimizer_G = torch.optim.Adam(generator.parameters(), lr=0.0002)
    optimizer_D = torch.optim.Adam(discriminator.parameters(), lr=0.0005)

    epochs = 100
    print("学習を開始します...")
    for epoch in range(epochs):
        for i, real_imgs in enumerate(dataloader):
            real_imgs = real_imgs.to(device)
            batch_size = real_imgs.size(0)

            # 正解ラベル(1) と 偽物ラベル(0) を用意
            valid = torch.ones(batch_size, 1).to(device) * 0.9
            fake = torch.zeros(batch_size, 1).to(device)

            # -----------------
            #  Generatorの学習
            # -----------------
            optimizer_G.zero_grad()
            # ランダムなノイズ z を生成
            z = torch.randn(batch_size, LATENT_DIM).to(device)
            # ノイズから偽のピアノロールを生成
            gen_imgs = generator(z)
            
            # Discriminatorがこれを「本物(valid)」と騙されれば Loss が小さくなる
            g_loss = adversarial_loss(discriminator(gen_imgs), valid)
            g_loss.backward()
            optimizer_G.step()

            # ---------------------
            #  Discriminatorの学習
            # ---------------------
            optimizer_D.zero_grad()
            # 本物の画像を入れたときは「本物(valid)」と判定させたい
            real_loss = adversarial_loss(discriminator(real_imgs), valid)
            # 偽物の画像を入れたときは「偽物(fake)」と判定させたい
            fake_loss = adversarial_loss(discriminator(gen_imgs.detach()), fake)
            
            d_loss = (real_loss + fake_loss) / 2
            d_loss.backward()
            optimizer_D.step()

        if epoch % 10 == 0:
            print(f"[Epoch {epoch}/{epochs}] [D loss: {d_loss.item():.4f}] [G loss: {g_loss.item():.4f}]")

    # 学習完了後、モデルの重みを保存する
    torch.save(generator.state_dict(), "generator.pth")
    print("学習が完了し、 generator.pth を保存しました！")
