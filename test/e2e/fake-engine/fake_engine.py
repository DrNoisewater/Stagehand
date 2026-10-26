"""Test stand-in for the Demucs engine: splits a WAV into 6 band-filtered 'stems'
so the queue, progress and stem lanes can be tested without PyTorch (needs numpy + scipy)."""
import json, sys, time, os, struct
import numpy as np
from scipy.signal import butter, sosfiltfilt

def emit(ev, **kw):
    kw['event'] = ev; print(json.dumps(kw), flush=True)

args = sys.argv[1:]
if args and args[0] == '-u': args = args[2:]
if '--check' in args:
    # Simulates the CPU-only PyTorch build, the usual reason a GPU sits idle.
    emit('check', ok=True, python='3.12', torch='2.8.0+cpu', variant='cpu', cudaBuild=None, cuda=False, cudaError=None,
         device='cpu', deviceName='CPU', threads=8, demucs='4.0.1'); sys.exit(0)
if '--prefetch' in args:
    emit('status', message='ok'); sys.exit(0)
a = dict(zip(args[::2], args[1::2]))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'engine'))
import stagehand_stems as eng
audio, sr = eng.read_wav(a['--input'])
emit('status', message='Loading model'); emit('device', device='cpu', name='CPU', threads={'full': 8, 'half': 4, 'low': 2}[a.get('--cpu-load', 'full')])
bands = {'drums': (None, 120, 'low'), 'bass': (40, 250, 'band'), 'guitar': (250, 2500, 'band'), 'vocals': (300, 3400, 'band'), 'piano': (2500, 6000, 'band'), 'other': (6000, None, 'high')}
names = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
for i in range(20):
    time.sleep(float(os.environ.get('FAKE_ENGINE_DELAY', '0.08'))); emit('progress', value=(i + 1) / 21)
os.makedirs(a['--outdir'], exist_ok=True)
for n in names:
    lo, hi, kind = bands[n]
    if kind == 'low': sos = butter(4, hi, 'lowpass', fs=sr, output='sos')
    elif kind == 'high': sos = butter(4, lo, 'highpass', fs=sr, output='sos')
    else: sos = butter(4, [lo, hi], 'bandpass', fs=sr, output='sos')
    y = sosfiltfilt(sos, audio, axis=1).astype(np.float32) * (0.9 if n != 'piano' else 0.4)
    eng.write_wav16(os.path.join(a['--outdir'], n + '.wav'), y, sr)
emit('done', stems=names, sampleRate=sr, frames=int(audio.shape[1]), seconds=1.7, device='cpu')
