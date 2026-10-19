# Generates the 10 voice-over lines with Microsoft's Bulgarian voice (free) and zips them.
# Run on your own computer:  pip install edge-tts   then   python make_voice.py
# Female voice instead:       python make_voice.py bg-BG-KalinaNeural
import asyncio, json, os, sys, zipfile
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = sys.argv[1] if len(sys.argv) > 1 else "bg-BG-BorislavNeural"

async def main():
    with open(os.path.join(HERE, "source", "voiceover_lines.json"), encoding="utf-8") as f:
        lines = json.load(f)
    out = os.path.join(HERE, "voice")
    os.makedirs(out, exist_ok=True)
    for i, text in enumerate(lines):
        await edge_tts.Communicate(text, VOICE).save(os.path.join(out, f"l{i}.mp3"))
        print(f"{i + 1}/{len(lines)}  {text}")
    zip_path = os.path.join(HERE, "voice.zip")
    with zipfile.ZipFile(zip_path, "w") as z:
        for i in range(len(lines)):
            z.write(os.path.join(out, f"l{i}.mp3"), f"l{i}.mp3")
    print("\nГотово! Качи този файл в чата:", zip_path)

asyncio.run(main())
