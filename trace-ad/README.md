# TRACE — рекламно видео (9:16, 42 сек, BG)

- `TRACE_ad_9x16_BG.mp4` — готовото видео: 1080×1920, 30 fps, мъжки глас + музика + звуци, вградени субтитри
- `TRACE_voiceover_only.wav` — само гласът
- `male_voice_samples.wav` — 5-те мъжки гласа („Глас номер 1…5“); във видеото е **номер 2**

## Как е направено (безплатно, офлайн)
- **Демонстрацията е истинското приложение TRACE** (`index.html` от демото), пуснато локално с примерни данни
  вместо Google Apps Script, и заснето кадър по кадър (`source/record_app.js`).
- Глас: Supertonic 3 (Supertone, модел OpenRAIL-M) през sherpa-onnx, глас sid 6 (`source/tts2.py`).
- Музика и звуци: синтезирани в `source/mix2.py`.
- Останалите сцени: `source/render.html`, заснети с headless Chromium (`source/capture.js`).

## Повторно рендериране
1. Глас: `python tts2.py <supertonic-модел> vo lines 6 1.05 voiceover_lines.json` (после изрязване на тишината → `vo/p*.wav`)
2. Запис на приложението: сервирай копие на TRACE `index.html` с `API_URL = "https://trace.api/exec"`, после
   `PWC=.../playwright-core node record_app.js http://127.0.0.1:8765/index.html rec` и `python frames_to_cfr.py rec 21.2`
3. Сцени: `node capture.js render.html ad_silent.mp4 30`
4. Звук: `python mix2.py vo mix.wav`
5. Сглобяване: записът се слага в телефона на 250,214 (580×1222, заоблена маска) между 12.0 и 33.2 сек.

Контакт в края няма — добави го в описанието/профила или задай `window.CONTACT` в `render.html`.
