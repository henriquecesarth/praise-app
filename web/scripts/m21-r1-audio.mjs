import {chromium} from '@playwright/test';
import fs from 'node:fs';
const out='../docs/exec-plans/evidence/m21-2-r1'; fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:false});
const context=await browser.newContext();
await context.addInitScript(()=>{
 const Base=window.AudioContext; window.__pcm=[];window.__blocks=[];window.__audio=null;
 window.__prepareCapture=async()=>{
 const audio=new Base(); window.__audio=audio;
 const code=`class Capture extends AudioWorkletProcessor {process(inputs,outputs){const data=inputs[0]?.[0];if(data)this.port.postMessage({frame:currentFrame,pcm:data.slice()});return true;}}registerProcessor('capture',Capture);`;
 const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));await audio.audioWorklet.addModule(url);URL.revokeObjectURL(url);
 const tap=new AudioWorkletNode(audio,'capture');const bus=audio.createGain();bus.connect(tap);tap.connect(audio.destination);tap.port.onmessage=e=>{window.__pcm.push(...e.data.pcm);window.__blocks.push(e.data.frame);};audio.__tapBus=bus;
 window.AudioContext=function(){return audio;};window.AudioContext.prototype=Base.prototype;
 };
 const connect=AudioNode.prototype.connect;
 AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode && this.context.__tapBus && !(this instanceof AudioWorkletNode)){connect.call(this,this.context.__tapBus);}return connect.call(this,destination,...args);};
});
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:4181/exercicios-vocais');
await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.evaluate(()=>window.__prepareCapture());
function wav(pcm,rate,file){const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);pcm.forEach((v,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),44+i*2));fs.writeFileSync(file,b);}
const report={cases:[],errors};
async function reset(){await page.evaluate(()=>{window.__pcm=[];window.__blocks=[];});}
async function save(name,details={}){const s=await page.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate,blocks:window.__blocks}));wav(s.pcm,s.rate,`${out}/${name}.wav`);const peak=s.pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0);report.cases.push({name,...details,frames:s.pcm.length,rate:s.rate,peak,clipped:s.pcm.filter(x=>Math.abs(x)>=1).length,gapFrames:s.blocks.slice(1).reduce((n,f,i)=>n+Math.max(0,f-s.blocks[i]-128),0)});}
async function configure(id,bpm,low,high,direction='1'){await page.locator('select').first().selectOption(id);await page.getByLabel('Andamento BPM',{exact:true}).fill(String(bpm));await page.getByLabel('Nota MIDI mais grave',{exact:true}).fill(String(low));await page.getByLabel('Nota MIDI mais aguda',{exact:true}).fill(String(high));await page.getByLabel('Direção da progressão',{exact:true}).selectOption(direction);await page.getByLabel('Ativar metrônomo',{exact:true}).uncheck();}
async function play(name,seconds,details){await reset();await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.getByRole('status').filter({hasText:/MIDI /}).waitFor();await page.waitForTimeout(seconds*1000);await save(name,details);const stop=page.getByRole('button',{name:'Parar',exact:true});if(await stop.isEnabled())await stop.click();await page.waitForTimeout(100);}
await configure('vocal-02',80,48,84);await play('arpeggio-80',8,{id:'vocal-02',bpm:80,low:48,high:84});
await configure('vocal-01',120,60,73);await play('scale-up',16,{id:'vocal-01',bpm:120,direction:1,low:60,high:73});
await configure('vocal-01',120,60,73,'-1');await play('scale-down',16,{id:'vocal-01',bpm:120,direction:-1,low:60,high:73});
await configure('vocal-19',180,60,73);await play('rapid-repeats',6,{id:'vocal-19',bpm:180,low:60,high:73});
// Public renderer contract: actual acoustic sources, simultaneous notes and sustained loops.
await page.evaluate(async()=>{const {SampledPiano}=await import('/src/audio/sampled-piano.ts');window.__piano=new SampledPiano(window.__audio);await window.__piano.load();});
for(const [name,notes,held,seconds] of [['low-high',[48,88],1.4,3],['chord',[60,64,67,72],1.5,3],['eight-voices',[60,60,60,60,60,60,60,60],1.2,2.5],['sustain-loop',[60],7,8]]){await reset();await page.evaluate(({notes,held})=>{for(const midi of notes)window.__piano.noteOn(midi,window.__audio.currentTime+.1,held);},{notes,held});await page.waitForTimeout(seconds*1000);await save(name,{notes,held});}
await page.evaluate(()=>window.__piano.stop());
await configure('vocal-02',80,60,73);await reset();await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.getByRole('status').filter({hasText:/MIDI /}).waitFor();await page.waitForTimeout(180);await page.getByRole('button',{name:'Pausar',exact:true}).click();await page.getByRole('button',{name:'Retomar',exact:true}).waitFor();const before=await page.evaluate(()=>window.__audio.currentTime);await page.waitForTimeout(350);const after=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Retomar',exact:true}).click();await page.waitForTimeout(400);await page.getByRole('button',{name:'Parar',exact:true}).click();await page.waitForTimeout(120);await save('transport-transitions');await reset();await page.waitForTimeout(300);await save('stop-silence');report.pauseClockDelta=after-before;
// Rapid stop/restart and exercise changes use the actual UI while old releases fade.
for(const id of ['vocal-02','vocal-03','vocal-01']){await configure(id,180,60,73);await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.getByRole('status').filter({hasText:/MIDI /}).waitFor();await page.waitForTimeout(35);await page.getByRole('button',{name:'Parar',exact:true}).click();}
await page.waitForTimeout(100);await reset();await page.waitForTimeout(300);await save('rapid-restart-silence');await page.screenshot({path:`${out}/player-sampled.png`});
fs.writeFileSync(`${out}/capture.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
