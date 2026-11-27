import json,pathlib,wave,numpy as np
from scipy.signal import resample_poly,fftconvolve
from fractions import Fraction
root=pathlib.Path('docs/exec-plans/evidence/m21-2-r1');bank=json.loads(pathlib.Path('shared/audio/upright-kw.json').read_text());lib=json.loads(pathlib.Path('shared/vocal-exercises.json').read_text())['exercises'];capture=json.loads((root/'capture.json').read_text());results=[]
def wav(p):
 with wave.open(str(p)) as w:return w.getframerate(),np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(float)/32768

def template(midi,rate):
 reg=next(r for r in bank['regions'] if r['low']<=midi<=r['high']);sr,x=wav(pathlib.Path('web/public')/reg['file'].lstrip('/'));ratio=Fraction(rate/(sr*2**((midi-reg['root'])/12))).limit_denominator(1000);t=resample_poly(x[:int(sr*.2)],ratio.numerator,ratio.denominator)[:int(rate*.12)];t*=np.minimum(1,np.arange(len(t))/(rate*.003));return t

def match(x,t,low,high):
 low=max(0,low);high=min(len(x),high);s=x[low:high+len(t)];c=fftconvolve(s,t[::-1],mode='valid');energy=fftconvolve(s*s,np.ones(len(t)),mode='valid');score=c/np.sqrt(np.maximum(1e-15,energy*np.sum(t*t)));i=int(np.argmax(score));return (low+i),float(score[i])
for case in capture['cases'][:4]:
 name=case['name'];rate,x=wav(root/(name+'.wav'));e=next(v for v in lib if v['id']==case['id']);minimum=max(e['minTranspose'],case['low']-min(e['notes']));maximum=min(e['maxTranspose'],case['high']-max(e['notes']));shifts=list(range(minimum,maximum+1));
 if case.get('direction')==-1:shifts=shifts[::-1]
 midi=[];times=[];elapsed=0
 for shift in shifts:
  for n,d in zip(e['notes'],e['noteDurations']):midi.append(n+shift);times.append(elapsed*60/case['bpm']);elapsed+=d
  elapsed+=1
 first,confidence=match(x,template(midi[0],rate),0,int(rate*1.4));offset=first/rate;notes=[]
 for note,seconds in zip(midi,times):
  expected=offset+seconds
  if expected+.2>len(x)/rate:break
  idx,score=match(x,template(note,rate),int((expected-.03)*rate),int((expected+.03)*rate));t=idx/rate;s=x[idx+int(rate*.06):idx+int(rate*.26)];f0=440*2**((note-69)/12);sp=abs(np.fft.rfft((s-s.mean())*np.hanning(len(s)),n=262144));lo=int(f0*.97*262144/rate);hi=int(f0*1.03*262144/rate);k=int(np.argmax(sp[lo:hi])+lo);d=.5*(sp[k-1]-sp[k+1])/(sp[k-1]-2*sp[k]+sp[k+1]);hz=(k+d)*rate/262144
  notes.append({'midi':note,'onsetSeconds':t,'expectedRelativeSeconds':seconds,'timingErrorMs':(t-expected)*1000,'sampleFingerprintCorrelation':score,'measuredHz':float(hz),'centsFromEqualTemperament':float(1200*np.log2(hz/f0))})
 results.append({'name':name,'sampleRate':rate,'captureGapFrames':case['gapFrames'],'detectedStart':offset,'notes':notes})
for case in capture['cases']:
 if not case['frames']:continue
 r,x=wav(root/(case['name']+'.wav'));case['maxAdjacentStep']=float(max(abs(np.diff(x)))) if len(x)>1 else 0
report={'method':'Matched filtering against original recorded WAV attack templates resampled to target MIDI. No synthesized expected PCM. F0: Hann FFT around expected acoustic fundamental; recorded piano tuning may differ from equal temperament. Capture gaps remain unpadded and bound timing uncertainty.','results':results,'signalCases':capture['cases']};(root/'signal-analysis.json').write_text(json.dumps(report,indent=2))
for c in results:print(c['name'],'notes',len(c['notes']),'timingMs',round(max(abs(n['timingErrorMs']) for n in c['notes']),3),'cents',round(max(abs(n['centsFromEqualTemperament']) for n in c['notes']),2),'minFingerprint',round(min(n['sampleFingerprintCorrelation'] for n in c['notes']),3))

