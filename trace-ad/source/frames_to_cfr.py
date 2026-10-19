# Turn timestamped screencast frames into an ffmpeg concat list (held until the next frame).
import sys, json, os
d = sys.argv[1]; end = float(sys.argv[2])
j = json.load(open(os.path.join(d, 'frames.json')))
t0, fr = j['t0'], j['frames']
lines = []
for i, f in enumerate(fr):
    a = max(0.0, f['ts'] - t0)
    b = (fr[i + 1]['ts'] - t0) if i + 1 < len(fr) else end
    if b <= a: continue
    lines.append(f"file '{os.path.abspath(f['file'])}'\nduration {b - a:.4f}")
open(os.path.join(d, 'list.txt'), 'w').write("\n".join(lines) + f"\nfile '{os.path.abspath(fr[-1]['file'])}'\n")
print(json.dumps(j['marks']))
