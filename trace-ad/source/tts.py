import sys, json, sherpa_onnx, soundfile as sf, numpy as np
mdir, outdir, speed = sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f"{mdir}/model.onnx", tokens=f"{mdir}/tokens.txt",
        noise_scale=0.55, noise_scale_w=0.7, length_scale=1.0), num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
# Latin brand words respelled in Cyrillic so the character model can read them
lines = [
 "Още пишете пътни листи на ръка?",
 "Имаш логистична фирма, или работиш в такава? Изгубени листи. Грешни километри. Часове в Ексел.",
 "Запознай се с Трейс.",
 "Шофьорът избира себе си и колата, с едно докосване.",
 "Маршрутът и обектите се отбелязват в движение.",
 "Въвежда километрите, а Трейс смята пробега сам.",
 "Всеки курс влиза в отчета веднага. Без хартия. Без грешки.",
 "Трейс е твоето решение, изцяло направено и персонализирано според клиента.",
 "Трейс от Изисофт. Поискай демо още днес.",
]
info = []
for i, t in enumerate(lines):
    a = tts.generate(t, sid=0, speed=speed)
    s = np.array(a.samples, dtype=np.float32)
    sf.write(f"{outdir}/l{i}.wav", s, a.sample_rate)
    info.append({"i": i, "dur": round(len(s) / a.sample_rate, 2), "sr": a.sample_rate})
print(json.dumps(info))
