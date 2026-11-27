import pathlib,hashlib,json,wave
root=pathlib.Path('.');src=root/'build/m21-r1/source/sfz/UprightPianoKW-small-SFZ-20190703';bank=json.loads((root/'shared/audio/upright-kw.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source_by_hash={sha(p):p for p in (src/'samples').glob('*.wav')};files=[]
for r in bank['regions']:
 p=root/'web/public'/r['file'].lstrip('/');h=sha(p);assert h in source_by_hash
 with wave.open(str(p)) as w:rate=w.getframerate();frames=w.getnframes();channels=w.getnchannels();width=w.getsampwidth()
 assert (rate,channels,width)==(44100,1,2)
 files.append({'file':r['file'],'sha256':h,'bytes':p.stat().st_size,'original':source_by_hash[h].name,'frames':frames,'rate':rate,'channels':channels})
assert all(sum(r['low']<=m<=r['high'] for r in bank['regions'])==1 for m in range(48,89))
archive=root/'build/m21-r1/source/upright-small-sfz.7z';assert sha(archive)=='ffb547fceb91eeb93d78cf8d220d1d5f726dcac891afc15e517805ac48abb39d'
report={'origin':'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html','archiveUrl':'https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-small-SFZ-20190703.7z','archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size,'archive7zInternalIntegrity':'PASS (7z t performed at download)','authenticityLimit':'No upstream published SHA/signature; official HTTPS origin, internal CRC and locally pinned hash','license':'CC0-1.0','licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/','licenseSha256':sha(src/'cc0.txt'),'readmeSha256':sha(src/'readme.txt'),'sfzSha256':sha(next(src.glob('*.sfz'))),'sampleBytes':sum(f['bytes'] for f in files),'files':files}
path=root/'docs/exec-plans/evidence/m21-2-r1/sample-provenance.json';path.write_text(json.dumps(report,indent=2));print('PASS: original sample byte equality, SHA256, mono44.1k PCM16, unique region coverage48..88; bytes',report['sampleBytes'])
