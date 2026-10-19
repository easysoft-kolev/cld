# TRACE — рекламно видео (9:16, 32 сек, BG)

- `TRACE_ad_9x16_BG.mp4` — готовото видео (1080×1920, 30 fps, глас + музика + звуци, вградени субтитри)
- `TRACE_voiceover_music_mix.wav` — само аудиото (глас + музика + SFX)
- `TRACE_voiceover_only.wav` — само гласът

Всичко е генерирано безплатно и офлайн:
- Глас: Coqui VITS `bg/cv` (женски, CC-BY-4.0 / Common Voice) през sherpa-onnx
- Музика и звуци: синтезирани в `source/mix.py`
- Картина: `source/render.html`, заснета кадър по кадър с headless Chromium (`source/capture.js`) и кодирана с ffmpeg

## Повторно рендериране
```bash
pip install sherpa-onnx soundfile numpy
# модел: https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-coqui-bg-cv.tar.bz2
python source/tts.py vits-coqui-bg-cv vo 1.1       # гласът по реплики
python source/mix.py vo mix.wav                    # (след ffmpeg обработка до vo/p*.wav, виж историята)
npm i playwright-core @fontsource/unbounded @fontsource/onest @fontsource/jetbrains-mono @fontsource/caveat
PWC=$PWD/node_modules/playwright-core node source/capture.js source/render.html video_silent.mp4 30
ffmpeg -i video_silent.mp4 -i mix.wav -af loudnorm=I=-14:TP=-1.5 -c:v copy -c:a aac -b:a 192k out.mp4
```
Контактите в края са временни: `window.CONTACT` в `render.html`.
