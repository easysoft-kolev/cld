import sys, numpy as np, soundfile as sf
vo_dir, out = sys.argv[1], sys.argv[2]
SR, DUR = 44100, 42.2
N = int(SR * DUR)
rng = np.random.default_rng(7)
def place(buf, sig, t):
    i = int(t * SR); j = min(N, i + len(sig))
    if i < N: buf[i:j] += sig[: j - i]
def env(n, a=0.005, r=0.1):
    e = np.ones(n); na = max(1, int(a * SR)); nr = max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr); return e
def lp(x, k):  # cheap one-pole lowpass, k in (0,1)
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc += k * (v - acc); y[i] = acc
    return y

# ---- voice
offs = [0.3, 3.1, 10.25, 12.4, 17.0, 21.0, 23.8, 27.0, 33.5, 38.5]
voice = np.zeros(N); spans = []
for i, t in enumerate(offs):
    s, sr = sf.read(f"{vo_dir}/p{i}.wav"); s = s if s.ndim == 1 else s.mean(1)
    s = s / (np.abs(s).max() + 1e-9) * 0.9
    place(voice, s, t); spans.append((t, t + len(s) / SR))

# ---- music: 105 BPM, Am F C G
bpm = 105; beat = 60 / bpm; bar = beat * 4
chords = [[110.0, 130.81, 164.81], [87.31, 110.0, 130.81], [130.81, 164.81, 196.0], [98.0, 123.47, 146.83]]
pad = np.zeros(N); bass = np.zeros(N); kick = np.zeros(N); hat = np.zeros(N); clap = np.zeros(N)
tt = np.arange(int(bar * SR)) / SR
for b in range(int(DUR / bar) + 1):
    ch = chords[b % 4]
    sig = sum(np.sin(2 * np.pi * f * 2 * tt) * 0.5 + np.sin(2 * np.pi * f * 2 * 1.003 * tt) * 0.5 for f in ch) / 3
    sig *= env(len(tt), 0.3, 0.4)
    place(pad, sig, b * bar)
    for k in range(4):
        n = int(beat * SR * 0.9); tb = np.arange(n) / SR
        place(bass, np.sin(2 * np.pi * ch[0] / 2 * tb) * env(n, 0.005, 0.15) * np.exp(-tb * 2), b * bar + k * beat)
kn = int(0.3 * SR); tk = np.arange(kn) / SR
kick_s = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-tk * 30)) / SR) * np.exp(-tk * 11)
hn = int(0.05 * SR); hat_s = np.diff(rng.standard_normal(hn + 1)) * np.exp(-np.arange(hn) / SR * 90) * 0.5
cn = int(0.18 * SR); clap_s = rng.standard_normal(cn) * np.exp(-np.arange(cn) / SR * 25) * 0.5
nb = int(DUR / beat) + 1
for k in range(nb):
    t = k * beat
    if t >= 9.8:  # drop on the TRACE reveal
        place(kick, kick_s, t)
        if k % 2 == 1: place(clap, lp(clap_s, 0.35), t)
    place(hat, hat_s, t + beat / 2)
    if t >= 9.8: place(hat, hat_s * 0.6, t + beat * 0.25); place(hat, hat_s * 0.6, t + beat * 0.75)
# riser before the drop
rn = int(2.2 * SR); tr = np.arange(rn) / SR
riser = rng.standard_normal(rn) * (tr / tr[-1]) ** 2 * 0.25
place(pad, lp(riser, 0.25), 9.8 - 2.2)
music = pad * 0.22 + lp(bass, 0.08) * 0.9 + kick * 0.8 + hat * 0.35 + clap * 0.35
intro = np.ones(N); intro[: int(9.8 * SR)] = 0.75
music *= intro

# ---- SFX
sfx = np.zeros(N)
def paper(t, d=0.7):
    n = int(d * SR); x = rng.standard_normal(n); fl = 0.4 + 0.6 * np.abs(np.sin(np.arange(n) / SR * 2 * np.pi * 9))
    place(sfx, (x - lp(x, 0.15)) * fl * env(n, 0.02, 0.3) * 0.35, t)
def click(t, g=0.25, dec=400):
    n = int(0.025 * SR); x = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * dec)
    place(sfx, (x - lp(x, 0.3)) * g, t)
def whoosh(t, d=0.9):
    n = int(d * SR); x = rng.standard_normal(n); s = np.sin(np.linspace(0, np.pi, n)) ** 2
    place(sfx, lp(x, 0.08) * s * 0.9, t)
def pop(t):
    n = int(0.09 * SR); tp = np.arange(n) / SR
    place(sfx, np.sin(2 * np.pi * (600 + 900 * tp / tp[-1]) * tp) * np.exp(-tp * 40) * 0.22, t)
def swish(t):
    n = int(0.3 * SR); x = rng.standard_normal(n); s = np.sin(np.linspace(0, np.pi, n))
    place(sfx, (x - lp(x, 0.4)) * s * 0.18, t)
paper(0.0); swish(1.4); swish(1.65)
def typing(start, nchars, cps):
    for i in range(nchars): click(start + i / cps + rng.uniform(-0.01, 0.01), 0.14 + rng.uniform(0, 0.06))
typing(3.2, 43, 26)
A = 12.0  # app recording offset: taps and keystrokes from record_app.js
for t in (1.52, 2.12, 2.92, 3.72, 5.02, 5.79, 6.52, 7.29, 7.72, 8.49, 9.72, 10.32, 10.92, 12.42, 13.42, 15.62):
    click(A + t, 0.45, 260)
typing(A + 2.14, 4, 9.1); typing(A + 2.94, 4, 9.1); typing(A + 12.44, 6, 11.8); typing(A + 13.44, 6, 11.8)
for t in (9.72, 10.32, 10.92): pop(A + t + 0.03)
pop(A + 16.3); pop(A + 16.42)
whoosh(9.6); whoosh(11.8, 0.6); whoosh(33.0, 0.7); whoosh(38.0, 0.8)
# ---- ducking under the voice
duck = np.ones(N)
for a, b in spans:
    i, j = int((a - 0.08) * SR), int((b + 0.15) * SR); duck[max(0, i):min(N, j)] = 0.45
duck = lp(duck, 0.0015)
mix = voice * 1.0 + music * duck * 0.55 + sfx * 0.8
fo = int(0.8 * SR); mix[-fo:] *= np.linspace(1, 0, fo)
mix = mix / (np.abs(mix).max() + 1e-9) * 0.95
sf.write(out, np.stack([mix, mix], 1).astype(np.float32), SR)
sf.write(out.replace('.wav', '_voice_only.wav'), voice.astype(np.float32), SR)
print("ok", spans)
