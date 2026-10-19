import sys, json, sherpa_onnx, soundfile as sf, numpy as np
m, outdir, mode = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
        duration_predictor=f"{m}/duration_predictor.int8.onnx", text_encoder=f"{m}/text_encoder.int8.onnx",
        vector_estimator=f"{m}/vector_estimator.int8.onnx", vocoder=f"{m}/vocoder.int8.onnx",
        tts_json=f"{m}/tts.json", unicode_indexer=f"{m}/unicode_indexer.bin", voice_style=f"{m}/voice.bin"),
    num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
def say(text, sid, speed, steps=12):
    g = sherpa_onnx.GenerationConfig(); g.sid = sid; g.num_steps = steps; g.speed = speed; g.extra["lang"] = "bg"
    a = tts.generate(text, g); return np.array(a.samples, dtype=np.float32), a.sample_rate
def f0(x, sr):
    fr = int(0.04 * sr); hop = fr // 2; vals = []
    for i in range(0, len(x) - fr, hop):
        w = x[i:i + fr] * np.hanning(fr)
        if np.sqrt((w ** 2).mean()) < 0.02: continue
        ac = np.correlate(w, w, 'full')[fr - 1:]
        lo, hi = int(sr / 320), int(sr / 70)
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.4 * ac[0]: vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0
if mode == "probe":
    out = []
    for sid in range(10):
        x, sr = say("Още пишете пътни листи на ръка? Запознай се с Трейс.", sid, 1.0, 8)
        sf.write(f"{outdir}/probe_{sid}.wav", x, sr); out.append((sid, round(f0(x, sr)), round(len(x) / sr, 2)))
    print(json.dumps(out))
else:
    sid, speed = int(sys.argv[4]), float(sys.argv[5])
    lines = json.load(open(sys.argv[6]))
    info = []
    for i, t in enumerate(lines):
        x, sr = say(t, sid, speed)
        sf.write(f"{outdir}/l{i}.wav", x, sr); info.append({"i": i, "dur": round(len(x) / sr, 2), "sr": sr})
    print(json.dumps(info))
