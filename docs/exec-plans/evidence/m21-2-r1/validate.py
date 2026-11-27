import json,pathlib,numpy as np,wave
p=pathlib.Path('docs/exec-plans/evidence/m21-2-r1');read=lambda n:json.loads((p/n).read_text());capture=read('capture.json');signals=read('signal-analysis.json');transport=read('transport.json');offline=read('web-offline.json');poly=read('polyphony.json');gain=read('gain-ramp-regression.json');assets=read('sample-provenance.json')
assert len(capture['cases'])==8 and not capture['errors']
assert all(c['frames']>0 and c['clipped']==0 and c['peak']<.93 for c in capture['cases'])
assert len(signals['results'])==4
for c in signals['results']:
 assert c['notes'] and min(n['sampleFingerprintCorrelation'] for n in c['notes'])>.85
 assert max(abs(n['centsFromEqualTemperament']) for n in c['notes'])<15
 assert max(abs(n['timingErrorMs']) for n in c['notes'])<10
assert all(len(c['notes'])==30 for c in signals['results'] if c['name'].startswith('scale'))
assert transport['pauseClockDelta']==0 and transport['resumeClockDelta']>.2
assert transport['stop']['frames']>0 and transport['stop']['peak']==0
assert transport['rapid']['frames']>0 and transport['rapid']['peak']==0 and not transport['errors']
assert len(offline['cachedSamples'])==14 and offline['controller'] and offline['probe']=='NETWORK_REQUEST_FAILED'
assert offline['frames']>0 and offline['peak']>0 and not offline['errors']
assert poly['clipped']==0 and poly['peak']<.93 and poly['boundaryStep']<.01
assert gain['cases'][0]['largestStep']>.1 and gain['cases'][1]['largestStep']<.001
assert len(assets['files'])==14 and assets['sampleBytes']<6000000
with wave.open(str(p/'transport-transitions.wav')) as w:x=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2')/32768
nz=np.flatnonzero(x);step=abs(x[nz[-1]]) if len(nz) else 0
result={'technicalStatus':'PASS_WITH_RECORDED_LIMITS','humanStatus':'Unknown / Not yet verified','actualCapturedCases':8,'fingerprintedNotes':sum(len(c['notes']) for c in signals['results']),'maxMIDIDeviationCents':max(abs(n['centsFromEqualTemperament']) for c in signals['results'] for n in c['notes']),'captureGapFramesMaximum':max(c['gapFrames'] for c in capture['cases']),'captureGapUncertaintyMs':max(c['gapFrames'] for c in capture['cases'])/48,'stopLastSampleToZeroStep':float(step),'limitations':['Source piano carries original acoustic tuning, no cents-perfect oscillator claim','Worklet captures before speakers; missing captured frames remain unpadded','Offline is browser network emulation, navigator.onLine remained true','No human click/timbre approval yet','Android backend not integrated or built in R1']};(p/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

