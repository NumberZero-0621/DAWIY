import os
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import random
import torch
import numpy as np

# 先ほど定義したGeneratorクラスをインポート
from cnn_gan import Generator, LATENT_DIM, TIME_STEPS, PITCH_RANGE

app = FastAPI()

# DAWIY (ブラウザ) からの通信を許可するための設定 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateRequest(BaseModel):
    length_bars: float
    length_beats: float
    tempo: float
    temperature: float
    seed: int
    latent_vector_size: int
    min_pitch: int
    max_pitch: int
    total_duration_ms: float

# -----------------------------------------------------
# モデルの読み込み
# -----------------------------------------------------
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
generator = Generator().to(device)

# 学習済みモデルがある場合のみ読み込む
if os.path.exists("generator.pth"):
    generator.load_state_dict(torch.load("generator.pth", map_location=device))
    print("学習済みモデル generator.pth を読み込みました！")
else:
    print("WARNING: generator.pth が見つかりません。学習が完了するまでは未学習のモデル（ランダムな出力）を使用します。")

generator.eval() # 推論モード

# -----------------------------------------------------
# 行列からノート(音符)への変換関数
# -----------------------------------------------------
def convert_piano_roll_to_notes(piano_roll, req):
    # piano_roll の shape は (1, 1, 64, 128) になっているので (64, 128) に変形
    roll = piano_roll.squeeze().cpu().numpy()
    notes = []
    
    # 64ステップが合計何ミリ秒になるか（DAWIYから送られてきた長さで按分）
    step_ms = req.total_duration_ms / TIME_STEPS
    
    threshold = 0.5 # 出力確率が50%を超えていたら音が鳴っているとみなす

    for pitch in range(PITCH_RANGE):
        is_on = False
        start_step = 0
        for step in range(TIME_STEPS):
            val = roll[step, pitch]
            if val >= threshold and not is_on:
                is_on = True
                start_step = step
            elif val < threshold and is_on:
                is_on = False
                duration_steps = step - start_step
                # ピッチが指定範囲外の時は無視する
                if req.min_pitch <= pitch <= req.max_pitch:
                    notes.append({
                        "pitch": pitch,
                        "startMs": int(start_step * step_ms),
                        "durationMs": int(duration_steps * step_ms),
                        "velocity": 100
                    })
        # 最後のステップで音が鳴りっぱなしだった場合の処理
        if is_on:
            duration_steps = TIME_STEPS - start_step
            if req.min_pitch <= pitch <= req.max_pitch:
                notes.append({
                    "pitch": pitch,
                    "startMs": int(start_step * step_ms),
                    "durationMs": int(duration_steps * step_ms),
                    "velocity": 100
                })
    return notes


@app.post("/generate")
def generate_melody(req: GenerateRequest):
    print("DAWIYから生成リクエストを受け取りました")

    # 1. 指定されたシード値やランダムなノイズ (z) を作成
    if req.seed != -1:
        torch.manual_seed(req.seed)
    
    # batch_size=1, 指定されたLatent Vector Sizeのノイズ
    z = torch.randn(1, req.latent_vector_size).to(device)
    
    # 2. モデルに推論させる (ピアノロール行列が出てくる)
    with torch.no_grad():
        generated_piano_roll = generator(z)
        
    # 3. ピアノロール行列 (64ステップ × 128ピッチ) を解析して
    # DAWIYが読める notes のリストに変換する
    notes = convert_piano_roll_to_notes(generated_piano_roll, req)
    
    return {"notes": notes}
