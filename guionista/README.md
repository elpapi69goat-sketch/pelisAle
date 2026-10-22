# Guionista

Web para sacar el audio de un video (MP3) y transcribirlo a guión, todo dentro del navegador.

- `app.js`: decodifica el audio del video, dibuja la onda y maneja la interfaz.
- `mp3-worker.js`: pasa el audio a MP3 con lamejs.
- `asr-worker.js`: Whisper (transformers.js) en el navegador, en tramos de 30 s cortados en silencios.
- `test/e2e.mjs`: prueba de punta a punta con Playwright.

Para transcripciones más precisas fuera del navegador: `python3 -I tools/transcribe.py <audio> <salida> es` (Whisper large-v3-turbo).
