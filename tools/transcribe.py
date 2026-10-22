"""Transcribe un audio o video con Whisper (large-v3-turbo) y escribe el guión.

Uso: python3 -I tools/transcribe.py <archivo> <salida_sin_extension> [idioma]
Genera <salida>.txt (texto con marcas de tiempo) y <salida>.srt (subtítulos).
"""
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

src, out = sys.argv[1], sys.argv[2]
lang = sys.argv[3] if len(sys.argv) > 3 else None  # None = detectar solo

# ffmpeg decodifica cualquier audio/video a 16 kHz mono, que es lo que usa Whisper
raw = subprocess.run(
    ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
    check=True, capture_output=True,
).stdout
audio = np.frombuffer(raw, np.float32)

model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8",
                     download_root="/tmp/claude-0/-home-user-pelisAle/a1c9173a-e2d8-502f-8aa1-c146edfe7054/scratchpad/models")
segments, info = model.transcribe(audio, language=lang, beam_size=5, vad_filter=True, condition_on_previous_text=True)


def ts(t, sep=","):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int((s % 1) * 1000):03d}"


txt, srt = [], []
for i, s in enumerate(segments, 1):
    txt.append(f"[{ts(s.start, '.')[:8]}] {s.text.strip()}")
    srt.append(f"{i}\n{ts(s.start)} --> {ts(s.end)}\n{s.text.strip()}\n")
    print(txt[-1], flush=True)
open(out + ".txt", "w").write("\n".join(txt) + "\n")
open(out + ".srt", "w").write("\n".join(srt))
print(f"idioma: {info.language} ({info.language_probability:.0%}) · duración {info.duration:.0f}s")
