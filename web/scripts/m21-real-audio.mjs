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
await page.goto('http://127.0.0.1:4181/exercicios-vocais');
await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.evaluate(()=>window.__prepareCapture());
function wav(pcm,rate,file){const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);pcm.forEach((v,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),44+i*2));fs.writeFileSync(file,b);}
const results=[];
for(const id of ['vocal-01','vocal-02','vocal-03'])for(const bpm of [40,80,120,180]){
 await page.locator('select').first().selectOption(id);await page.getByLabel('Andamento BPM',{exact:true}).fill(String(bpm));await page.getByLabel('Nota MIDI mais grave',{exact:true}).fill('60');await page.getByLabel('Nota MIDI mais aguda',{exact:true}).fill('73');await page.getByLabel('Ativar metrônomo',{exact:true}).uncheck();
 await page.evaluate(()=>{window.__pcm=[];window.__blocks=[]});await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(3*60000/bpm+350);
 const state=await page.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate,state:window.__audio.state,blocks:window.__blocks}));
 await page.getByRole('button',{name:'Parar',exact:true}).click();
 const peak=state.pcm.reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);const rms=Math.sqrt(state.pcm.reduce((s,x)=>s+x*x,0)/state.pcm.length);
 wav(state.pcm,state.rate,`${out}/web-${id}-${bpm}.wav`); results.push({id,bpm,rate:state.rate,frames:state.pcm.length,peak,rms,state:state.state,captureGapFrames:state.blocks.slice(1).reduce((n,f,i)=>n+Math.max(0,f-state.blocks[i]-128),0)});
}
// Real audio clock must freeze across pause; stop must leave actual PCM silent.
await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(400);await page.getByRole('button',{name:'Pausar',exact:true}).click();const before=await page.evaluate(()=>window.__audio.currentTime);await page.waitForTimeout(500);const after=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Retomar',exact:true}).click();await page.waitForTimeout(300);await page.getByRole('button',{name:'Parar',exact:true}).click();await page.waitForTimeout(200);await page.evaluate(()=>window.__pcm=[]);await page.waitForTimeout(300);const stopSignal=await page.evaluate(()=>({frames:window.__pcm.length,peak:window.__pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0)}));const stopPeak=stopSignal.peak;
await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.waitForTimeout(250);await page.screenshot({path:`${out}/web-playing.png`});await page.getByRole('button',{name:'Parar',exact:true}).click();
fs.writeFileSync(`${out}/web-real-audio.json`,JSON.stringify({browser:await browser.version(),headless:false,method:'Actual AudioWorklet PCM tapped in parallel to browser destination; no audio mocks',results,pauseClockDelta:after-before,stopPeak,stopFrames:stopSignal.frames,errors},null,2));
await browser.close();console.log(JSON.stringify({cases:results.length,pauseClockDelta:after-before,stopPeak,stopFrames:stopSignal.frames,errors}));



