import json,wave,pathlib,numpy as np
root=pathlib.Path('docs/exec-plans/evidence/m21-2');catalog=json.loads(pathlib.Path('shared/vocal-exercises.json').read_text())['exercises'];results=[]
for file in sorted(root.glob('web-vocal-*.wav')):
 with wave.open(str(file)) as w: rate=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(float)/32768
 bpm=int(file.stem.split('-')[-1]);id='-'.join(file.stem.split('-')[1:3]);e=next(e for e in catalog if e['id']==id)
 size=int(rate*.005);env=np.array([np.sqrt(np.mean(a*a)) for a in [x[i:i+size] for i in range(0,len(x),size)]])
 active=env>.03;starts=[];last=-100
 for i in range(1,len(active)):
  if active[i] and not np.any(active[max(0,i-10):i]) and (i-last)*.005>.18:
   starts.append(i*.005);last=i
 pitches=[]
 for start in starts[:3]:
  segment=x[int((start+.025)*rate):int((start+.125)*rate)]; segment=segment-segment.mean()
  if len(segment)<rate*.05:continue
  spectrum=np.abs(np.fft.rfft(segment*np.hanning(len(segment)),n=262144));lo,hi=int(180*262144/rate),int(1000*262144/rate);peak=int(np.argmax(spectrum[lo:hi])+lo);d=.5*(spectrum[peak-1]-spectrum[peak+1])/(spectrum[peak-1]-2*spectrum[peak]+spectrum[peak+1]);hz=(peak+d)*rate/262144;midi=69+12*np.log2(hz/440);pitches.append({'hz':float(hz),'midi':float(midi)})
 expected=e['notes'][:len(pitches)];cents=[100*(p['midi']-m) for p,m in zip(pitches,expected)];intervals=np.diff(starts[:3]);
 results.append({'file':file.name,'bpm':bpm,'onsetsSeconds':starts[:3],'intervalErrorMs':list((intervals-60/bpm)*1000),'pitches':pitches,'centsErrors':cents,'peak':float(max(abs(x))),'clippedSamples':int(np.sum(abs(x)>=.999))})
(root/'web-signal-analysis.json').write_text(json.dumps({'method':'Actual captured PCM: 5ms RMS onset detector; Hann-window FFT with parabolic peak interpolation; errors include capture callback dropouts, not assumed audio-device timing','results':results},indent=2))
for r in results:print(r['file'], 'onsets',r['onsetsSeconds'],'intervalErrorsMs',np.round(r['intervalErrorMs'],2),'cents',np.round(r['centsErrors'],2))


