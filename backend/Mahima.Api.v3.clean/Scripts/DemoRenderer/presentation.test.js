const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {presentationTiming,markerTime,chapterHtml,createPresentationAssets}=require('./presentation');
const {createBookend,createSegment,createLiveRouteSegments,composeFinalVideoWithMusic,mediaDuration,fitTimelineToDuration}=require('./render-demo');

for(const total of [60,90,300,600])test(`${total}s presentation reserves bookends without dropping module time`,()=>{
 const timing=presentationTiming(total);
 assert.equal(timing.intro+timing.content+timing.outro,total);
 const timeline=fitTimelineToDuration(Array.from({length:37},()=>({durationSeconds:8,route:{}})),timing.content);
 assert.ok(Math.abs(timeline.reduce((n,r)=>n+r.durationSeconds,0)-timing.content)<0.001);
 assert.equal(timeline.length,37);
});
test('recording marker uses encoded timestamps and requires a match',()=>{
 assert.equal(markerTime('frame:4 pts:800 pts_time:3.175\nlavfi.signalstats.UAVG=54'),3.175);
 assert.throws(()=>markerTime(''),/marker was not found/);
 assert.ok(chapterHtml('<script>',0,37).includes('&lt;script&gt;'));
});

test('cinematic preview and delayed-load live recording preserve scene/audio start', {skip:!process.env.FFMPEG_PATH,timeout:240000},async()=>{
 const ffmpeg=process.env.FFMPEG_PATH, ffprobe=process.env.FFPROBE_PATH;
 const dir=path.resolve(__dirname,'../../../../tmp/studio-cinema-preview');
 await fs.mkdir(dir,{recursive:true});
 const run=args=>execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{maxBuffer:8000000});
 const routes=[{title:'Prayer, care and community',path:'/home',waitMs:100}];
 const assets=await createPresentationAssets(dir,routes);
 const intro=await createBookend(ffmpeg,assets,dir,'intro',3);
 const outro=await createBookend(ffmpeg,assets,dir,'outro',3);
 const speech=path.join(dir,'speech.wav');
 run(['-f','lavfi','-i','sine=frequency=440:duration=4','-ar','48000','-ac','2',speech]);
 const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><style>body{margin:0;background:#b00020}#root{height:1800px;font:60px Arial}</style><div id="root"></div><script>if(location.hash.includes('readme'))location.hash='/login';setTimeout(()=>{document.body.style.background='#126bc5';document.querySelector('#root').innerHTML='<h1>Prayer and community</h1><p>Every request heard. Every person remembered.</p>';},1800)</script></html>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let live;
 try {
   const route={...routes[0],presentationOverlay:assets.chapters[0]};
   live=await createLiveRouteSegments({appBaseUrl:`http://127.0.0.1:${server.address().port}`,authToken:'test'},[{route,audioPath:speech,durationSeconds:4}],dir,dir,ffmpeg);
    const fallbackDir=path.join(dir,'redirect-test');
   await fs.mkdir(fallbackDir,{recursive:true});
   const capture=path.join(fallbackDir,'verified.png');
   run(['-f','lavfi','-i','color=c=blue:s=1920x1080','-frames:v','1',capture]);
   const redirected={...route,path:'/home/readme',screenshotPath:capture,captureVerified:true};
   const payload={appBaseUrl:`http://127.0.0.1:${server.address().port}`,authToken:'test'};
   const fallback=await createLiveRouteSegments(payload,[{route:redirected,audioPath:speech,durationSeconds:4}],fallbackDir,fallbackDir,ffmpeg);
   assert.ok(Math.abs(await mediaDuration(ffprobe,fallback[0])-4)<0.1);
   const fallbackPixel=run(['-ss','1','-i',fallback[0],'-frames:v','1','-vf','crop=8:8:1500:600,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-']);
   assert.ok(fallbackPixel[2]>fallbackPixel[0]*2,'Redirect must show verified module capture');
   await assert.rejects(createLiveRouteSegments(payload,[{route:{...redirected,captureVerified:false},audioPath:speech,durationSeconds:4}],fallbackDir,fallbackDir,ffmpeg),/no verified module capture/);
 } finally {await new Promise(resolve=>server.close(resolve));}
 assert.ok(Math.abs(await mediaDuration(ffprobe,live[0])-4)<0.1);
 const pixel=run(['-ss','0.5','-i',live[0],'-frames:v','1','-vf','crop=8:8:1500:600,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-']);
 assert.ok(pixel[2]>pixel[0]*2,'First narrated scene must be loaded blue page, never red loading page');
 const final=path.join(dir,'mahima-presentation-preview.mp4');
 await composeFinalVideoWithMusic(ffmpeg,[intro,...live,outro],dir,final,'uplifting',0.35,10);
 assert.ok(Math.abs(await mediaDuration(ffprobe,final)-10)<0.1);
 const finalPixel=run(['-ss','5','-i',final,'-frames:v','1','-vf','crop=8:8:1500:600,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-']);
 assert.ok(finalPixel[2]>finalPixel[0]*2,'Final composition must retain the module at its scheduled time across colour-metadata changes');
 run(['-ss','1.5','-i',final,'-frames:v','1',path.join(dir,'opening.jpg')]);
 run(['-ss','5','-i',final,'-frames:v','1',path.join(dir,'module.jpg')]);
 run(['-ss','8.5','-i',final,'-frames:v','1',path.join(dir,'closing.jpg')]);
 console.log('Cinematic preview: '+final);
});

