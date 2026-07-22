import torch
import torch.nn as nn
import torch.autograd as autograd
import numpy as np

LATENT_DIM = 100
TIME_STEPS = 64
PITCH_RANGE = 128
LAMBDA_GP = 10 # Gradient Penalty の係数

# ----------------------------
# 1. WGAN-GP 用のモデル定義
# (Discriminatorの最後のSigmoidを外すのがWGANの最大の特徴です)
# ----------------------------
class Generator(nn.Module):
    def __init__(self):
        super(Generator, self).__init__()
        self.init_size_h = TIME_STEPS // 16
        self.init_size_w = PITCH_RANGE // 16
        self.l1 = nn.Sequential(nn.Linear(LATENT_DIM, 256 * self.init_size_h * self.init_size_w))

        self.conv_blocks = nn.Sequential(
            nn.BatchNorm2d(256),
            nn.ConvTranspose2d(256, 128, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.LeakyReLU(0.2, inplace=True),
            nn.ConvTranspose2d(128, 64, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.LeakyReLU(0.2, inplace=True),
            nn.ConvTranspose2d(64, 32, kernel_size=4, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.LeakyReLU(0.2, inplace=True),
            nn.ConvTranspose2d(32, 1, kernel_size=4, stride=2, padding=1),
            nn.Sigmoid() # 出力は0〜1のまま
        )

    def forward(self, z):
        out = self.l1(z)
        out = out.view(out.shape[0], 256, self.init_size_h, self.init_size_w)
        return self.conv_blocks(out)

class Discriminator(nn.Module):
    def __init__(self):
        super(Discriminator, self).__init__()
        # WGANではDiscriminatorのことを「Critic(評論家)」と呼びます
        # 依然としてDが強すぎるため、Dropoutを追加してDを少し「弱体化（目隠し）」します
        self.model = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=4, stride=2, padding=1),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Dropout2d(0.25),
            
            nn.Conv2d(16, 32, kernel_size=4, stride=2, padding=1),
            nn.InstanceNorm2d(32),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Dropout2d(0.25),
            
            nn.Conv2d(32, 64, kernel_size=4, stride=2, padding=1),
            nn.InstanceNorm2d(64),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Dropout2d(0.25),
            
            nn.Conv2d(64, 128, kernel_size=4, stride=2, padding=1),
            nn.InstanceNorm2d(128),
            nn.LeakyReLU(0.2, inplace=True),
            nn.Dropout2d(0.25),
        )
        ds_size_h = TIME_STEPS // 16
        ds_size_w = PITCH_RANGE // 16
        # WGAN最大の特徴：最後の Sigmoid が無く、実数値をそのまま出力する
        self.adv_layer = nn.Linear(128 * ds_size_h * ds_size_w, 1)

    def forward(self, img):
        out = self.model(img)
        out = out.view(out.shape[0], -1)
        return self.adv_layer(out)

# ----------------------------
# 2. Gradient Penalty の計算関数
# ----------------------------
def compute_gradient_penalty(D, real_samples, fake_samples, device):
    """WGAN-GP の要である Gradient Penalty を計算する"""
    # 本物と偽物の中間となる画像をランダムに合成する
    alpha = torch.rand(real_samples.size(0), 1, 1, 1).to(device)
    interpolates = (alpha * real_samples + ((1 - alpha) * fake_samples)).requires_grad_(True)
    
    d_interpolates = D(interpolates)
    
    fake = torch.ones(real_samples.size(0), 1).to(device)
    # 勾配を取得
    gradients = autograd.grad(
        outputs=d_interpolates,
        inputs=interpolates,
        grad_outputs=fake,
        create_graph=True,
        retain_graph=True,
        only_inputs=True,
    )[0]
    
    gradients = gradients.view(gradients.size(0), -1)
    # 勾配のノルム(大きさ)が 1 になるようにペナルティをかける
    gradient_penalty = ((gradients.norm(2, dim=1) - 1) ** 2).mean() * LAMBDA_GP
    return gradient_penalty
