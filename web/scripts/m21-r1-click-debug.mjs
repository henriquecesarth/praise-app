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
 const tap=new AudioWorkletNode(audio,'capture');const bus=audio.createGain();const quiet=audio.createConstantSource();quiet.offset.value=0;quiet.connect(bus);quiet.start();bus.connect(tap);tap.connect(audio.destination);tap.port.onmessage=e=>{window.__pcm.push(...e.data.pcm);window.__blocks.push(e.data.frame);};audio.__tapBus=bus;
 window.AudioContext=function(){return audio;};window.AudioContext.prototype=Base.prototype;
 };
 const connect=AudioNode.prototype.connect;
 AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode && this.context.__tapBus && !(this instanceof AudioWorkletNode)){connect.call(this,this.context.__tapBus);}return connect.call(this,destination,...args);};
});
const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:4181/exercicios-vocais');
await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.evaluate(()=>window.__prepareCapture());
function wav(pcm,rate,file){const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);pcm.forEach((v,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),44+i*2));fs.writeFileSync(file,b);}
await page.evaluate(async()=>{window.__diag=[];const {SampledPiano}=await import('/src/audio/sampled-piano.ts');for(const method of ['fadeOut','fadeIn']){const original=SampledPiano.prototype[method];SampledPiano.prototype[method]=async function(...args){window.__diag.push({method,when:'begin',time:this.context.currentTime,gain:this.output.gain.value});const result=await original.apply(this,args);window.__diag.push({method,when:'end',time:this.context.currentTime,gain:this.output.gain.value});return result;};}});
await page.locator('select').first().selectOption('vocal-02');await page.getByLabel('Andamento BPM',{exact:true}).fill('80');await page.getByLabel('Ativar metrônomo',{exact:true}).uncheck();
await page.evaluate(()=>{window.__pcm=[];window.__blocks=[]});await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.getByRole('status').filter({hasText:/MIDI /}).waitFor();await page.waitForTimeout(220);await page.getByRole('button',{name:'Pausar',exact:true}).click();await page.getByRole('button',{name:'Retomar',exact:true}).waitFor();const before=await page.evaluate(()=>window.__audio.currentTime);await page.waitForTimeout(300);const after=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Retomar',exact:true}).click();await page.waitForTimeout(320);const resumed=await page.evaluate(()=>window.__audio.currentTime);await page.getByRole('button',{name:'Parar',exact:true}).click();await page.waitForTimeout(150);const transport=await page.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate,blocks:window.__blocks,diag:window.__diag}));fs.writeFileSync(`${out}/click-debug.json`,JSON.stringify({blocks:transport.blocks,diag:transport.diag},null,2));wav(transport.pcm,transport.rate,`${out}/transport-debug.wav`);
await page.evaluate(()=>window.__pcm=[]);await page.waitForTimeout(350);const stop=await page.evaluate(()=>({frames:window.__pcm.length,peak:window.__pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0)}));
for(const id of ['vocal-02','vocal-03','vocal-01']){await page.locator('select').first().selectOption(id);await page.getByRole('button',{name:'Tocar progressão',exact:true}).click();await page.getByRole('status').filter({hasText:/MIDI /}).waitFor();await page.waitForTimeout(40);await page.getByRole('button',{name:'Parar',exact:true}).click();}
await page.waitForTimeout(100);await page.evaluate(()=>window.__pcm=[]);await page.waitForTimeout(350);const rapid=await page.evaluate(()=>({frames:window.__pcm.length,peak:window.__pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0)}));const result={method:'Real AudioWorklet parallel capture with a zero-valued constant input to keep collecting silence after master disconnect',pauseClockDelta:after-before,resumeClockDelta:resumed-after,stop,rapid,errors};fs.writeFileSync(`${out}/transport-debug.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
