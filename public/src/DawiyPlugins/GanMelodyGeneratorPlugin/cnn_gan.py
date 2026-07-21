import torch
import torch.nn as nn

LATENT_DIM = 100
TIME_STEPS = 64
PITCH_RANGE = 128

class Generator(nn.Module):
    def __init__(self):
        super(Generator, self).__init__()
        
        # ノイズベクトル(100次元)を、(256チャンネル, 4, 8)の小さな画像に変換する
        self.init_size_h = TIME_STEPS // 16  # 4
        self.init_size_w = PITCH_RANGE // 16 # 8
        self.l1 = nn.Sequential(nn.Linear(LATENT_DIM, 256 * self.init_size_h * self.init_size_w))

        # 逆畳み込み(ConvTranspose2d)で画像を少しずつ拡大していく
        self.conv_blocks = nn.Sequential(
            nn.BatchNorm2d(256),
            
            # (256, 4, 8) -> (128, 8, 16)
            nn.ConvTranspose2d(256, 128, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (128, 8, 16) -> (64, 16, 32)
            nn.ConvTranspose2d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (64, 16, 32) -> (32, 32, 64)
            nn.ConvTranspose2d(64, 32, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (32, 32, 64) -> (1, 64, 128)
            nn.ConvTranspose2d(32, 1, kernel_size=4, stride=2, padding=1),
            nn.Sigmoid()
        )

    def forward(self, z):
        out = self.l1(z)
        out = out.view(out.shape[0], 256, self.init_size_h, self.init_size_w)
        img = self.conv_blocks(out)
        return img

class Discriminator(nn.Module):
    def __init__(self):
        super(Discriminator, self).__init__()

        # 画像を畳み込み(Conv2d)で少しずつ縮小しながら特徴を抽出する
        self.model = nn.Sequential(
            # (1, 64, 128) -> (16, 32, 64)
            nn.Conv2d(1, 16, kernel_size=4, stride=2, padding=1),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (16, 32, 64) -> (32, 16, 32)
            nn.Conv2d(16, 32, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (32, 16, 32) -> (64, 8, 16)
            nn.Conv2d(32, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.LeakyReLU(0.2, inplace=True),
            
            # (64, 8, 16) -> (128, 4, 8)
            nn.Conv2d(64, 128, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.LeakyReLU(0.2, inplace=True),
        )

        # 縮小された画像(128チャンネル, 4, 8)を平坦化して1つの確率(本物か偽物か)にする
        ds_size_h = TIME_STEPS // 16
        ds_size_w = PITCH_RANGE // 16
        self.adv_layer = nn.Sequential(
            nn.Linear(128 * ds_size_h * ds_size_w, 1),
            nn.Sigmoid()
        )

    def forward(self, img):
        out = self.model(img)
        out = out.view(out.shape[0], -1)
        validity = self.adv_layer(out)
        return validity
