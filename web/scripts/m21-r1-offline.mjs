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
await page.goto('http://127.0.0.1:4183/exercicios-vocais');
await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.evaluate(()=>window.__prepareCapture());
function wav(pcm,rate,file){const b=Buffer.alloc(44+pcm.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length*2,40);pcm.forEach((v,i)=>b.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(v*32767))),44+i*2));fs.writeFileSync(file,b);}
await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await page.reload();await page.getByRole('heading',{name:'Exercícios vocais'}).waitFor();await page.close();
const offline=await context.newPage();await context.setOffline(true);await offline.goto('http://127.0.0.1:4183/exercicios-vocais');await offline.getByRole('heading',{name:'Exercícios vocais'}).waitFor();
const probe=await offline.evaluate(async()=>{try{await fetch('/m21-network-probe-'+Date.now(),{cache:'no-store'});return 'UNEXPECTED_NETWORK_SUCCESS';}catch{return 'NETWORK_REQUEST_FAILED';}});
await offline.evaluate(()=>window.__prepareCapture());await offline.locator('select').first().selectOption('vocal-03');await offline.getByLabel('Andamento BPM',{exact:true}).fill('120');await offline.getByRole('button',{name:'Tocar progressão',exact:true}).click();await offline.getByRole('status').filter({hasText:/MIDI /}).waitFor();await offline.waitForTimeout(1000);const signal=await offline.evaluate(()=>({pcm:window.__pcm,rate:window.__audio.sampleRate,online:navigator.onLine,controller:!!navigator.serviceWorker.controller}));wav(signal.pcm,signal.rate,`${out}/web-offline-reopened.wav`);await offline.getByRole('button',{name:'Parar',exact:true}).click();await offline.screenshot({path:`${out}/web-offline.png`});const cachedSamples=await offline.evaluate(async()=>{const names=await caches.keys();let files=[];for(const name of names){const cache=await caches.open(name);files.push(...(await cache.keys()).map(r=>r.url).filter(u=>u.includes('/audio/upright-kw/')&&u.includes('.wav')));}return [...new Set(files)];});const report={cachedSamples,probe,online:signal.online,controller:signal.controller,frames:signal.pcm.length,peak:signal.pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0),errors};fs.writeFileSync(`${out}/web-offline.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
