# Print loudness (dBFS RMS) per window of a wav: python loudness.py file.wav [window_s]
import sys, wave, numpy as np
w = wave.open(sys.argv[1]); win = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
sr, ch = w.getframerate(), w.getnchannels()
a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch).mean(axis=1)
n = int(sr * win)
for i in range(0, len(a), n):
    seg = a[i:i + n]
    rms = np.sqrt(np.mean(seg ** 2)) if len(seg) else 0
    print(f"{i / sr:7.2f} {20 * np.log10(rms / 32768 + 1e-9):6.1f}")
