import {chromium} from '@playwright/test';
import fs from 'node:fs';
const out='../docs/exec-plans/evidence/m21-2'; fs.mkdirSync(out,{recursive:true});
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
await page.goto('http://127.0.0.1:4173/exercicios-vocais');
await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.evaluate(()=>window.__prepareCapture());
function wav(pcm,rate,file){const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);pcm.forEach((v,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),44+i*2));fs.writeFileSync(file,b);}
const cases=[];
await page.locator('select').first().selectOption('vocal-02');await page.getByLabel('Andamento BPM',{exact:true}).fill('180');await page.getByLabel('Nota MIDI mais grave',{exact:true}).fill('60');await page.getByLabel('Nota MIDI mais aguda',{exact:true}).fill('73');await page.getByLabel('Ativar metrônomo',{exact:true}).uncheck();
for(const direction of ['1','-1']){
 await page.getByLabel('Direção da progressão',{exact:true}).selectOption(direction);await page.evaluate(()=>{window.__pcm=[];window.__blocks=[]});await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(5400);const signal=await page.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate}));wav(signal.pcm,signal.rate,`${out}/web-progression-${direction}.wav`);cases.push({direction,frames:signal.pcm.length,ended:await page.getByRole('button',{name:'Tocar progressão',exact:true}).isEnabled()});
}
await page.getByLabel('Ativar metrônomo',{exact:true}).check();await page.evaluate(()=>window.__pcm=[]);await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(1200);const metro=await page.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate}));wav(metro.pcm,metro.rate,`${out}/web-metronome-on.wav`);await page.getByRole('button',{name:'Parar',exact:true}).click();
await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(300);await page.getByRole('button',{name:'Pausar',exact:true}).click();const pauseBefore=await page.evaluate(()=>window.__audio.currentTime);await page.waitForTimeout(300);const pauseAfter=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Retomar',exact:true}).click();await page.waitForTimeout(350);const resumed=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Parar',exact:true}).click();await page.waitForTimeout(150);await page.evaluate(()=>window.__pcm=[]);await page.waitForTimeout(250);const stopped=await page.evaluate(()=>({frames:window.__pcm.length,peak:window.__pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0)}));
await page.getByLabel('Nota MIDI mais aguda',{exact:true}).fill('61');const invalidDisabled=await page.getByRole('button',{name:'Tocar progressão',exact:true}).isDisabled();await page.getByLabel('Nota MIDI mais aguda',{exact:true}).fill('73');
// Install/caches from actual built SW; reopen a new page with the network disabled.
await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.reload();await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.close();await context.setOffline(true);
const offline=await context.newPage();await offline.goto('http://127.0.0.1:4173/exercicios-vocais');await offline.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await offline.evaluate(()=>window.__prepareCapture());await offline.locator('select').first().selectOption('vocal-03');await offline.getByLabel('Andamento BPM',{exact:true}).fill('120');await offline.getByRole('button',{name:'Tocar progressão',exact:true}).click();await offline.waitForTimeout(900);const offlineSignal=await offline.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate,online:navigator.onLine,controller:!!navigator.serviceWorker.controller}));wav(offlineSignal.pcm,offlineSignal.rate,`${out}/web-offline-reopened.wav`);await offline.getByRole('button',{name:'Parar',exact:true}).click();await offline.screenshot({path:`${out}/web-offline.png`});
const report={cases,metronomeFrames:metro.pcm.length,pauseClockDelta:pauseAfter-pauseBefore,resumeClockDelta:resumed-pauseAfter,stopped,invalidDisabled,offline:{online:offlineSignal.online,controller:offlineSignal.controller,frames:offlineSignal.pcm.length,peak:offlineSignal.pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0)},errors};fs.writeFileSync(`${out}/web-gates.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
