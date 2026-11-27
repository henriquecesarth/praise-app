import wave,json,pathlib,numpy as np
root=pathlib.Path('docs/exec-plans/evidence/m21-2');out=[]
for direction in [1,-1]:
 file=root/f'web-progression-{direction}.wav'
 with wave.open(str(file)) as w:rate=w.getframerate();x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2')/32768.
 size=int(rate*.005);env=np.array([np.sqrt(np.mean(x[i:i+size]**2)) for i in range(0,len(x),size)]);a=env>.03;starts=[]
 for i in range(10,len(a)):
  if a[i] and not np.any(a[i-10:i]):starts.append(i*.005)
 pitches=[]
 for t in starts:
  s=x[int((t+.025)*rate):int((t+.125)*rate)];sp=abs(np.fft.rfft((s-s.mean())*np.hanning(len(s)),n=262144));lo,hi=int(180*262144/rate),int(1000*262144/rate);k=int(np.argmax(sp[lo:hi])+lo);d=.5*(sp[k-1]-sp[k+1])/(sp[k-1]-2*sp[k]+sp[k+1]);pitches.append(float(69+12*np.log2(((k+d)*rate/262144)/440)))
 notes=[60,64,67,72,67,64,60];shifts=[0,1] if direction==1 else [1,0];expected=[n+s for s in shifts for n in notes];expectedOnsets=np.array([i/3 for i in range(7)]+[(8+i)/3 for i in range(7)]);err=list(((np.array(starts)-starts[0])-expectedOnsets)*1000) if len(starts)==14 else []
 out.append({'direction':direction,'onsetsSeconds':starts,'midiMeasured':pitches,'midiExpected':expected,'maxAbsCents':max(abs(100*(m-n)) for m,n in zip(pitches,expected)),'relativeTimingErrorsMs':err,'noteCount':len(starts),'clippedSamples':int(np.sum(abs(x)>=.999))})
(root/'web-progression-analysis.json').write_text(json.dumps(out,indent=2));print(json.dumps([{'direction':r['direction'],'notes':r['noteCount'],'maxCents':r['maxAbsCents'],'maxMs':max(map(abs,r['relativeTimingErrorsMs'])) if r['relativeTimingErrorsMs'] else None} for r in out]))
