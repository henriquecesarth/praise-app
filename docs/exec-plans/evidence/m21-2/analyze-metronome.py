import wave,json,pathlib,numpy as np
root=pathlib.Path('docs/exec-plans/evidence/m21-2');out=[]
for name in ['web-metronome-on.wav','web-progression--1.wav']:
 with wave.open(str(root/name)) as w:r=w.getframerate();x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2')/32768.
 # Spectral energy around the 1200 Hz accented click, compared with piano-only.
 x=x[:int(r*.4)];n=65536;sp=abs(np.fft.rfft(x*np.hanning(len(x)),n=max(n,2**int(np.ceil(np.log2(len(x)))))))**2;f=np.linspace(0,r/2,len(sp));band=float(sp[(f>=1180)&(f<=1220)].sum()/sp.sum());out.append({'file':name,'accentBandFraction':band})
(root/'web-metronome-analysis.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))

