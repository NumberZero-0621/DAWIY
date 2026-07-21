import torch
import torch.nn as nn

# ==========================================
# 1. モデルの定義 (Generator & Discriminator)
# ==========================================

# 潜在変数の次元数 (DAWIYプラグインのパラメータ latent_vector_size に相当)
LATENT_DIM = 100
# 時間ステップ数 (例: 4小節 = 16拍 = 16分音符単位で 64ステップ)
TIME_STEPS = 64
# ピッチの幅 (例: 128の全MIDIノート)
PITCH_RANGE = 128

class Generator(nn.Module):
    def __init__(self):
        super(Generator, self).__init__()
        # シンプルな全結合層(Linear)を使った例。
        # 本格的にやる場合は Conv2d や ConvTranspose2d などを活用します。
        self.model = nn.Sequential(
            nn.Linear(LATENT_DIM, 256),
            nn.LeakyReLU(0.2, inplace=True),
            nn.BatchNorm1d(256),
            
            nn.Linear(256, 512),
            nn.LeakyReLU(0.2, inplace=True),
            nn.BatchNorm1d(512),
            
            # 出力層: 64ステップ × 128ピッチ の行列サイズに合わせる
            nn.Linear(512, TIME_STEPS * PITCH_RANGE),
            nn.Sigmoid() # 0〜1の確率として出力（しきい値を超えたらノートONとみなす）
        )

    def forward(self, z):
        img = self.model(z)
        img = img.view(img.size(0), 1, TIME_STEPS, PITCH_RANGE)
        return img

class Discriminator(nn.Module):
    def __init__(self):
        super(Discriminator, self).__init__()
        self.model = nn.Sequential(
            nn.Linear(TIME_STEPS * PITCH_RANGE, 512),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Linear(512, 256),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Linear(256, 1),
            nn.Sigmoid() # 本物か偽物かの確率
        )

    def forward(self, img):
        img_flat = img.view(img.size(0), -1)
        validity = self.model(img_flat)
        return validity

# ==========================================
# 2. 学習ループの骨組み
# ==========================================
if __name__ == "__main__":
    generator = Generator()
    discriminator = Discriminator()
    
    # 損失関数と最適化手法
    adversarial_loss = nn.BCELoss()
    optimizer_G = torch.optim.Adam(generator.parameters(), lr=0.0002)
    optimizer_D = torch.optim.Adam(discriminator.parameters(), lr=0.0002)

    # 仮想の学習ループ
    epochs = 1000
    for epoch in range(epochs):
        # ---------------------
        #  ここに以下の処理を書きます:
        #  1. 実際のMIDIファイルからピアノロール行列を生成し (real_imgs) として用意する
        #  2. Generatorにノイズ(z)を与えてメロディ(gen_imgs)を生成させる
        #  3. Discriminatorに real と gen を見破らせて学習(Loss計算)させる
        # ---------------------
        pass
        
        if epoch % 100 == 0:
            print(f"Epoch {epoch} / {epochs} 完了")

    # 学習完了後、モデルの重みを保存する
    torch.save(generator.state_dict(), "generator.pth")
    print("モデルを保存しました！")
