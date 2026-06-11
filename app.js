
const $=id=>document.getElementById(id);
let audioCtx,analyser,micSource,micStream,timeData,freqData,rafId,autoLogId;
let latest={fft:0,auto:0,main:0,rms:0,db:0,dbFast:0,dbSlow:0,period:0,zcr:0};
let history=[],ampHistory=[],logs=[],calLogs=[],peakHold=[],frozen=false,dbStats={min:Infinity,max:0,sum:0,n:0};
let exportCols=["time","run","preset","label","main","fft","auto","period","rms","db","zcr","top1","top2","top3","note"];
const colNames={time:"เวลา",run:"Run",preset:"Preset",label:"ป้ายกำกับ",main:"Main Hz",fft:"FFT Peak",auto:"Auto Hz",period:"Period",rms:"RMS",db:"dB",zcr:"ZCR",top1:"Peak 1",top2:"Peak 2",top3:"Peak 3",note:"หมายเหตุ"};
const canvases={},ctxs={};
["scope","spectrum","auto","history","amp","beat","resonance","spectrogram"].forEach(n=>{const c=$(n+"Canvas");if(c){canvases[n]=c;ctxs[n]=c.getContext("2d");}});
function drawGrid(ctx,c){if(!ctx||!c)return;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle="#020617";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle="rgba(148,163,184,.12)";ctx.lineWidth=1;for(let x=0;x<c.width;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}for(let y=0;y<c.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}}
function rms(data){let s=0;for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;s+=v*v;}return Math.sqrt(s/data.length);}
function dbFromRms(r){return Math.max(0,Math.min(130,20*Math.log10(Math.max(r,0.00001))+90+Number($("dbOffset").value||0)));}
function estimateFFT(arr,sr){const ny=sr/2,bin=ny/arr.length,minHz=Number($("minFreq").value||50),maxHz=Number($("maxFreq").value||5000);let a=Math.max(1,Math.floor(minHz/bin)),b=Math.min(arr.length-1,Math.floor(maxHz/bin)),mv=-1,idx=0;for(let i=a;i<=b;i++){if(arr[i]>mv){mv=arr[i];idx=i;}}return idx*bin;}
function acAt(buf,lag){let c=0;for(let i=0;i<buf.length-lag;i++)c+=buf[i]*buf[i+lag];return c/(buf.length-lag);}
function estimateAuto(bytes,sr){const n=bytes.length,buf=new Float32Array(n);let r=0;for(let i=0;i<n;i++){const v=(bytes[i]-128)/128;buf[i]=v;r+=v*v;}r=Math.sqrt(r/n);if(r<0.008)return 0;const minHz=Number($("minFreq").value||50),maxHz=Number($("maxFreq").value||5000),minLag=Math.max(2,Math.floor(sr/maxHz)),maxLag=Math.min(n-1,Math.floor(sr/minHz));let best=0,bc=-1;for(let lag=minLag;lag<=maxLag;lag++){let c=0;for(let i=0;i<n-lag;i++)c+=buf[i]*buf[i+lag];c/=(n-lag);if(c>bc){bc=c;best=lag;}}if(!best||bc<0.002)return 0;let ref=best;if(best>minLag&&best<maxLag){const c0=acAt(buf,best-1),c1=acAt(buf,best),c2=acAt(buf,best+1),d=c0-2*c1+c2;if(Math.abs(d)>1e-9)ref=best+0.5*(c0-c2)/d;}return sr/ref;}
function zcr(bytes,sr){let cr=0,p=bytes[0]-128;for(let i=1;i<bytes.length;i++){const c=bytes[i]-128;if((p<0&&c>=0)||(p>=0&&c<0))cr++;p=c;}return cr/(2*(bytes.length/sr));}
function topPeaks(arr,sr,n=3){const ny=sr/2,bin=ny/arr.length,minHz=Number($("minFreq").value||50),maxHz=Number($("maxFreq").value||5000),a=Math.max(2,Math.floor(minHz/bin)),b=Math.min(arr.length-2,Math.floor(maxHz/bin));let peaks=[];for(let i=a;i<=b;i++){if(arr[i]>arr[i-1]&&arr[i]>arr[i+1])peaks.push({hz:i*bin,val:arr[i]});}peaks.sort((x,y)=>y.val-x.val);let chosen=[];for(const p of peaks){if(chosen.every(q=>Math.abs(q.hz-p.hz)>35))chosen.push(p);if(chosen.length>=n)break;}return chosen;}
function mainFreq(){const p=$("preset").value;return ["tone","resonance","doppler"].includes(p)&&latest.auto?latest.auto:latest.fft;}
function set(id,v){const el=$(id);if(el)el.textContent=v;}
function updateStats(db){dbStats.min=Math.min(dbStats.min,db);dbStats.max=Math.max(dbStats.max,db);dbStats.sum+=db;dbStats.n++;}
function level(db){if(db<=30)return"เงียบมาก";if(db<=60)return"ปานกลาง";if(db<=85)return"ค่อนข้างดัง";return"ดังมาก";}
function updateReadouts(){latest.main=mainFreq();latest.period=latest.main?1000/latest.main:0;set("mainFreqOut",latest.main?latest.main.toFixed(1)+" Hz":"-- Hz");set("fftOut",latest.fft?latest.fft.toFixed(1)+" Hz":"-- Hz");set("autoOut",latest.auto?latest.auto.toFixed(1)+" Hz":"-- Hz");set("periodOut",latest.period?latest.period.toFixed(2)+" ms":"-- ms");set("dbOut",latest.db?latest.db.toFixed(1)+" dB":"-- dB");set("bigDb",latest.db?latest.db.toFixed(1):"--");set("dbLevel",latest.db?level(latest.db):"รอการวัด");set("dbStatsOut",dbStats.n?`${dbStats.min.toFixed(0)}/${dbStats.max.toFixed(0)}/${(dbStats.sum/dbStats.n).toFixed(0)} dB`:"--");}
function drawScope(){const ctx=ctxs.scope,c=canvases.scope;if(!ctx||!timeData)return;drawGrid(ctx,c);const g=ctx.createLinearGradient(0,0,c.width,0);g.addColorStop(0,"#22d3ee");g.addColorStop(.55,"#60a5fa");g.addColorStop(1,"#c084fc");ctx.strokeStyle=g;ctx.lineWidth=3;ctx.beginPath();const sl=c.width/timeData.length;for(let i=0;i<timeData.length;i++){const y=(timeData[i]/255)*c.height,x=i*sl;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
function drawSpectrum(peaks){const ctx=ctxs.spectrum,c=canvases.spectrum;if(!ctx||!freqData)return;drawGrid(ctx,c);if(!peakHold.length)peakHold=new Array(freqData.length).fill(0);const bw=c.width/freqData.length*2.5;let x=0;for(let i=0;i<freqData.length;i++){peakHold[i]=Math.max(peakHold[i]||0,freqData[i]);const v=freqData[i]/255,h=v*c.height,ph=(peakHold[i]/255)*c.height,g=ctx.createLinearGradient(0,c.height-h,0,c.height);g.addColorStop(0,"#22d3ee");g.addColorStop(1,"#7c3aed");ctx.fillStyle=g;ctx.fillRect(x,c.height-h,bw,h);ctx.fillStyle="rgba(251,191,36,.6)";ctx.fillRect(x,c.height-ph,bw,2);x+=bw+1;if(x>c.width)break;}if(peaks){ctx.strokeStyle="#fbbf24";ctx.lineWidth=2;peaks.forEach(p=>{const xp=Math.min(c.width,(p.hz/(audioCtx.sampleRate/2))*c.width*2.5);ctx.beginPath();ctx.moveTo(xp,0);ctx.lineTo(xp,c.height);ctx.stroke();});}}
function drawAuto(){const ctx=ctxs.auto,c=canvases.auto;if(!ctx||!timeData)return;drawGrid(ctx,c);const n=timeData.length,buf=new Float32Array(n);for(let i=0;i<n;i++)buf[i]=(timeData[i]-128)/128;const maxLag=Math.min(700,n-1);ctx.strokeStyle="#34d399";ctx.lineWidth=2;ctx.beginPath();for(let lag=1;lag<maxLag;lag++){const corr=acAt(buf,lag),x=(lag/maxLag)*c.width,y=c.height/2-corr*c.height*1.7;if(lag===1)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
function drawHistory(){const ctx=ctxs.history,c=canvases.history;if(!ctx)return;drawGrid(ctx,c);const maxHz=Number($("maxFreq").value||5000);function line(k,col){ctx.strokeStyle=col;ctx.lineWidth=3;ctx.beginPath();history.forEach((p,i)=>{const x=(i/Math.max(1,history.length-1))*c.width,y=c.height-(Math.min(p[k]||0,maxHz)/maxHz)*c.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}line("fft","#22d3ee");line("auto","#fbbf24");line("main","#34d399");ctx.fillStyle="#cfe9ff";ctx.font="18px Sarabun";ctx.fillText("ฟ้า=FFT เหลือง=Auto เขียว=Main",18,26);}
function drawAmp(){const ctx=ctxs.amp,c=canvases.amp;if(!ctx)return;drawGrid(ctx,c);ctx.strokeStyle="#fb7185";ctx.lineWidth=3;ctx.beginPath();ampHistory.forEach((db,i)=>{const x=(i/Math.max(1,ampHistory.length-1))*c.width,y=c.height-(Math.min(db,130)/130)*c.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
function drawSpectrogram(){const ctx=ctxs.spectrogram,c=canvases.spectrogram;if(!ctx||!freqData)return;const img=ctx.getImageData(1,0,c.width-1,c.height);ctx.putImageData(img,0,0);const maxBin=Math.min(freqData.length-1,Math.floor((Number($("maxFreq").value||5000)/(audioCtx.sampleRate/2))*freqData.length));for(let y=0;y<c.height;y++){const bin=Math.floor((1-y/c.height)*maxBin);const v=freqData[bin]/255;ctx.fillStyle=`rgb(${Math.floor(255*v)},${Math.floor(60+180*v)},${Math.floor(180+75*v)})`;ctx.fillRect(c.width-1,y,1,1);}}
function drawBeat(){const ctx=ctxs.beat,c=canvases.beat;if(!ctx)return;drawGrid(ctx,c);const f1=Number($("beatF1").value||440),f2=Number($("beatF2").value||444),beat=Math.abs(f1-f2);set("beatOut",beat.toFixed(2)+" Hz");ctx.strokeStyle="#22d3ee";ctx.lineWidth=2.5;ctx.beginPath();for(let x=0;x<c.width;x++){const t=x/c.width*.12,yv=(Math.sin(2*Math.PI*f1*t)+Math.sin(2*Math.PI*f2*t))/2,y=c.height/2-yv*c.height*.38;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
function drawResonance(){const ctx=ctxs.resonance,c=canvases.resonance;if(!ctx)return;drawGrid(ctx,c);const v=Number($("resV").value||343),L=Number($("resL").value||.25),mode=$("resMode").value,f1=L>0?(mode==="closed"?v/(4*L):v/(2*L)):0;set("resOut",f1?f1.toFixed(1)+" Hz":"-- Hz");const hs=mode==="closed"?[1,3,5,7].map(n=>(n*f1).toFixed(0)+" Hz"):[1,2,3,4].map(n=>(n*f1).toFixed(0)+" Hz");set("harmonicsOut",hs.join(", "));const maxF=Math.max(1000,f1*5);ctx.strokeStyle="#34d399";ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<c.width;x++){const f=x/c.width*maxF;let amp=0;(mode==="closed"?[1,3,5,7]:[1,2,3,4,5]).forEach(n=>{const center=n*f1,w=Math.max(8,center*.018);amp+=Math.exp(-Math.pow((f-center)/w,2));});const y=c.height-Math.min(1,amp)*c.height*.75-20;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
function avg(arr,k){return arr.reduce((s,x)=>s+Number(x[k]||0),0)/arr.length;}
function loop(){if(!frozen){analyser.getByteTimeDomainData(timeData);analyser.getByteFrequencyData(freqData);latest.rms=rms(timeData);const d=dbFromRms(latest.rms);latest.dbFast=d;latest.dbSlow=latest.dbSlow?latest.dbSlow*.9+d*.1:d;latest.db=$("dbMode").value==="slow"?latest.dbSlow:latest.dbFast;latest.fft=estimateFFT(freqData,audioCtx.sampleRate);latest.auto=estimateAuto(timeData,audioCtx.sampleRate);latest.zcr=zcr(timeData,audioCtx.sampleRate);latest.main=mainFreq();latest.period=latest.main?1000/latest.main:0;updateStats(latest.db);const len=Number($("historyLength").value||220);history.push({t:Date.now(),fft:latest.fft||0,auto:latest.auto||0,main:latest.main||0});ampHistory.push(latest.db||0);while(history.length>len)history.shift();while(ampHistory.length>len)ampHistory.shift();const peaks=topPeaks(freqData,audioCtx.sampleRate,3);renderPeaks(peaks);updateReadouts();updateCalibrationUI();drawScope();drawSpectrum(peaks);drawAuto();drawHistory();drawAmp();drawSpectrogram();}rafId=requestAnimationFrame(loop);}
function renderPeaks(peaks){const ol=$("topPeaks");ol.innerHTML="";for(let i=0;i<3;i++){const li=document.createElement("li");li.textContent=peaks[i]?`${peaks[i].hz.toFixed(1)} Hz`:"-- Hz";ol.appendChild(li);}}
async function startMic(){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)();micStream=await navigator.mediaDevices.getUserMedia({audio:true});analyser=audioCtx.createAnalyser();analyser.fftSize=Number($("fftSize").value||2048);analyser.smoothingTimeConstant=Number($("smoothing").value||.65);micSource=audioCtx.createMediaStreamSource(micStream);micSource.connect(analyser);timeData=new Uint8Array(analyser.fftSize);freqData=new Uint8Array(analyser.frequencyBinCount);$("startMic").disabled=true;$("stopMic").disabled=false;$("captureBtn").disabled=false;$("autoLogBtn").disabled=false;if($("captureCalBtn"))$("captureCalBtn").disabled=false;$("micDot").classList.add("on");$("micStatus").classList.add("hidden"); $("micStatus").textContent="";loop();}catch(e){$("micStatus").classList.remove("hidden"); $("micStatus").textContent="ไม่สามารถเปิดไมโครโฟนได้: "+e.message;}}
function stopMic(){if(rafId)cancelAnimationFrame(rafId);if(autoLogId)toggleAutoLog();if(micStream)micStream.getTracks().forEach(t=>t.stop());if(audioCtx)audioCtx.close();audioCtx=null;micStream=null;$("startMic").disabled=false;$("stopMic").disabled=true;$("captureBtn").disabled=true;$("autoLogBtn").disabled=true;if($("captureCalBtn"))$("captureCalBtn").disabled=true;$("micDot").classList.remove("on");$("micStatus").classList.add("hidden"); $("micStatus").textContent="";}
function capture(){const peaks=freqData&&audioCtx?topPeaks(freqData,audioCtx.sampleRate,3):[];logs.push({time:new Date().toLocaleString("th-TH"),run:$("runInput").value||"Run 1",preset:$("preset").value,label:$("labelInput").value||"ไม่ระบุ",main:latest.main?latest.main.toFixed(1):"",fft:latest.fft?latest.fft.toFixed(1):"",auto:latest.auto?latest.auto.toFixed(1):"",period:latest.period?latest.period.toFixed(2):"",rms:latest.rms?latest.rms.toFixed(4):"",db:latest.db?latest.db.toFixed(1):"",zcr:latest.zcr?latest.zcr.toFixed(1):"",top1:peaks[0]?peaks[0].hz.toFixed(1):"",top2:peaks[1]?peaks[1].hz.toFixed(1):"",top3:peaks[2]?peaks[2].hz.toFixed(1):"",note:`min=${$("minFreq").value} max=${$("maxFreq").value} offset=${$("dbOffset").value}`});renderLog();}
function renderLog(){const head=$("logHead"),body=$("logBody");head.innerHTML="";exportCols.forEach(c=>{const th=document.createElement("th");th.textContent=colNames[c];head.appendChild(th);});body.innerHTML="";logs.forEach(r=>{const tr=document.createElement("tr");exportCols.forEach(c=>{const td=document.createElement("td");td.textContent=r[c]??"";tr.appendChild(td);});body.appendChild(tr);});}
function downloadCsv(){const csv=[exportCols.map(c=>colNames[c]),...logs.map(r=>exportCols.map(c=>r[c]??""))].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=makeTopicFileName("Data", "csv");a.click();URL.revokeObjectURL(url);}

function downloadExcel(){
  const headers = exportCols.map(c=>colNames[c]);
  const rows = logs.map(r=>exportCols.map(c=>r[c]??""));
  let html = '<html><head><meta charset="UTF-8"></head><body><table border="1">';
  html += '<tr>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr>';
  rows.forEach(row=>{
    html += '<tr>' + row.map(v=>`<td>${String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</td>`).join('') + '</tr>';
  });
  html += '</table></body></html>';
  const blob = new Blob(['\ufeff'+html], {type:'application/vnd.ms-excel;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = makeTopicFileName('Raw_Data', 'xls');
  a.click();
  URL.revokeObjectURL(url);
}


function updateCalibrationUI(){
  const refF = Number($("refFreq")?.value || 440);
  const measuredF = latest.main || latest.auto || latest.fft || 0;
  const refDb = Number($("refDb")?.value || 70);
  const measuredDb = latest.db || 0;
  if($("measuredFreqBox")) $("measuredFreqBox").value = measuredF ? measuredF.toFixed(1)+" Hz" : "-- Hz";
  if($("measuredDbBox")) $("measuredDbBox").value = measuredDb ? measuredDb.toFixed(1)+" dB" : "-- dB";
  if($("freqErrorOut")){
    if(measuredF){
      const err = measuredF - refF;
      const pct = refF ? (err/refF*100) : 0;
      $("freqErrorOut").textContent = `${err.toFixed(1)} Hz (${pct.toFixed(2)}%)`;
    }else $("freqErrorOut").textContent = "--";
  }
  if($("dbCalOut")){
    if(measuredDb){
      const off = refDb - measuredDb;
      $("dbCalOut").textContent = `${off.toFixed(1)} dB`;
    }else $("dbCalOut").textContent = "-- dB";
  }
}
function captureCalibration(){
  const refF = Number($("refFreq")?.value || 440);
  const measuredF = latest.main || latest.auto || latest.fft || 0;
  const refDb = Number($("refDb")?.value || 70);
  const measuredDb = latest.db || 0;
  const err = measuredF ? measuredF - refF : 0;
  const pct = measuredF && refF ? err/refF*100 : 0;
  const off = measuredDb ? refDb - measuredDb : 0;
  calLogs.push({
    time:new Date().toLocaleString("th-TH"),
    device:$("deviceModel")?.value || "",
    os:$("deviceOS")?.value || "",
    browser:$("browserName")?.value || "",
    distance:$("calDistance")?.value || "",
    refHz:refF.toFixed(1),
    measuredHz:measuredF ? measuredF.toFixed(1) : "",
    errorHz:measuredF ? err.toFixed(1) : "",
    errorPct:measuredF ? pct.toFixed(2) : "",
    refDb:refDb.toFixed(1),
    measuredDb:measuredDb ? measuredDb.toFixed(1) : "",
    dbOffset:measuredDb ? off.toFixed(1) : ""
  });
  renderCalibration();
}
function renderCalibration(){
  const body=$("calBody"); if(!body) return;
  body.innerHTML="";
  calLogs.forEach(r=>{
    const tr=document.createElement("tr");
    [r.time,r.device,r.os,r.browser,r.distance,r.refHz,r.measuredHz,r.errorHz,r.errorPct,r.refDb,r.measuredDb,r.dbOffset].forEach(v=>{
      const td=document.createElement("td"); td.textContent=v; tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}
function downloadCalibrationCsv(){
  const header=["time","device","os","browser","distance","ref_Hz","measured_Hz","error_Hz","error_percent","ref_dB","measured_dB","db_offset"];
  const rows=calLogs.map(r=>[r.time,r.device,r.os,r.browser,r.distance,r.refHz,r.measuredHz,r.errorHz,r.errorPct,r.refDb,r.measuredDb,r.dbOffset]);
  const csv=[header,...rows].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="PhySound_Calibration_Log.csv"; a.click(); URL.revokeObjectURL(url);
}
function applyDbCalibration(){
  const refDb = Number($("refDb")?.value || 70);
  const measuredDb = latest.db || 0;
  if(!measuredDb){ alert("ยังไม่มีค่า dB จากไมโครโฟน"); return; }
  const off = refDb - measuredDb + Number($("dbOffset").value || 0);
  $("dbOffset").value = off.toFixed(1);
  updateCalibrationUI();
}
function fillBrowserInfo(){
  if($("browserName") && !$("browserName").value){
    const ua=navigator.userAgent;
    let name="Browser";
    if(ua.includes("Chrome")) name="Chrome";
    if(ua.includes("Safari") && !ua.includes("Chrome")) name="Safari";
    if(ua.includes("Firefox")) name="Firefox";
    if(ua.includes("Edg")) name="Edge";
    $("browserName").value=name;
  }
}

function toggleAutoLog(){if(autoLogId){clearInterval(autoLogId);autoLogId=null;$("autoLogBtn").textContent="เริ่ม Auto Log";}else{autoLogId=setInterval(capture,Math.max(.2,Number($("logInterval").value||1))*1000);$("autoLogBtn").textContent="หยุด Auto Log";}}
function applyPreset(){const p=$("preset").value;const map={general:[50,5000,.65],tone:[100,2000,.55],voice:[80,4000,.75],beat:[100,1200,.65],resonance:[50,3000,.60],doppler:[100,3000,.55],environment:[20,10000,.85]};const m=map[p]||map.general;$("minFreq").value=m[0];$("maxFreq").value=m[1];$("smoothing").value=m[2];}
function applyMode(){const modeEl=$("userMode"); if(!modeEl) return; document.querySelectorAll(".teacherSetting").forEach(e=>e.classList.toggle("hidden",modeEl.value==="student"));}
function renderColumnToggles(){const box=$("columnToggles");box.innerHTML="";Object.keys(colNames).forEach(k=>{const b=document.createElement("button");b.className="secondary active";b.textContent=colNames[k];b.onclick=()=>{if(exportCols.includes(k)){exportCols=exportCols.filter(x=>x!==k);b.classList.remove("active");}else{exportCols.push(k);b.classList.add("active");}renderLog();};box.appendChild(b);});}
function saveSettings(){const keys=["preset","userMode","minFreq","maxFreq","dbOffset","dbMode","fftSize","smoothing","logInterval","historyLength"];localStorage.setItem("physound-settings",JSON.stringify(Object.fromEntries(keys.filter(k=>$(k)).map(k=>[k,$(k).value]))));alert("บันทึก Settings แล้ว");}
function loadSettings(){try{const s=JSON.parse(localStorage.getItem("physound-settings")||"{}");Object.entries(s).forEach(([k,v])=>{if($(k))$(k).value=v;});}catch(e){}applyMode();}
function resetSettings(){localStorage.removeItem("physound-settings");location.reload();}
function copyConfig(){const keys=["preset","minFreq","maxFreq","dbOffset","dbMode","fftSize","smoothing"];const q=new URLSearchParams(Object.fromEntries(keys.filter(k=>$(k)).map(k=>[k,$(k).value]))).toString();navigator.clipboard?.writeText(location.origin+location.pathname+"#"+q);alert("คัดลอก Config Link แล้ว");}
function readConfig(){if(location.hash.length>1){const q=new URLSearchParams(location.hash.slice(1));q.forEach((v,k)=>{if($(k))$(k).value=v;});}}
function saveGraphs(){["scope","spectrum","spectrogram","history"].forEach(n=>{const c=canvases[n];if(!c)return;const a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=makeTopicFileName(n, "png");a.click();});}
let toneCtx,toneOsc,toneGain,noiseCtx,noiseSrc,noiseGain,beatCtx,beatOsc1,beatOsc2,beatGain;
function playTone(){stopTone();toneCtx=new (window.AudioContext||window.webkitAudioContext)();toneOsc=toneCtx.createOscillator();toneGain=toneCtx.createGain();toneOsc.type=$("toneType").value;toneOsc.frequency.value=Number($("toneFreq").value||440);toneGain.gain.value=Number($("toneVol").value||.06);toneOsc.connect(toneGain);toneGain.connect(toneCtx.destination);toneOsc.start();}
function stopTone(){if(toneCtx)toneCtx.close();toneCtx=toneOsc=toneGain=null;}
function playNoise(){stopNoise();noiseCtx=new (window.AudioContext||window.webkitAudioContext)();const size=noiseCtx.sampleRate*2,buf=noiseCtx.createBuffer(1,size,noiseCtx.sampleRate),data=buf.getChannelData(0);for(let i=0;i<size;i++)data[i]=Math.random()*2-1;noiseSrc=noiseCtx.createBufferSource();noiseSrc.buffer=buf;noiseSrc.loop=true;noiseGain=noiseCtx.createGain();noiseGain.gain.value=Number($("noiseVol").value||.03);noiseSrc.connect(noiseGain);noiseGain.connect(noiseCtx.destination);noiseSrc.start();}
function stopNoise(){if(noiseCtx)noiseCtx.close();noiseCtx=noiseSrc=noiseGain=null;}
function playBeat(){stopBeat();beatCtx=new (window.AudioContext||window.webkitAudioContext)();beatOsc1=beatCtx.createOscillator();beatOsc2=beatCtx.createOscillator();beatGain=beatCtx.createGain();beatOsc1.frequency.value=Number($("beatF1").value||440);beatOsc2.frequency.value=Number($("beatF2").value||444);beatGain.gain.value=Number($("beatVol").value||.06);beatOsc1.connect(beatGain);beatOsc2.connect(beatGain);beatGain.connect(beatCtx.destination);beatOsc1.start();beatOsc2.start();drawBeat();}
function stopBeat(){if(beatCtx)beatCtx.close();beatCtx=beatOsc1=beatOsc2=beatGain=null;}

let vizState = {mode:(window.__melodyLabVizMode||"longitudinal"), running:true, t:0, raf:null};
function getVizParams(){
  const f=Number($("vizFreq")?.value||440);
  const A=Number($("vizAmp")?.value||0.7);
  const v=Number($("vizSpeed")?.value||343);
  const speed=Number($("vizTimeSpeed")?.value||1);
  const phaseDeg=Number($("vizPhase")?.value||0);
  const phaseDiffDeg=Number($("vizPhaseDiff")?.value||90);
  const lambda=v/f;
  if($("vizFreqOut")) $("vizFreqOut").textContent=f.toFixed(0)+" Hz";
  if($("vizAmpOut")) $("vizAmpOut").textContent=A.toFixed(2);
  if($("vizSpeedOut")) $("vizSpeedOut").textContent=v.toFixed(0)+" m/s";
  if($("vizLambdaOut")) $("vizLambdaOut").textContent=lambda.toFixed(2)+" m";
  if($("vizFreqLabel")) $("vizFreqLabel").textContent=f.toFixed(0)+" Hz";
  if($("vizAmpLabel")) $("vizAmpLabel").textContent=A.toFixed(2);
  if($("vizSpeedLabel")) $("vizSpeedLabel").textContent=v.toFixed(0)+" m/s";
  if($("vizTimeLabel")) $("vizTimeLabel").textContent=speed.toFixed(1)+"×";
  if($("vizPhaseLabel")) $("vizPhaseLabel").textContent=phaseDeg.toFixed(0)+"°";
  if($("vizPhaseDiffLabel")) $("vizPhaseDiffLabel").textContent=phaseDiffDeg.toFixed(0)+"°";
  return {f,A,v,speed,lambda,sub:$("vizSubMode")?.value||"closed",phaseDeg,phase:phaseDeg*Math.PI/180,phaseDiffDeg,phaseDiff:phaseDiffDeg*Math.PI/180};
}
function vizGrid(ctx,c){
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle="#020617"; ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle="rgba(148,163,184,.12)"; ctx.lineWidth=1;
  for(let x=0;x<c.width;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}
  for(let y=0;y<c.height;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}
}
function drawWaveLine(ctx, points, color="#22d3ee", width=3){
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.beginPath();
  points.forEach((p,i)=>{ if(i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); });
  ctx.stroke();
}

function drawVizAxis(ctx,c,mode){
  ctx.save();
  ctx.fillStyle="#cfe9ff";
  ctx.strokeStyle="rgba(207,233,255,.72)";
  ctx.lineWidth=1.4;
  ctx.font="16px Sarabun, system-ui, sans-serif";

  function axis(x1,y1,x2,y2,label){
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    const ang=Math.atan2(y2-y1,x2-x1);
    const ah=9;
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-ah*Math.cos(ang-Math.PI/6), y2-ah*Math.sin(ang-Math.PI/6));
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-ah*Math.cos(ang+Math.PI/6), y2-ah*Math.sin(ang+Math.PI/6));
    ctx.stroke();
    ctx.fillText(label,x2+8,y2+5);
  }
  function yLabel(text,x,y){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(text,0,0);
    ctx.restore();
  }

  if(mode==="longitudinal"){
    axis(70,c.height-52,c.width-80,c.height-52,"position x (m)");
    yLabel("particle displacement s (relative)",28,c.height/2+90);
  }else if(mode==="pressure"){
    axis(70,c.height-52,c.width-80,c.height-52,"position x (m)");
    yLabel("pressure variation ΔP (relative)",28,c.height/2+100);
  }else if(mode==="displacementPressure"){
    axis(70,245,c.width-80,245,"position x (m)");
    yLabel("displacement s (relative)",28,165);
    axis(70,c.height-42,c.width-80,c.height-42,"position x (m)");
    yLabel("pressure ΔP (relative)",28,380);
  }else if(mode==="transverseCompare"){
    axis(70,235,c.width-80,235,"position x (m)");
    yLabel("longitudinal displacement (relative)",28,170);
    axis(70,c.height-42,c.width-80,c.height-42,"position x (m)");
    yLabel("transverse displacement y (relative)",28,380);
  }else if(mode==="superposition" || mode==="beatsViz"){
    axis(70,c.height-42,c.width-80,c.height-42,"time t (s)");
    yLabel("relative amplitude",28,c.height/2+80);
  }else if(mode==="standingAir"){
    axis(90,c.height-52,c.width-90,c.height-52,"position along air column x (m)");
    yLabel("displacement relative amplitude",28,c.height/2+95);
  }else if(mode==="resonanceViz"){
    axis(80,c.height-58,c.width-80,c.height-58,"frequency f (Hz)");
    yLabel("response relative amplitude",28,c.height/2+90);
  }else if(mode==="harmonicsViz"){
    axis(100,c.height-58,c.width-80,c.height-58,"harmonic number n");
    yLabel("relative relative amplitude",28,c.height/2+90);
  }else if(mode==="dopplerViz"){
    axis(70,c.height-52,c.width-80,c.height-52,"position x (m)");
    yLabel("wavefront spacing / pressure pattern",28,c.height/2+100);
  }
  ctx.restore();
}
function drawVizScale(ctx,c,mode){
  ctx.save();
  ctx.fillStyle="rgba(207,233,255,.82)";
  ctx.font="14px Sarabun, system-ui, sans-serif";
  if(["longitudinal","pressure","standingAir","dopplerViz"].includes(mode)){
    ctx.fillText("0",72,c.height-30);
    ctx.fillText("x",c.width-72,c.height-30);
  }
  if(["superposition","beatsViz"].includes(mode)){
    ctx.fillText("0 s",72,c.height-22);
    ctx.fillText("t",c.width-72,c.height-22);
  }
  if(mode==="resonanceViz"){
    ctx.fillText("100 Hz",80,c.height-28);
    ctx.fillText("1000 Hz",c.width-150,c.height-28);
  }
  if(mode==="harmonicsViz"){
    ctx.fillText("1f",128,c.height-28);
    ctx.fillText("7f",c.width-150,c.height-28);
  }
  ctx.restore();
}


function drawTrackedParticle(ctx,x,y,label=""){
  ctx.save();
  ctx.fillStyle="#ff4d6d";
  ctx.strokeStyle="#ffffff";
  ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill(); ctx.stroke();
  if(label){
    ctx.strokeStyle="rgba(255,77,109,.8)";
    ctx.beginPath(); ctx.moveTo(x+12,y-12); ctx.lineTo(x+54,y-32); ctx.stroke();
    ctx.fillStyle="#ffd6de";
    ctx.font="15px Sarabun, system-ui, sans-serif";
    ctx.fillText(label,x+58,y-34);
  }
  ctx.restore();
}
function drawTrackedVertical(ctx,x,y1,y2){
  ctx.save();
  ctx.strokeStyle="rgba(255,77,109,.55)";
  ctx.setLineDash([6,6]);
  ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(x,y1); ctx.lineTo(x,y2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
function drawLongitudinalAnnotations(ctx, x0, x, yBase){
  ctx.save();
  const centerY = yBase - 84;
  ctx.lineWidth = 1.8;

  // wave propagation arrow (top-left)
  ctx.strokeStyle = "rgba(56,189,248,.96)";
  ctx.beginPath();
  ctx.moveTo(96, 86);
  ctx.lineTo(220, 86);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(220, 86);
  ctx.lineTo(208, 79);
  ctx.moveTo(220, 86);
  ctx.lineTo(208, 93);
  ctx.stroke();

  // particle vibration double-arrow near tracked particle
  ctx.strokeStyle = "rgba(251,191,36,.98)";
  ctx.beginPath();
  ctx.moveTo(x0-30, yBase+56);
  ctx.lineTo(x0+30, yBase+56);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0-30, yBase+56);
  ctx.lineTo(x0-20, yBase+50);
  ctx.moveTo(x0-30, yBase+56);
  ctx.lineTo(x0-20, yBase+62);
  ctx.moveTo(x0+30, yBase+56);
  ctx.lineTo(x0+20, yBase+50);
  ctx.moveTo(x0+30, yBase+56);
  ctx.lineTo(x0+20, yBase+62);
  ctx.stroke();

  // amplitude marker from equilibrium to current displacement
  ctx.strokeStyle = "rgba(167,139,250,.96)";
  ctx.setLineDash([5,4]);
  ctx.beginPath();
  ctx.moveTo(x0, centerY);
  ctx.lineTo(x, centerY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x0, centerY-8);
  ctx.lineTo(x0, centerY+8);
  ctx.moveTo(x, centerY-8);
  ctx.lineTo(x, centerY+8);
  ctx.stroke();
  ctx.fillStyle = "#ddd6fe";
  ctx.font = "bold 16px Sarabun, system-ui, sans-serif";
  ctx.fillText("A", ((x0 + x) / 2) - 5, centerY - 10);
  ctx.restore();
}


function drawParticleSphere(ctx,x,y,r,scheme="cyan"){
  ctx.save();
  ctx.shadowColor = scheme === "red" ? "rgba(255,76,132,.28)" : "rgba(34,211,238,.22)";
  ctx.shadowBlur = r * 1.2;
  ctx.shadowOffsetY = r * 0.22;

  const fill = ctx.createRadialGradient(x-r*0.42,y-r*0.48,r*0.18,x,y,r*1.02);
  if(scheme === "red"){
    fill.addColorStop(0,"#fff7fb");
    fill.addColorStop(0.28,"#ffb5cf");
    fill.addColorStop(0.58,"#ff5b98");
    fill.addColorStop(0.82,"#e83074");
    fill.addColorStop(1,"#9f124f");
  }else{
    fill.addColorStop(0,"#fbfeff");
    fill.addColorStop(0.26,"#bff7ff");
    fill.addColorStop(0.56,"#54d7ff");
    fill.addColorStop(0.84,"#1697ff");
    fill.addColorStop(1,"#0b4dbd");
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fill();

  const gloss = ctx.createRadialGradient(x-r*0.45,y-r*0.52,0,x-r*0.35,y-r*0.42,r*0.72);
  gloss.addColorStop(0,"rgba(255,255,255,.92)");
  gloss.addColorStop(0.42,"rgba(255,255,255,.35)");
  gloss.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(x-r*0.18,y-r*0.18,r*0.56,0,Math.PI*2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,.24)";
  ctx.lineWidth = Math.max(1, r*0.13);
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawParticleShadow(ctx,x,y,r){
  ctx.save();
  const shadow = ctx.createRadialGradient(x,y+r*0.9,r*0.1,x,y+r*0.9,r*1.2);
  shadow.addColorStop(0,"rgba(2,8,23,.32)");
  shadow.addColorStop(1,"rgba(2,8,23,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x,y+r*0.95,r*0.95,r*0.35,0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawSpeaker(ctx, x, y, scale){
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(scale,scale);

  // Sound-wave rings
  for(let i=0;i<4;i++){
    ctx.beginPath();
    ctx.strokeStyle = `rgba(35,160,255,${0.46 - i*0.075})`;
    ctx.lineWidth = 3.2 - i*0.42;
    ctx.arc(14,0,38+i*18,-0.82,0.82);
    ctx.stroke();
  }

  // Back plate
  const plate = ctx.createLinearGradient(-76,-76,-18,76);
  plate.addColorStop(0,"#2d3d53");
  plate.addColorStop(.45,"#0b1728");
  plate.addColorStop(1,"#030816");
  ctx.fillStyle = plate;
  ctx.strokeStyle = "rgba(34,211,238,.55)";
  ctx.lineWidth = 1.6;
  roundRect(ctx,-88,-76,54,152,16);
  ctx.fill();
  ctx.stroke();

  // Main outer rim
  const outer = ctx.createRadialGradient(-30,-18,8,-30,0,62);
  outer.addColorStop(0,"#d9fbff");
  outer.addColorStop(.18,"#1ee8ff");
  outer.addColorStop(.42,"#1368ff");
  outer.addColorStop(.70,"#07142a");
  outer.addColorStop(1,"#020617");
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.ellipse(-28,0,52,64,0,0,Math.PI*2);
  ctx.fill();

  ctx.strokeStyle="rgba(177,245,255,.78)";
  ctx.lineWidth=2.2;
  ctx.beginPath();
  ctx.ellipse(-28,0,52,64,0,0,Math.PI*2);
  ctx.stroke();

  // Inner cone
  const cone = ctx.createRadialGradient(-32,-16,4,-28,0,46);
  cone.addColorStop(0,"#bff6ff");
  cone.addColorStop(.28,"#21b8ff");
  cone.addColorStop(.62,"#08265d");
  cone.addColorStop(1,"#01040c");
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.ellipse(-28,0,34,45,0,0,Math.PI*2);
  ctx.fill();

  // Central dome
  const dome = ctx.createRadialGradient(-36,-12,4,-28,0,22);
  dome.addColorStop(0,"#d7fbff");
  dome.addColorStop(.42,"#139dff");
  dome.addColorStop(1,"#020617");
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.ellipse(-28,0,17,23,0,0,Math.PI*2);
  ctx.fill();

  // Neon highlight ring
  ctx.strokeStyle="rgba(34,211,238,.95)";
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.ellipse(-28,0,42,54,0,0,Math.PI*2);
  ctx.stroke();

  ctx.restore();
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
}

function drawLongitudinalFinal(ctx, c, p, w, h){
  ctx.clearRect(0,0,w,h);

  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#020817");
  bg.addColorStop(1,"#06152e");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle="rgba(148,163,184,.10)";
  ctx.lineWidth=1;
  for(let x=0;x<w;x+=78){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=52){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const xMin = Math.max(118, w * 0.12);
  const xMax = w - 62;
  const titleY = 32;
  const arrowY = 68;
  const topY = 96;
  const bottomMargin = 34;
  const graphBottom = h - bottomMargin;
  const fieldTop = topY;
  const fieldH = Math.max(190, Math.min(h * 0.54, graphBottom - fieldTop - 92));
  const airTop = fieldTop + 44;
  const airBottom = airTop + fieldH;
  const graphY = Math.min(graphBottom - 38, airBottom + 56);
  const rows = 7;
  const cols = Math.max(20, Math.floor((xMax-xMin) / 34));
  const rowGap = fieldH / Math.max(1, rows - 1);
  const colGap = (xMax-xMin) / Math.max(1, cols - 1);
  const baseRadius = Math.max(4.6, Math.min(7.8, colGap * 0.16));
  const ampPx = Math.max(12, Math.min(34, colGap * 0.48)) * p.A;

  // v5.90: frequency and wave speed set the visual wavelength through λ = v/f.
  const referenceLambda = 343 / 440;
  const wavelengthPx = Math.max(150, Math.min(620, (p.lambda / referenceLambda) * 300));
  const k = 2 * Math.PI / wavelengthPx;
  const phase = vizState.t * 0.105 * p.speed;
  const displacementAt = (x)=> ampPx * Math.sin(k*(x-xMin) - phase);

  ctx.fillStyle="#d8efff";
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("Longitudinal Wave (คลื่นตามยาว)", 24, titleY);

  ctx.save();
  ctx.strokeStyle="rgba(34,211,238,.96)";
  ctx.fillStyle="rgba(34,211,238,.96)";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(w*0.31, arrowY);
  ctx.lineTo(w*0.82, arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w*0.82, arrowY);
  ctx.lineTo(w*0.795, arrowY-14);
  ctx.lineTo(w*0.795, arrowY+14);
  ctx.closePath();
  ctx.fill();
  ctx.font="bold 16px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ทิศทางการเคลื่อนที่ของคลื่น", w*0.56, arrowY-16);
  ctx.restore();

  ctx.save();
  const panelGrad = ctx.createLinearGradient(xMin-36, fieldTop, xMax+36, airBottom+28);
  panelGrad.addColorStop(0,"rgba(4,18,42,.76)");
  panelGrad.addColorStop(1,"rgba(2,8,24,.36)");
  ctx.fillStyle=panelGrad;
  ctx.strokeStyle="rgba(88,166,255,.25)";
  ctx.lineWidth=1.4;
  roundRect(ctx, xMin-42, fieldTop, xMax-xMin+84, airBottom-fieldTop+34, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const yBandTop = airTop - 28;
  const yBandH = (rows-1)*rowGap + 56;
  for(let x=xMin; x<xMax; x+=12){
    const density = -Math.cos(k*(x-xMin)-phase);
    if(density > 0.50 || density < -0.50){
      const alpha = Math.min(0.22, 0.08 + Math.abs(density) * 0.12);
      const color = density > 0 ? `rgba(34,211,238,${alpha})` : `rgba(168,85,247,${alpha})`;
      const g = ctx.createLinearGradient(x-28,0,x+28,0);
      g.addColorStop(0,"rgba(0,0,0,0)");
      g.addColorStop(.5,color);
      g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g;
      ctx.fillRect(x-28,yBandTop,56,yBandH);
    }
  }

  function wrapToRange(x){
    while(x < xMin + 60) x += wavelengthPx;
    while(x > xMax - 60) x -= wavelengthPx;
    return x;
  }
  const compX = wrapToRange(xMin + ((((phase + Math.PI) / k) % wavelengthPx) + wavelengthPx) % wavelengthPx);
  const rareX = wrapToRange(xMin + (((phase / k) % wavelengthPx) + wavelengthPx) % wavelengthPx);

  function drawSmallPill(cx, cy, text, stroke, fill){
    ctx.save();
    ctx.font="bold 13px Sarabun, system-ui, sans-serif";
    ctx.textAlign="center";
    const tw = ctx.measureText(text).width;
    const bw = tw + 26;
    ctx.fillStyle=fill;
    ctx.strokeStyle=stroke;
    ctx.lineWidth=1.4;
    roundRect(ctx, cx-bw/2, cy-15, bw, 30, 12);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle="rgba(245,248,255,.96)";
    ctx.fillText(text, cx, cy+5);
    ctx.restore();
  }
  drawSmallPill(compX, fieldTop + 18, "ส่วนอัด", "rgba(34,211,238,.55)", "rgba(8,30,62,.80)");
  drawSmallPill(rareX, airBottom + 18, "ส่วนขยาย", "rgba(168,85,247,.55)", "rgba(23,16,55,.78)");

  const speakerX = Math.max(48, xMin - 88);
  const speakerY = airTop + (rows-1)*rowGap/2;
  drawSpeaker(ctx, speakerX, speakerY, 1.05);

  const obsCol = Math.floor(cols * 0.54);
  const obsRow = Math.floor(rows/2);
  let obsBaseX = xMin + obsCol * colGap;
  let obsActualX = obsBaseX + displacementAt(obsBaseX);
  let obsY = airTop + obsRow * rowGap;

  ctx.save();
  for(let r=0; r<rows; r++){
    const y = airTop + r * rowGap;
    for(let i=0; i<cols; i++){
      const baseX = xMin + i * colGap;
      const offset = displacementAt(baseX);
      const x = baseX + offset;
      const density = Math.max(0, Math.min(1, (1 - Math.cos(k*(baseX-xMin)-phase)) / 2));
      const radius = baseRadius * (0.92 + density * 0.32);

      ctx.beginPath();
      ctx.fillStyle="rgba(148,163,184,.22)";
      ctx.arc(baseX, y, Math.max(2.0, baseRadius*0.34), 0, Math.PI*2);
      ctx.fill();

      if(i % 3 === 0 && r === obsRow){
        ctx.strokeStyle="rgba(148,163,184,.20)";
        ctx.lineWidth=1;
        ctx.beginPath();
        ctx.moveTo(baseX, y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      const grad=ctx.createRadialGradient(x-2,y-2,1,x,y,radius*2.8);
      grad.addColorStop(0,"rgba(255,255,255,.98)");
      grad.addColorStop(.40,"rgba(125,230,255,.92)");
      grad.addColorStop(1,"rgba(34,211,238,.18)");
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle="rgba(255,77,109,.72)";
  ctx.setLineDash([8,8]);
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(obsBaseX, fieldTop+4);
  ctx.lineTo(obsBaseX, graphY+10);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTrackedParticle(ctx, obsActualX, obsY, "");

  ctx.save();
  ctx.strokeStyle="rgba(255,224,102,.95)";
  ctx.fillStyle="rgba(255,224,102,.95)";
  ctx.lineWidth=2.2;
  const arrY = obsY + Math.min(36, rowGap*0.52);
  ctx.beginPath();
  ctx.moveTo(obsBaseX-ampPx, arrY);
  ctx.lineTo(obsBaseX+ampPx, arrY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(obsBaseX-ampPx, arrY);
  ctx.lineTo(obsBaseX-ampPx+9, arrY-5);
  ctx.moveTo(obsBaseX-ampPx, arrY);
  ctx.lineTo(obsBaseX-ampPx+9, arrY+5);
  ctx.moveTo(obsBaseX+ampPx, arrY);
  ctx.lineTo(obsBaseX+ampPx-9, arrY-5);
  ctx.moveTo(obsBaseX+ampPx, arrY);
  ctx.lineTo(obsBaseX+ampPx-9, arrY+5);
  ctx.stroke();
  ctx.font="12px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("การสั่นของอนุภาค", obsBaseX, arrY+18);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.25)";
  ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(xMin, graphY); ctx.lineTo(xMax, graphY); ctx.stroke();
  ctx.fillStyle="rgba(207,233,255,.78)";
  ctx.font="13px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ตำแหน่ง x", (xMin+xMax)/2, graphY+28);
  ctx.save();
  ctx.translate(xMin-54, graphY);
  ctx.rotate(-Math.PI/2);
  ctx.fillText("การกระจัด s", 0, 0);
  ctx.restore();

  const graphAmp = Math.min(42, Math.max(24, h * 0.075)) * p.A;
  const pts=[];
  for(let x=xMin; x<=xMax; x++){
    const y = graphY - graphAmp * Math.sin(k*(x-xMin)-phase);
    pts.push([x,y]);
  }
  drawWaveLine(ctx, pts, "#22d3ee", 3.2);
  const obsGraphY = graphY - graphAmp * Math.sin(k*(obsBaseX-xMin)-phase);
  drawTrackedParticle(ctx, obsBaseX, obsGraphY, "");
  ctx.restore();

  ctx.save();
  ctx.font="12px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  const lx = xMin;
  const ly = h - 12;
  ctx.fillStyle="rgba(148,163,184,.92)";
  ctx.beginPath(); ctx.arc(lx, ly-5, 3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(210,225,240,.88)";
  ctx.fillText("ตำแหน่งสมดุล", lx+10, ly);
  ctx.fillStyle="rgba(125,230,255,.92)";
  ctx.beginPath(); ctx.arc(lx+122, ly-5, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(210,225,240,.88)";
  ctx.fillText("ตำแหน่งจริงของอนุภาค", lx+134, ly);
  ctx.restore();
}

function drawDisplacementPressureFinal(ctx, c, p, w, h){
  ctx.clearRect(0,0,w,h);

  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#020817");
  bg.addColorStop(1,"#081532");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle="rgba(148,163,184,.10)";
  ctx.lineWidth=1;
  for(let x=0;x<w;x+=78){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=52){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const xMin = Math.max(110, w * 0.11);
  const xMax = w - 72;
  const obsX = w * 0.57;

  // v5.88: frequency and wave speed affect wavelength, while the graphs now fill the full vertical slot.
  // Reference: at 440 Hz and 343 m/s, wavelengthPx is about 270 px.
  const referenceLambda = 343 / 440;
  const wavelengthPx = Math.max(125, Math.min(560, (p.lambda / referenceLambda) * 270));
  const k = 2 * Math.PI / wavelengthPx;
  const phase = vizState.t * 0.105 * p.speed - p.phase;
  const phaseDiff = p.phaseDiff ?? Math.PI/2;
  const phaseDiffDeg = Math.round(p.phaseDiffDeg ?? 90);
  const phaseDistancePx = wavelengthPx * (phaseDiffDeg / 360);

  // v5.88: make both graphs consume the available vertical slot on mobile.
  const titleY = 32;
  const arrowY = 70;
  const topStartY = 94;
  const bottomMargin = 10;
  const gap = Math.max(32, Math.min(44, h * 0.055));
  const availableGraphH = Math.max(220, h - topStartY - bottomMargin - gap);
  const graphH = Math.max(108, availableGraphH / 2);
  const topCard = {x:xMin-24, y:topStartY, w:xMax-xMin+48, h:graphH};
  const bottomCard = {x:xMin-24, y:topCard.y + topCard.h + gap, w:xMax-xMin+48, h:graphH};
  const topMid = topCard.y + topCard.h/2;
  const bottomMid = bottomCard.y + bottomCard.h/2;
  const ampPx = Math.max(34, topCard.h * 0.36) * p.A;
  const pressureAmpPx = Math.max(34, bottomCard.h * 0.36) * p.A;

  ctx.fillStyle="#cfe9ff";
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("Displacement and Pressure (คลื่นการกระจัดและคลื่นความดัน)", 24, titleY);

  ctx.save();
  ctx.strokeStyle="rgba(34,211,238,.96)";
  ctx.fillStyle="rgba(34,211,238,.96)";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(w*0.29,arrowY);
  ctx.lineTo(w*0.82,arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w*0.82,arrowY);
  ctx.lineTo(w*0.795,arrowY-14);
  ctx.lineTo(w*0.795,arrowY+14);
  ctx.closePath();
  ctx.fill();
  ctx.font="bold 17px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ทิศทางการเคลื่อนที่ของคลื่น", w*0.555, arrowY-16);
  ctx.restore();

  function drawPanel(card, strokeCol){
    ctx.save();
    const grad = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.h);
    grad.addColorStop(0,"rgba(4,18,42,.78)");
    grad.addColorStop(1,"rgba(2,8,24,.38)");
    ctx.fillStyle = grad;
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.5;
    roundRect(ctx, card.x, card.y, card.w, card.h, 18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  drawPanel(topCard, "rgba(95,185,255,.28)");
  drawPanel(bottomCard, "rgba(255,190,92,.28)");

  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.18)";
  ctx.setLineDash([6,6]);
  ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(xMin, topMid); ctx.lineTo(xMax, topMid); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(xMin, bottomMid); ctx.lineTo(xMax, bottomMid); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle="rgba(255,77,109,.62)";
  ctx.setLineDash([8,8]);
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(obsX, topCard.y-8);
  ctx.lineTo(obsX, bottomCard.y+bottomCard.h+8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const displacementAt = (x)=> Math.sin(k*(x-obsX)-phase);
  const pressureAt = (x)=> Math.sin(k*(x-obsX)-phase + phaseDiff);

  const topPts=[], bottomPts=[];
  for(let x=xMin; x<=xMax; x++){
    topPts.push([x, topMid - displacementAt(x) * ampPx]);
    bottomPts.push([x, bottomMid - pressureAt(x) * pressureAmpPx]);
  }

  drawWaveLine(ctx, topPts, "#22d3ee", 3.5);
  drawWaveLine(ctx, bottomPts, "#fbbf24", 3.5);

  ctx.save();
  ctx.textAlign="left";
  ctx.font="bold 16px Sarabun, system-ui, sans-serif";
  ctx.fillStyle="rgba(208,247,255,.95)";
  ctx.fillText("การกระจัด s", xMin, topCard.y - 16);
  ctx.fillStyle="rgba(255,234,179,.96)";
  ctx.fillText("ความดัน ΔP", xMin, bottomCard.y - 16);
  ctx.restore();

  function drawXAxis(y){
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,.22)";
    ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(xMin, y); ctx.lineTo(xMax, y); ctx.stroke();
    const ticks = 12;
    for(let i=0;i<ticks;i++){
      const tx = xMin + i * (xMax-xMin) / (ticks-1);
      ctx.beginPath(); ctx.moveTo(tx, y-6); ctx.lineTo(tx, y+6); ctx.stroke();
    }
    ctx.restore();
  }
  drawXAxis(topCard.y + topCard.h + 4);
  drawXAxis(bottomCard.y + bottomCard.h + 4);

  ctx.save();
  ctx.fillStyle="rgba(207,233,255,.78)";
  ctx.font="14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.save(); ctx.translate(xMin-58, topMid); ctx.rotate(-Math.PI/2); ctx.fillText("การกระจัด s (สัมพัทธ์)", 0, 0); ctx.restore();
  ctx.save(); ctx.translate(xMin-58, bottomMid); ctx.rotate(-Math.PI/2); ctx.fillText("ความดัน ΔP (สัมพัทธ์)", 0, 0); ctx.restore();
  ctx.fillText("ตำแหน่ง x", w*0.53, topCard.y + topCard.h + 20);
  ctx.fillText("ตำแหน่ง x", w*0.53, bottomCard.y + bottomCard.h + 22);
  ctx.restore();

  ctx.save();
  ctx.font="bold 14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="right";
  const phaseBadgeW = 270;
  const phaseBadgeH = 28;
  const phaseBadgeX = xMax - phaseBadgeW;
  const phaseBadgeY = topCard.y + 10; // v5.89: move below the blue direction arrow, inside graph panel
  ctx.fillStyle="rgba(15,34,66,.88)";
  ctx.strokeStyle="rgba(147,197,253,.40)";
  roundRect(ctx, phaseBadgeX, phaseBadgeY, phaseBadgeW, phaseBadgeH, 12);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle="rgba(235,246,255,.96)";
  ctx.fillText(`Phase Difference: Δφ = ${phaseDiffDeg}°`, phaseBadgeX + phaseBadgeW - 14, phaseBadgeY + 19);
  ctx.restore();

  const phaseX1 = obsX;
  const phaseX2 = Math.min(xMax-10, obsX + phaseDistancePx);
  const phaseY = topCard.y + topCard.h + Math.min(26, gap - 8);
  if(phaseX2 - phaseX1 > 24 && phaseY < bottomCard.y - 8){
    ctx.save();
    ctx.strokeStyle="rgba(196,181,253,.94)";
    ctx.fillStyle="rgba(220,210,255,.96)";
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(phaseX1, phaseY); ctx.lineTo(phaseX2, phaseY); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(phaseX1, phaseY);
    ctx.lineTo(phaseX1+10, phaseY-6);
    ctx.moveTo(phaseX1, phaseY);
    ctx.lineTo(phaseX1+10, phaseY+6);
    ctx.moveTo(phaseX2, phaseY);
    ctx.lineTo(phaseX2-10, phaseY-6);
    ctx.moveTo(phaseX2, phaseY);
    ctx.lineTo(phaseX2-10, phaseY+6);
    ctx.stroke();
    ctx.font="13px Sarabun, system-ui, sans-serif";
    ctx.textAlign="center";
    const frac = phaseDiffDeg===90 ? "λ/4" : `${phaseDiffDeg}/360 λ`;
    ctx.fillText(`${phaseDiffDeg}° ≈ ${frac}`, (phaseX1+phaseX2)/2, phaseY+17);
    ctx.restore();
  }

  const topY = topMid - displacementAt(obsX) * ampPx;
  const bottomY = bottomMid - pressureAt(obsX) * pressureAmpPx;
  drawTrackedParticle(ctx, obsX, topY, "");
  drawTrackedParticle(ctx, obsX, bottomY, "");

  ctx.save();
  ctx.fillStyle="rgba(255,255,255,.86)";
  ctx.font="14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="right";
  ctx.fillText("จุดสังเกต", obsX - 12, topCard.y + 16);
  ctx.restore();
}

function drawPressureWaveFinal(ctx, c, p, w, h){
  ctx.clearRect(0,0,w,h);

  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#020817");
  bg.addColorStop(1,"#081532");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,w,h);

  // Background grid
  ctx.strokeStyle="rgba(148,163,184,.10)";
  ctx.lineWidth=1;
  for(let x=0;x<w;x+=78){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let y=0;y<h;y+=52){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  const xMin = Math.max(158, w * 0.155);
  const xMax = w - 76;
  const obsXBase = w * 0.555;        // fixed observation position
  const phase = vizState.t * 0.105 * p.speed;
  const wavelengthPx = 270;
  const k = 2 * Math.PI / wavelengthPx;

  const titleY = 34;
  const arrowY = 78;
  const particleTop = 116;
  const particleAxisY = Math.round(h * 0.52);
  const particleBottom = particleAxisY - 24;
  const curveTop = particleAxisY + 72;
  const curveBottom = h - 52;
  const curveMid = (curveTop + curveBottom) / 2;
  const curveAmp = Math.max(42, (curveBottom - curveTop) * 0.40);

  const speakerX = Math.max(66, xMin - 94);
  const speakerY = (particleTop + particleBottom) / 2;
  drawSpeaker(ctx, speakerX, speakerY, 1.12);

  ctx.fillStyle="#cfe9ff";
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("Pressure Wave (คลื่นความดัน)", 24, titleY);

  // Direction arrow
  ctx.save();
  ctx.strokeStyle="rgba(34,211,238,.96)";
  ctx.fillStyle="rgba(34,211,238,.96)";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(w*0.32,arrowY);
  ctx.lineTo(w*0.82,arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w*0.82,arrowY);
  ctx.lineTo(w*0.795,arrowY-14);
  ctx.lineTo(w*0.795,arrowY+14);
  ctx.closePath();
  ctx.fill();
  ctx.font="bold 17px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ทิศทางการเคลื่อนที่ของคลื่น", w*0.57, arrowY-16);
  ctx.restore();

  // Same physical model for pressure and particles.
  // ΔP(x,t) ∝ cos(kx - ωt)
  // particle displacement u(x,t) ∝ -sin(kx - ωt)
  const pressureAt = (x)=>Math.cos(k*(x-obsXBase)-phase);
  const displacementAt = (x)=>-9.5 * p.A * Math.sin(k*(x-obsXBase)-phase);

  // Particle field frame
  ctx.save();
  const fieldX0 = xMin-24;
  const fieldY0 = particleTop-18;
  const fieldW = xMax - xMin + 48;
  const fieldH = particleBottom - particleTop + 36;
  const fieldGrad = ctx.createLinearGradient(fieldX0, fieldY0, fieldX0, fieldY0+fieldH);
  fieldGrad.addColorStop(0,"rgba(4,18,42,.78)");
  fieldGrad.addColorStop(1,"rgba(2,8,24,.28)");
  ctx.fillStyle = fieldGrad;
  ctx.strokeStyle = "rgba(95,185,255,.28)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, fieldX0, fieldY0, fieldW, fieldH, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Pressure glow bands
  ctx.save();
  for(let x=xMin; x<=xMax; x+=6){
    const pr = pressureAt(x);
    const alpha = Math.abs(pr);
    const g = ctx.createLinearGradient(x-18,0,x+18,0);
    if(pr >= 0){
      g.addColorStop(0,"rgba(0,0,0,0)");
      g.addColorStop(.5,`rgba(34,211,238,${0.06 + 0.18*alpha})`);
      g.addColorStop(1,"rgba(0,0,0,0)");
    }else{
      g.addColorStop(0,"rgba(0,0,0,0)");
      g.addColorStop(.5,`rgba(168,85,247,${0.05 + 0.15*alpha})`);
      g.addColorStop(1,"rgba(0,0,0,0)");
    }
    ctx.fillStyle=g;
    ctx.fillRect(x-18, particleTop-14, 36, particleBottom-particleTop+28);
  }
  ctx.restore();

  // Natural particle cloud
  const particleHeight = particleBottom - particleTop;
  const densityXGap = Math.max(12, Math.min(17, w * 0.014));
  const densityYGap = Math.max(10, Math.min(14, particleHeight / 10));
  const particleR = Math.max(3.4, Math.min(5.0, w * 0.0048));
  const obsParticleY = (particleTop + particleBottom) / 2;

  function pseudoRand(a,b){
    return Math.abs(Math.sin(a*12.9898 + b*78.233) * 43758.5453) % 1;
  }
  function drawVisibleParticle(x,y,r,pr){
    const hot = pr >= 0;
    ctx.save();
    ctx.shadowColor = hot ? "rgba(76,210,255,.72)" : "rgba(170,110,255,.48)";
    ctx.shadowBlur = hot ? 8 : 6;
    const grad=ctx.createRadialGradient(x-r*.35,y-r*.45,r*.15,x,y,r);
    if(hot){
      grad.addColorStop(0,"rgba(255,255,255,.98)");
      grad.addColorStop(.45,"rgba(140,238,255,.96)");
      grad.addColorStop(1,"rgba(22,150,255,.86)");
    }else{
      grad.addColorStop(0,"rgba(235,250,255,.94)");
      grad.addColorStop(.55,"rgba(120,220,255,.80)");
      grad.addColorStop(1,"rgba(46,125,225,.62)");
    }
    ctx.fillStyle=grad;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  for(let yy=particleTop+10, row=0; yy<=particleBottom-8; yy+=densityYGap, row++){
    for(let base=xMin+10, col=0; base<=xMax-8; base+=densityXGap, col++){
      const pr = pressureAt(base);
      const keepProbability = 0.72 + 0.22 * ((pr + 1) / 2);
      if(pseudoRand(col,row) > keepProbability) continue;

      const x = base + displacementAt(base) + (pseudoRand(col+91,row+7)-0.5) * densityXGap * 0.70;
      const y = yy + (pseudoRand(col+17,row+83)-0.5) * densityYGap * 0.70;

      // Leave room for red observed particle
      if(Math.abs(x-obsXBase) < 8 && Math.abs(y-obsParticleY) < 11) continue;

      const localR = particleR * (0.92 + 0.22 * ((pr + 1) / 2)) * (0.88 + pseudoRand(col+3,row+11)*0.28);
      drawVisibleParticle(x,y,localR,pr);
    }
  }

  // Fixed observation line: this is the x-position used by the pressure graph marker.
  ctx.save();
  ctx.strokeStyle="rgba(255,83,128,.92)";
  ctx.setLineDash([8,8]);
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(obsXBase, particleTop - 20);
  ctx.lineTo(obsXBase, curveBottom + 4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle="rgba(255,230,235,.98)";
  ctx.font="15px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("จุดสังเกต", obsXBase, particleTop-26);
  ctx.restore();

  // Red observed particle: moves left-right around the fixed observation position.
  const redParticleX = obsXBase + displacementAt(obsXBase);
  ctx.save();
  ctx.strokeStyle="rgba(255,190,210,.90)";
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.moveTo(obsXBase, obsParticleY);
  ctx.lineTo(redParticleX, obsParticleY);
  ctx.stroke();
  const dir = redParticleX >= obsXBase ? 1 : -1;
  ctx.fillStyle="rgba(255,190,210,.95)";
  ctx.beginPath();
  ctx.moveTo(redParticleX, obsParticleY);
  ctx.lineTo(redParticleX - dir*13, obsParticleY - 7);
  ctx.lineTo(redParticleX - dir*13, obsParticleY + 7);
  ctx.closePath();
  ctx.fill();
  drawParticleShadow(ctx,redParticleX,obsParticleY,8.5);
  drawParticleSphere(ctx,redParticleX,obsParticleY,8.5,"red");
  ctx.restore();

  // Labels
  ctx.save();
  ctx.font="bold 14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  const labelY = particleTop - 4;
  const compressionText = "ส่วนอัด (Compression)";
  const rarefactionText = "ส่วนขยาย (Rarefaction)";
  let compressionX = obsXBase - wavelengthPx * 0.22;
  let rarefactionX = obsXBase + wavelengthPx * 0.62;

  const compressionW = ctx.measureText(compressionText).width;
  const rarefactionW = ctx.measureText(rarefactionText).width;
  const minGap = 28;

  compressionX = Math.max(xMin + compressionW/2 + 10, compressionX);
  rarefactionX = Math.min(xMax - rarefactionW/2 - 10, rarefactionX);

  if(compressionX + compressionW/2 + minGap > rarefactionX - rarefactionW/2){
    const mid = (compressionX + rarefactionX) / 2;
    compressionX = mid - (compressionW/2 + minGap/2);
    rarefactionX = mid + (rarefactionW/2 + minGap/2);
    compressionX = Math.max(xMin + compressionW/2 + 10, compressionX);
    rarefactionX = Math.min(xMax - rarefactionW/2 - 10, rarefactionX);
  }

  function drawLabelPill(cx, text, fill, stroke, textColor){
    const tw = ctx.measureText(text).width;
    const pillW = tw + 18;
    const pillH = 24;
    const px = cx - pillW/2;
    const py = labelY - 17;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    roundRect(ctx, px, py, pillW, pillH, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, py + pillH/2 + 1);
    ctx.restore();
  }

  drawLabelPill(compressionX, compressionText, "rgba(18,70,92,.70)", "rgba(80,235,255,.45)", "rgba(80,235,255,.98)");
  drawLabelPill(rarefactionX, rarefactionText, "rgba(70,34,92,.72)", "rgba(220,150,255,.42)", "rgba(220,150,255,.98)");
  ctx.restore();

  // x-axis under particle graph
  ctx.save();
  ctx.strokeStyle="rgba(255,245,220,.94)";
  ctx.fillStyle="rgba(255,255,255,.94)";
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(xMin-34, particleAxisY);
  ctx.lineTo(w-46, particleAxisY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w-46, particleAxisY);
  ctx.lineTo(w-61, particleAxisY-9);
  ctx.moveTo(w-46, particleAxisY);
  ctx.lineTo(w-61, particleAxisY+9);
  ctx.stroke();
  for(let i=0;i<7;i++){
    const tx=(xMin-30)+i*((w-xMin-50)/(6));
    ctx.beginPath();
    ctx.moveTo(tx,particleAxisY-10);
    ctx.lineTo(tx,particleAxisY+10);
    ctx.stroke();
  }
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.fillText("x", w-36, particleAxisY+28);
  ctx.restore();

  // Lower pressure graph axes
  ctx.save();
  ctx.strokeStyle="rgba(255,245,220,.96)";
  ctx.fillStyle="rgba(255,255,255,.96)";
  ctx.lineWidth=2;

  ctx.beginPath();
  ctx.moveTo(xMin-34, curveMid);
  ctx.lineTo(w-46, curveMid);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w-46, curveMid);
  ctx.lineTo(w-61, curveMid-9);
  ctx.moveTo(w-46, curveMid);
  ctx.lineTo(w-61, curveMid+9);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(xMin-34, curveBottom);
  ctx.lineTo(xMin-34, curveTop);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(xMin-34, curveTop);
  ctx.lineTo(xMin-43, curveTop+15);
  ctx.moveTo(xMin-34, curveTop);
  ctx.lineTo(xMin-25, curveTop+15);
  ctx.stroke();

  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.62)";
  ctx.setLineDash([6,7]);
  ctx.beginPath();
  ctx.moveTo(xMin-34, curveMid);
  ctx.lineTo(w-58, curveMid);
  ctx.stroke();
  ctx.restore();

  for(let i=0;i<7;i++){
    const tx=(xMin-30)+i*((w-xMin-50)/(6));
    ctx.beginPath();
    ctx.moveTo(tx,curveMid-8);
    ctx.lineTo(tx,curveMid+8);
    ctx.stroke();
  }
  for(let j=-1;j<=1;j++){
    const ty = curveMid - j*curveAmp;
    ctx.beginPath();
    ctx.moveTo(xMin-43,ty);
    ctx.lineTo(xMin-25,ty);
    ctx.stroke();
  }

  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.fillText("x", w-36, curveMid+28);

  ctx.save();
  ctx.translate(xMin-78, curveMid);
  ctx.rotate(-Math.PI/2);
  ctx.font="bold 15px Sarabun, system-ui, sans-serif";
  ctx.fillStyle="rgba(255,255,255,.94)";
  ctx.textAlign="center";
  ctx.fillText("ความดัน ΔP", 0, 0);
  ctx.restore();

  ctx.font="14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("สูง", xMin-85, curveTop+9);
  ctx.fillText("0", xMin-76, curveMid+5);
  ctx.fillText("ต่ำ", xMin-85, curveBottom+4);
  ctx.restore();

  // Pressure curve uses pressureAt(x). The red marker stays at the fixed observation x.
  const pts=[];
  for(let x=xMin; x<=xMax; x+=4){
    const y = curveMid - pressureAt(x) * curveAmp;
    pts.push([x,y]);
  }
  ctx.save();
  ctx.strokeStyle="rgba(74,222,128,.96)";
  ctx.lineWidth=4;
  ctx.shadowColor="rgba(74,222,128,.42)";
  ctx.shadowBlur=10;
  ctx.beginPath();
  pts.forEach(([x,y],i)=> i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  ctx.stroke();
  ctx.restore();

  const graphMarkerX = obsXBase;
  const graphMarkerY = curveMid - pressureAt(graphMarkerX) * curveAmp;
  ctx.save();
  drawParticleShadow(ctx, graphMarkerX, graphMarkerY, 9.5);
  drawParticleSphere(ctx, graphMarkerX, graphMarkerY, 9.5, "red");
  ctx.restore();
}

function drawVizLegend(ctx,c){
  // legend hidden on longitudinal focus page to keep the graph clean
}



function getSpeedSoundParams(){
  const d = Number($("vizDistance")?.value || 5);
  const T = Number($("vizTemp")?.value || 20);
  const timeScale = Number($("vizTimeSpeed")?.value || 0.05);
  const v = 331 + 0.6 * T;
  const dt = d / v;
  if($("vizDistanceLabel")) $("vizDistanceLabel").textContent = d.toFixed(1) + " m";
  if($("vizTempLabel")) $("vizTempLabel").textContent = T.toFixed(0) + " °C";
  if($("vizSoundSpeedLabel")) $("vizSoundSpeedLabel").textContent = v.toFixed(1) + " m/s";
  if($("vizTravelTimeLabel")) $("vizTravelTimeLabel").textContent = (dt * 1000).toFixed(1) + " ms";
  if($("vizTimeLabel")) $("vizTimeLabel").textContent = timeScale.toFixed(2) + "×";
  return {d,T,v,dt,timeScale};
}

function drawMicIcon(ctx, x, y, s=1){
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(s,s);
  ctx.fillStyle="rgba(10,16,30,.92)";
  ctx.strokeStyle="rgba(230,242,255,.78)";
  ctx.lineWidth=2;
  roundRect(ctx,-13,-22,26,32,12);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle="rgba(125,230,255,.72)";
  ctx.lineWidth=1.2;
  for(let yy=-15; yy<=3; yy+=5){
    ctx.beginPath();
    ctx.moveTo(-7,yy);
    ctx.lineTo(7,yy);
    ctx.stroke();
  }
  ctx.strokeStyle="rgba(230,242,255,.82)";
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(0,10);
  ctx.lineTo(0,28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-14,28);
  ctx.lineTo(14,28);
  ctx.stroke();
  const glow=ctx.createRadialGradient(0,0,2,0,0,38);
  glow.addColorStop(0,"rgba(125,230,255,.28)");
  glow.addColorStop(1,"rgba(125,230,255,0)");
  ctx.fillStyle=glow;
  ctx.beginPath();
  ctx.arc(0,0,38,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawTeachingBadge(ctx, x, y, w, h, title, value, stroke){
  ctx.save();
  ctx.fillStyle="rgba(7,18,38,.84)";
  ctx.strokeStyle=stroke;
  ctx.lineWidth=1.5;
  roundRect(ctx,x,y,w,h,14);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle="rgba(185,205,232,.92)";
  ctx.font="13px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText(title,x+16,y+20);
  ctx.fillStyle="rgba(245,248,255,.98)";
  ctx.font="bold 22px Sarabun, system-ui, sans-serif";
  ctx.fillText(value,x+16,y+48);
  ctx.restore();
}

function drawSpeedOfSoundTeachingFinal(ctx, c, pUnused, w, h){
  const p = getSpeedSoundParams();
  ctx.clearRect(0,0,w,h);

  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#020817");
  bg.addColorStop(1,"#06152e");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,w,h);

  ctx.strokeStyle="rgba(148,163,184,.10)";
  ctx.lineWidth=1;
  for(let x=0;x<w;x+=78){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=52){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  const titleY = 34;
  const panelY = 92;
  const panelX = Math.max(34, w*0.045);
  const panelW = w - panelX*2;
  const panelH = Math.max(245, h - panelY - 68);
  const midY = panelY + panelH*0.42;
  const sourceX = panelX + 92;
  const micX = panelX + panelW - 92;
  const lineStart = sourceX + 42;
  const lineEnd = micX - 42;
  const pathW = lineEnd - lineStart;

  ctx.fillStyle="#d8efff";
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("Speed of Sound (อัตราเร็วเสียง)", 24, titleY);

  ctx.save();
  ctx.fillStyle="rgba(4,18,42,.72)";
  ctx.strokeStyle="rgba(88,166,255,.32)";
  ctx.lineWidth=1.5;
  roundRect(ctx,panelX,panelY,panelW,panelH,18);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // direction arrow, same feeling as the three existing visualizer pages
  ctx.save();
  ctx.strokeStyle="rgba(34,211,238,.96)";
  ctx.fillStyle="rgba(34,211,238,.96)";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(w*0.36, panelY+44);
  ctx.lineTo(w*0.64, panelY+44);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w*0.64, panelY+44);
  ctx.lineTo(w*0.62, panelY+32);
  ctx.lineTo(w*0.62, panelY+56);
  ctx.closePath();
  ctx.fill();
  ctx.font="bold 15px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ทิศทางการเคลื่อนที่ของพัลส์เสียง", w*0.50, panelY+25);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle="rgba(125,230,255,.42)";
  ctx.setLineDash([7,9]);
  ctx.lineWidth=2.2;
  ctx.beginPath();
  ctx.moveTo(lineStart,midY);
  ctx.lineTo(lineEnd,midY);
  ctx.stroke();
  ctx.restore();

  drawSpeaker(ctx, sourceX, midY, 1.02);
  drawMicIcon(ctx, micX, midY, 1.06);

  ctx.fillStyle="rgba(245,248,255,.96)";
  ctx.font="bold 14px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("แหล่งกำเนิดเสียง", sourceX, midY+64);
  ctx.fillText("ไมโครโฟน", micX, midY+64);

  const displaySlowFactor = 40; // v5.96 extra slow-motion display only; physics values stay real
  const elapsed = Math.min((vizState.t*0.016*p.timeScale)/displaySlowFactor, p.dt);
  const frac = Math.min(1, p.dt>0 ? elapsed/p.dt : 0);
  const pulseX = lineStart + pathW*frac;
  const reached = frac >= 0.999;

  const pulseBand = ctx.createLinearGradient(pulseX-40,0,pulseX+40,0);
  pulseBand.addColorStop(0,"rgba(0,0,0,0)");
  pulseBand.addColorStop(.45,"rgba(34,211,238,.16)");
  pulseBand.addColorStop(.5,"rgba(34,211,238,.68)");
  pulseBand.addColorStop(.55,"rgba(255,77,109,.28)");
  pulseBand.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=pulseBand;
  ctx.fillRect(pulseX-40, panelY+64, 80, panelH-154);

  for(let i=0;i<6;i++){
    const rx = Math.max(lineStart, pulseX - i*28 - (vizState.t%20)*0.7);
    if(rx < lineStart+6) continue;
    ctx.strokeStyle=`rgba(34,211,238,${0.42-i*0.045})`;
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(rx,midY,32+i*5,-0.55,0.55);
    ctx.stroke();
  }

  ctx.fillStyle="rgba(255,77,109,.98)";
  ctx.beginPath();
  ctx.arc(pulseX, midY, 8.2, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle="rgba(255,255,255,.95)";
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.arc(pulseX, midY, 11.5, 0, Math.PI*2);
  ctx.stroke();

  const arrowY = panelY + panelH - 72;
  ctx.save();
  ctx.strokeStyle="rgba(255,210,55,.98)";
  ctx.fillStyle="rgba(255,210,55,.98)";
  ctx.lineWidth=2.4;
  ctx.beginPath();
  ctx.moveTo(lineStart,arrowY);
  ctx.lineTo(lineEnd,arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lineStart,arrowY);
  ctx.lineTo(lineStart+11,arrowY-7);
  ctx.moveTo(lineStart,arrowY);
  ctx.lineTo(lineStart+11,arrowY+7);
  ctx.moveTo(lineEnd,arrowY);
  ctx.lineTo(lineEnd-11,arrowY-7);
  ctx.moveTo(lineEnd,arrowY);
  ctx.lineTo(lineEnd-11,arrowY+7);
  ctx.stroke();
  ctx.setLineDash([5,6]);
  ctx.beginPath(); ctx.moveTo(lineStart,panelY+74); ctx.lineTo(lineStart,arrowY+18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(lineEnd,panelY+74); ctx.lineTo(lineEnd,arrowY+18); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font="bold 18px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText(`ระยะทาง s = ${p.d.toFixed(1)} m`, (lineStart+lineEnd)/2, arrowY+30);
  ctx.restore();

  const badgeY = panelY + panelH - 132;
  const bW = Math.min(180, (panelW-58)/3);
  drawTeachingBadge(ctx, panelX+24, badgeY, bW, 58, "เวลาที่วัดได้", `${(elapsed*1000).toFixed(1)} ms`, "rgba(34,211,238,.58)");
  drawTeachingBadge(ctx, panelX+34+bW, badgeY, bW, 58, "อัตราเร็วเสียง", `${p.v.toFixed(1)} m/s`, "rgba(52,211,153,.58)");
  drawTeachingBadge(ctx, panelX+44+bW*2, badgeY, bW, 58, "ความสัมพันธ์", "v = s / Δt", "rgba(168,85,247,.58)");

  if(reached){
    const glow=ctx.createRadialGradient(micX,midY,6,micX,midY,48);
    glow.addColorStop(0,"rgba(255,210,55,.55)");
    glow.addColorStop(1,"rgba(255,210,55,0)");
    ctx.fillStyle=glow;
    ctx.beginPath();
    ctx.arc(micX,midY,48,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle="rgba(255,230,160,.96)";
    ctx.font="bold 14px Sarabun, system-ui, sans-serif";
    ctx.textAlign="center";
    ctx.fillText("เสียงเดินทางถึงไมโครโฟน", micX, midY-44);
  }
}



const soundTopicModes = new Set(["soundReflection","soundRefraction","soundDiffraction","soundInterference","resonanceAirHarmonics","shockWave","soundIntensity","soundIntensityLevel","soundLevelHearing","noisePollution","applicationsSound"]);
function gNum(id,fb){const e=$(id); return e?Number(e.value||fb):fb;} function lab(id,t){if($(id))$(id).textContent=t;}
function arr(ctx,x1,y1,x2,y2,col="#22d3ee",lw=3){ctx.save();ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();let a=Math.atan2(y2-y1,x2-x1),h=12;ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-h*Math.cos(a-Math.PI/6),y2-h*Math.sin(a-Math.PI/6));ctx.lineTo(x2-h*Math.cos(a+Math.PI/6),y2-h*Math.sin(a+Math.PI/6));ctx.closePath();ctx.fill();ctx.restore();}
function baseTopic(ctx,w,h,title){ctx.clearRect(0,0,w,h);let bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,"#020817");bg.addColorStop(1,"#06152e");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);ctx.strokeStyle="rgba(148,163,184,.10)";for(let x=0;x<w;x+=78){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=52){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}let p={x:44,y:76,w:w-88,h:h-126};ctx.fillStyle="rgba(4,18,42,.74)";ctx.strokeStyle="rgba(88,166,255,.32)";ctx.lineWidth=1.6;roundRect(ctx,p.x,p.y,p.w,p.h,18);ctx.fill();ctx.stroke();ctx.fillStyle="#e8f5ff";ctx.font="bold 20px Sarabun";ctx.textAlign="left";ctx.fillText(title,24,34);return p;}
function waves(ctx,x,y,n,sp,col){ctx.save();ctx.strokeStyle=col;ctx.lineWidth=2;for(let i=1;i<=n;i++){ctx.globalAlpha=Math.max(.15,.8-i*.07);ctx.beginPath();ctx.arc(x,y,i*sp,-.85,.85);ctx.stroke();}ctx.restore();}
function drawSoundTopicPlaceholder(ctx,c,p,w,h,mode){let box,cx,cy,t=vizState.t*.035*(p.speed||1); if(mode==="soundReflection"){let a=gNum("vizAngle",35);lab("vizAngleLabel",a.toFixed(0)+"°");box=baseTopic(ctx,w,h,"Sound Reflection (การสะท้อนของเสียง)");cx=w/2;cy=box.y+box.h*.52;let wx=box.x+box.w-210,sx=box.x+135,sy=cy+55;drawSpeaker(ctx,sx,sy,.85);waves(ctx,sx,sy,7,30,"rgba(34,211,238,.75)");ctx.strokeStyle="rgba(255,255,255,.65)";ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(wx,box.y+40);ctx.lineTo(wx,box.y+box.h-40);ctx.stroke();ctx.setLineDash([8,7]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(wx-140,cy);ctx.lineTo(wx+110,cy);ctx.stroke();ctx.setLineDash([]);arr(ctx,sx+65,sy-18,wx,cy,"#22d3ee",4);arr(ctx,wx,cy,sx+65,cy-110,"#ff5cab",4);ctx.fillStyle="#e8f5ff";ctx.font="bold 16px Sarabun";ctx.fillText("θᵢ = θᵣ",wx-95,cy+72);} else if(mode==="soundRefraction"){box=baseTopic(ctx,w,h,"Sound Refraction (การหักเหของเสียง)");cx=w/2;cy=box.y+box.h*.5;ctx.fillStyle="rgba(255,120,40,.08)";ctx.fillRect(box.x+18,box.y+22,box.w-36,box.h/2-22);ctx.fillStyle="rgba(34,211,238,.09)";ctx.fillRect(box.x+18,cy,box.w-36,box.h/2-22);ctx.strokeStyle="rgba(255,255,255,.45)";ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(box.x+30,cy);ctx.lineTo(box.x+box.w-30,cy);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle="#ff5cab";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(box.x+130,cy-115);ctx.quadraticCurveTo(cx-40,cy-15,cx,cy);ctx.quadraticCurveTo(cx+80,cy+80,cx+190,cy+135);ctx.stroke();arr(ctx,cx+120,cy+95,cx+190,cy+135,"#ff5cab",4);ctx.fillStyle="#e8f5ff";ctx.fillText("เบนเข้าหาบริเวณที่ช้ากว่า",box.x+70,box.y+box.h-28);} else if(mode==="soundDiffraction"){box=baseTopic(ctx,w,h,"Sound Diffraction (การเลี้ยวเบนของเสียง)");cx=w/2;cy=box.y+box.h*.52;let bx=cx-70;drawSpeaker(ctx,box.x+115,cy,.85);ctx.strokeStyle="rgba(255,255,255,.62)";ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(bx,box.y+45);ctx.lineTo(bx,cy-45);ctx.stroke();ctx.beginPath();ctx.moveTo(bx,cy+45);ctx.lineTo(bx,box.y+box.h-45);ctx.stroke();waves(ctx,bx,cy,8,34,"rgba(255,92,171,.88)");ctx.fillStyle="#e8f5ff";ctx.fillText("a ≈ λ → เลี้ยวเบนเด่น",cx+115,box.y+48);} else if(mode==="soundInterference"){box=baseTopic(ctx,w,h,"Sound Interference (การแทรกสอดของเสียง)");cx=w/2;cy=box.y+box.h*.52;let sx=box.x+150,s1=cy-70,s2=cy+70;drawSpeaker(ctx,sx,s1,.7);drawSpeaker(ctx,sx,s2,.7);for(let r=35;r<380;r+=35){ctx.strokeStyle=`rgba(34,211,238,${.45-r/900})`;ctx.beginPath();ctx.arc(sx,s1,r,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=`rgba(255,92,171,${.43-r/900})`;ctx.beginPath();ctx.arc(sx,s2,r,0,Math.PI*2);ctx.stroke();}ctx.fillStyle="#e8f5ff";ctx.fillText("Δr = mλ (เสริม) / (m+1/2)λ (หักล้าง)",cx+10,box.y+48);} else if(mode==="shockWave"){let M=gNum("vizMach",1.5);lab("vizMachLabel",M.toFixed(2));box=baseTopic(ctx,w,h,"Shock Wave / Sonic Boom");cx=w/2;cy=box.y+box.h*.52;let th=Math.asin(1/Math.max(M,1.01)),sx=cx+80;ctx.font="bold 30px Sarabun";ctx.fillText("✈️",sx,cy);ctx.strokeStyle="#c084fc";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(sx,cy);ctx.lineTo(sx-330,cy-Math.tan(th)*330);ctx.stroke();ctx.beginPath();ctx.moveTo(sx,cy);ctx.lineTo(sx-330,cy+Math.tan(th)*330);ctx.stroke();ctx.fillText("sin θ = 1/M",sx-90,cy+76);} else if(mode==="soundIntensity"||mode==="soundIntensityLevel"){box=baseTopic(ctx,w,h,mode==="soundIntensity"?"Sound Intensity (ความเข้มเสียง)":"Sound Intensity Level (ระดับความเข้มเสียง)");cy=box.y+box.h*.46;let sx=box.x+130;drawSpeaker(ctx,sx,cy,.9);waves(ctx,sx,cy,7,44,"rgba(34,211,238,.65)");ctx.fillStyle="#e8f5ff";ctx.font="bold 18px Sarabun";ctx.textAlign="center";ctx.fillText(mode==="soundIntensity"?"I = P / 4πr² และ I ∝ 1/r²":"β = 10 log₁₀(I/I₀),  I₀ = 1.0×10⁻¹² W/m²",w/2,box.y+box.h-45);} else if(mode==="soundLevelHearing"){box=baseTopic(ctx,w,h,"Sound Level, Frequency and Hearing");ctx.fillStyle="rgba(34,211,238,.18)";roundRect(ctx,box.x+110,box.y+70,box.w-220,box.h-145,30);ctx.fill();ctx.fillStyle="#e8f5ff";ctx.textAlign="center";ctx.fillText("ช่วงการได้ยิน 20 Hz – 20 kHz | หูไวมากประมาณ 2–5 kHz",w/2,box.y+box.h-42);} else if(mode==="noisePollution"){box=baseTopic(ctx,w,h,"Noise Pollution and Protection");let base=box.y+box.h-80,left=box.x+90,right=box.x+box.w-90;[...Array(6)].forEach((_,i)=>{let x=left+i*(right-left)/5,bh=45+i*28;ctx.fillStyle=i>3?"rgba(255,77,109,.75)":i>2?"rgba(251,191,36,.72)":"rgba(34,211,238,.65)";roundRect(ctx,x-24,base-bh,48,bh,10);ctx.fill();});} else if(mode==="resonanceAirHarmonics"){box=baseTopic(ctx,w,h,"Resonance Air Column: Harmonic Modes");for(let row=0;row<3;row++){let y=box.y+80+row*85,left=box.x+120,right=box.x+box.w-120,pts=[];ctx.strokeStyle="rgba(255,255,255,.42)";ctx.strokeRect(left,y-25,right-left,50);for(let x=left;x<=right;x++){let u=(x-left)/(right-left)*Math.PI*(row*2+1);pts.push([x,y-Math.sin(u)*22]);}drawWaveLine(ctx,pts,row===0?"#22d3ee":row===1?"#a78bfa":"#ff5cab",3);}} else {box=baseTopic(ctx,w,h,"Applications of Sound");["แพทย์: อัลตราซาวด์","โซนาร์: ตรวจใต้น้ำ","Echolocation","อุตสาหกรรม"].forEach((s,i)=>{let x=box.x+80+(i%2)*box.w/2,y=box.y+80+Math.floor(i/2)*115;ctx.fillStyle="rgba(7,18,38,.8)";ctx.strokeStyle="rgba(34,211,238,.45)";roundRect(ctx,x,y,box.w/2-120,80,14);ctx.fill();ctx.stroke();ctx.fillStyle="#e8f5ff";ctx.fillText(s,x+20,y+45);});}}

function drawVisualizer(){
  const c=$("visualizerCanvas"); if(!c) return;
  const ctx=c.getContext("2d");
  const p=getVizParams();
  vizGrid(ctx,c);
  const W=c.width,H=c.height, mid=H/2;
  const phase=vizState.t*0.055*p.speed;
  const mode=vizState.mode;

  // v5.40: force Longitudinal Wave to use the custom final renderer before the old branch.
  if(mode==="longitudinal"){
    drawLongitudinalFinal(ctx,c,p,W,H);
    if(vizState.running) vizState.t += 1;
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }

  if(mode==="pressure"){
    drawPressureWaveFinal(ctx,c,p,W,H);
    if(vizState.running) vizState.t += 1;
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }

  if(mode==="speedSound"){
    drawSpeedOfSoundTeachingFinal(ctx,c,p,W,H);
    if(vizState.running){
      const ps = getSpeedSoundParams();
      const displaySlowFactor = 40;
      const elapsed = (vizState.t * 0.016 * ps.timeScale) / displaySlowFactor;
      const resetAt = Math.max(ps.dt + 0.45, 0.85);
      vizState.t = elapsed >= resetAt ? 0 : vizState.t + 1;
    }
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }

  if(soundTopicModes.has(mode)){
    drawSoundTopicPlaceholder(ctx,c,p,W,H,mode);
    if(vizState.running) vizState.t += 1;
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }

  if(mode==="displacementPressure"){

    drawDisplacementPressureFinal(ctx,c,p,W,H);
    if(vizState.running) vizState.t += 1;
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }


  ctx.fillStyle="#cfe9ff"; ctx.font="20px Sarabun";
  ctx.fillText(modeLabel(mode),24,34);
  drawVizAxis(ctx,c,mode);
  drawVizScale(ctx,c,mode);
  if(c.dataset.vizMode!=="longitudinal") drawVizLegend(ctx,c);

  if(mode==="longitudinal" || mode==="pressure"){
    const trackedIndex = 30;
    const rows = mode==="longitudinal" ? [mid] : [mid-50, mid+50];
    for(const yBase of rows){
      for(let i=0;i<70;i++){
        const x0=70+i*(W-140)/69;
        const disp=Math.sin((i/69)*Math.PI*8-phase)*p.A*22;
        const x=x0+disp;
        const density=(Math.sin((i/69)*Math.PI*8-phase)+1)/2;
        const isTracked = i===trackedIndex;
        ctx.fillStyle=isTracked ? "#ff4d6d" : (mode==="pressure"?`rgba(34,211,238,${0.25+0.65*density})`:"#22d3ee");
        ctx.beginPath(); ctx.arc(x,yBase,isTracked?8:(mode==="pressure"?5+7*density:6),0,Math.PI*2); ctx.fill();
        if(isTracked){
          ctx.strokeStyle="#ffffff"; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(x,yBase,(mode==="pressure"?5+7*density:6)+2,0,Math.PI*2); ctx.stroke();
        }
        if(mode==="longitudinal"){
          ctx.strokeStyle="rgba(255,255,255,.14)";
          ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(x0,yBase-35); ctx.lineTo(x0,yBase+35); ctx.stroke();
          if(isTracked){
            drawTrackedVertical(ctx,x0,yBase-42,yBase+42);
            drawTrackedParticle(ctx,x,yBase,"");
            drawLongitudinalAnnotations(ctx,x0,x,yBase);
          }
        }
        if(mode==="pressure" && isTracked && yBase===mid-50){
          drawTrackedParticle(ctx,x,yBase,"");
        }
      }
    }
    if(mode==="pressure"){
      for(let x=70;x<W-70;x+=4){
        const val=(Math.sin((x-70)/(W-140)*Math.PI*8-phase)+1)/2;
        ctx.fillStyle=`rgba(34,211,238,${0.05+0.55*val})`;
        ctx.fillRect(x,mid-140,4,280);
      }
    }
  }

  if(soundTopicModes.has(mode)){
    drawSoundTopicPlaceholder(ctx,c,p,W,H,mode);
    if(vizState.running) vizState.t += 1;
    vizState.raf=requestAnimationFrame(drawVisualizer);
    return;
  }

  if(mode==="displacementPressure"){
    const pts1=[], pts2=[];
    for(let x=60;x<W-60;x++){
      const u=(x-60)/(W-120)*Math.PI*8-phase;
      pts1.push([x,150-Math.sin(u)*p.A*55]);
      pts2.push([x,360-Math.cos(u)*p.A*55]);
    }
    const trackedIdx = Math.floor(pts1.length*0.42);
    ctx.fillStyle="#9fb3c8"; ctx.fillText("Displacement",70,85); ctx.fillText("Pressure",70,295);
    drawWaveLine(ctx,pts1,"#22d3ee",3); drawWaveLine(ctx,pts2,"#fbbf24",3);
    drawTrackedVertical(ctx,pts1[trackedIdx][0],105,415);
    drawTrackedParticle(ctx,pts1[trackedIdx][0],pts1[trackedIdx][1],"observation point");
    drawTrackedParticle(ctx,pts2[trackedIdx][0],pts2[trackedIdx][1],"same x-position");
  }

  if(mode==="transverseCompare"){
    const trackedIndex = 22;
    for(let i=0;i<60;i++){
      const x0=70+i*(W-140)/59;
      const disp=Math.sin((i/59)*Math.PI*8-phase)*p.A*20;
      const isTracked = i===trackedIndex;
      ctx.fillStyle=isTracked ? "#ff4d6d" : "#22d3ee";
      ctx.beginPath(); ctx.arc(x0+disp,160,isTracked?7:5,0,Math.PI*2); ctx.fill();
      if(isTracked){
        ctx.strokeStyle="#ffffff"; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(x0+disp,160,9,0,Math.PI*2); ctx.stroke();
        drawTrackedParticle(ctx,x0+disp,160,"tracked particle");
      }
    }
    const pts=[];
    for(let x=60;x<W-60;x++){
      const y=365-Math.sin((x-60)/(W-120)*Math.PI*8-phase)*p.A*60;
      pts.push([x,y]);
    }
    const trackedCurveIdx = Math.floor(pts.length*0.42);
    ctx.fillStyle="#9fb3c8"; ctx.fillText("Longitudinal representation",70,95); ctx.fillText("Transverse representation",70,295);
    drawWaveLine(ctx,pts,"#fbbf24",3);
    drawTrackedParticle(ctx,pts[trackedCurveIdx][0],pts[trackedCurveIdx][1],"same wave position");
  }

  if(mode==="superposition" || mode==="beatsViz"){
    const ptsA=[], ptsB=[], ptsSum=[];
    const f2 = mode==="beatsViz" ? p.f+8 : p.f*1.35;
    for(let x=60;x<W-60;x++){
      const xx=(x-60)/(W-120);
      const y1=Math.sin(xx*Math.PI*8-phase)*p.A*45;
      const y2=Math.sin(xx*Math.PI*8*(f2/p.f)-phase*1.07)*p.A*45;
      ptsA.push([x,135-y1]); ptsB.push([x,250-y2]); ptsSum.push([x,385-(y1+y2)*0.72]);
    }
    const trackedIdx = Math.floor(ptsA.length*0.36);
    drawWaveLine(ctx,ptsA,"#22d3ee",2); drawWaveLine(ctx,ptsB,"#a855f7",2); drawWaveLine(ctx,ptsSum,"#fbbf24",4);
    ctx.fillStyle="#9fb3c8"; ctx.fillText("Wave A",70,80); ctx.fillText("Wave B",70,195); ctx.fillText("Result",70,330);
    drawTrackedVertical(ctx,ptsA[trackedIdx][0],85,405);
    drawTrackedParticle(ctx,ptsA[trackedIdx][0],ptsA[trackedIdx][1],"wave A point");
    drawTrackedParticle(ctx,ptsB[trackedIdx][0],ptsB[trackedIdx][1],"wave B point");
    drawTrackedParticle(ctx,ptsSum[trackedIdx][0],ptsSum[trackedIdx][1],"result point");
  }

  if(mode==="standingAir"){
    const closed=p.sub==="closed";
    const tubeX=90,tubeY=110,tubeW=W-180,tubeH=230;
    const trackedIndex = 10;
    ctx.strokeStyle="#cfe9ff"; ctx.lineWidth=5;
    ctx.strokeRect(tubeX,tubeY,tubeW,tubeH);
    if(closed){ctx.fillStyle="#cfe9ff";ctx.fillRect(tubeX-8,tubeY-5,12,tubeH+10);}
    const pts=[];
    for(let x=0;x<=tubeW;x++){
      const xx=x/tubeW;
      const shape=closed?Math.sin(xx*Math.PI/2):Math.sin(xx*Math.PI);
      const y=tubeY+tubeH/2-Math.sin(phase)*shape*p.A*95;
      pts.push([tubeX+x,y]);
    }
    drawWaveLine(ctx,pts,"#22d3ee",4);
    for(let i=0;i<18;i++){
      const x=tubeX+20+i*(tubeW-40)/17;
      const xx=(x-tubeX)/tubeW;
      const shape=closed?Math.sin(xx*Math.PI/2):Math.sin(xx*Math.PI);
      const y = tubeY+tubeH/2-Math.sin(phase)*shape*p.A*70;
      const isTracked = i===trackedIndex;
      ctx.fillStyle=isTracked ? "#ff4d6d" : "#fbbf24";
      ctx.beginPath();ctx.arc(x,y,isTracked?7:5,0,Math.PI*2);ctx.fill();
      if(isTracked){
        ctx.strokeStyle="#ffffff"; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(x,y,9,0,Math.PI*2); ctx.stroke();
        drawTrackedParticle(ctx,x,y,"tracked air particle");
      }
    }
  }

  if(mode==="resonanceViz"){
    const f0=440, width=55;
    const pts=[];
    for(let x=80;x<W-80;x++){
      const freq=100+(x-80)/(W-160)*900;
      const amp=Math.exp(-Math.pow((freq-f0)/width,2));
      pts.push([x,H-80-amp*p.A*320]);
    }
    drawWaveLine(ctx,pts,"#34d399",4);
    ctx.strokeStyle="#fbbf24";ctx.lineWidth=2;const rx=80+(f0-100)/900*(W-160);ctx.beginPath();ctx.moveTo(rx,80);ctx.lineTo(rx,H-70);ctx.stroke();
    const peakY = H-80-1*p.A*320;
    drawTrackedParticle(ctx,rx,peakY,"resonance peak");
  }

  if(mode==="harmonicsViz"){
    const type=p.sub;
    const bars = type==="square" ? [1,0,0.33,0,0.2,0,0.14] : type==="sawtooth" ? [1,0.5,0.33,0.25,0.2,0.16,0.14] : [1,0,0,0,0,0,0];
    const baseX=140, baseY=H-90, gap=120;
    bars.forEach((a,i)=>{
      const h=a*330*p.A;
      ctx.fillStyle=i===0?"#ff4d6d":"#a855f7";
      ctx.fillRect(baseX+i*gap,baseY-h,55,h);
      if(i===0){
        ctx.strokeStyle="#ffffff"; ctx.lineWidth=2;
        ctx.strokeRect(baseX+i*gap-2,baseY-h-2,59,h+4);
        drawTrackedParticle(ctx,baseX+i*gap+27,baseY-h,"fundamental");
      }
      ctx.fillStyle="#cfe9ff";ctx.font="16px Sarabun";ctx.fillText(`${i+1}f`,baseX+i*gap+10,baseY+24);
    });
  }

  if(mode==="dopplerViz"){
    const sx=360+Math.sin(phase*0.18)*220, sy=mid;
    const ox = W-160, oy = mid-40;
    ctx.fillStyle="#fbbf24";ctx.beginPath();ctx.arc(sx,sy,14,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(34,211,238,.65)";ctx.lineWidth=3;
    for(let r=40;r<520;r+=42){
      ctx.beginPath();ctx.arc(sx-r*0.18,sy,r,0,Math.PI*2);ctx.stroke();
    }
    ctx.fillStyle="#cfe9ff";ctx.font="18px Sarabun";ctx.fillText("source",sx+20,sy-18);
    drawTrackedParticle(ctx,ox,oy,"observer point");
  }

  if(vizState.running) vizState.t += 1;
  vizState.raf=requestAnimationFrame(drawVisualizer);
}
function modeLabel(mode){
  return {
    longitudinal:"Longitudinal Wave (คลื่นตามยาว)",
    pressure:"Pressure Variation",
    displacementPressure:"Displacement + Pressure",
    transverseCompare:"Longitudinal / Transverse",
    superposition:"Superposition",
    beatsViz:"Beats",
    standingAir:"Standing Wave in Air Column",
    resonanceViz:"Resonance",
    harmonicsViz:"Harmonics / Timbre",
    dopplerViz:"Doppler"
  }[mode] || mode;
}
function updateVizPlayerButtons(trigger){
  const play=$("vizPlayBtn"), pause=$("vizPauseBtn"), reset=$("vizResetBtn");
  if(play) play.classList.toggle("isActive", !!vizState.running);
  if(pause) pause.classList.toggle("isActive", !vizState.running);
  if(reset){
    reset.classList.remove("isPressed");
    if(trigger==="reset"){
      void reset.offsetWidth;
      reset.classList.add("isPressed");
      setTimeout(()=>reset.classList.remove("isPressed"), 420);
    }
  }
}

function initVisualizer(){
  if(!$("visualizerCanvas")) return;
  const activeVizSection=document.querySelector(".visualizerSinglePage[data-viz-mode]");
  if(activeVizSection?.dataset?.vizMode){ vizState.mode=activeVizSection.dataset.vizMode; }
  resizeVisualizerCanvas();
  document.querySelectorAll("[data-viz]").forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll("[data-viz]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      vizState.mode=btn.dataset.viz;
    };
  });
  ["vizFreq","vizAmp","vizSpeed","vizTimeSpeed","vizPhase","vizPhaseDiff","vizSubMode","vizDistance","vizTemp","vizAngle","vizTempDiff","vizSlit","vizSeparation","vizTubeMode","vizLength","vizMach","vizPower","vizIntensity","vizLevel","vizSourceLevel","vizProtection","vizAppCategory"].forEach(id=>$(id)?.addEventListener("input",()=>{
    getVizParams();
    if(typeof drawVisualizer === "function") drawVisualizer();
  }));
  if($("vizPlayBtn")) $("vizPlayBtn").onclick=()=>{vizState.running=true;updateVizPlayerButtons("play");};
  if($("vizPauseBtn")) $("vizPauseBtn").onclick=()=>{vizState.running=false;updateVizPlayerButtons("pause");};
  if($("vizResetBtn")) $("vizResetBtn").onclick=()=>{vizState.t=0;updateVizPlayerButtons("reset");};
  if($("vizExportBtn")) $("vizExportBtn").onclick=()=>{
    const c=$("visualizerCanvas");
    const a=document.createElement("a");
    a.href=c.toDataURL("image/png");
    a.download=makeTopicFileName("Image", "png");
    a.click();
  };
  if(vizState.raf) cancelAnimationFrame(vizState.raf);
  updateVizPlayerButtons();
  drawVisualizer();
}

function init(){fillBrowserInfo();initVisualizer();initLocalExportCards();if("serviceWorker"in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}if(!$("startMic")) return;Object.entries(ctxs).forEach(([n,ctx])=>drawGrid(ctx,canvases[n]));drawBeat();drawResonance();renderColumnToggles();readConfig();loadSettings();renderLog();$("startMic").onclick=startMic;$("stopMic").onclick=stopMic;$("captureBtn").onclick=capture;$("downloadBtn").onclick=downloadCsv;$("downloadExcelBtn").onclick=downloadExcel;if($("captureCalBtn"))$("captureCalBtn").onclick=captureCalibration;if($("downloadCalBtn"))$("downloadCalBtn").onclick=downloadCalibrationCsv;if($("applyDbCalBtn"))$("applyDbCalBtn").onclick=applyDbCalibration;if($("playCalTone"))$("playCalTone").onclick=()=>{$("toneFreq").value=440;playTone();};if($("stopCalTone"))$("stopCalTone").onclick=stopTone;$("clearBtn").onclick=()=>{logs=[];renderLog();};$("autoLogBtn").onclick=toggleAutoLog;$("preset").onchange=()=>{applyPreset();};if($("userMode")) $("userMode").onchange=applyMode;$("freezeBtn").onclick=()=>{frozen=!frozen;$("freezeBtn").textContent=frozen?"Unfreeze Graph":"Freeze Graph";};$("resetPeakBtn").onclick=()=>{peakHold=[];};$("saveGraphsBtn").onclick=saveGraphs;$("saveSettingsBtn").onclick=saveSettings;$("resetSettingsBtn").onclick=resetSettings;$("configLinkBtn").onclick=copyConfig;$("playTone").onclick=playTone;$("stopTone").onclick=stopTone;$("playNoise").onclick=playNoise;$("stopNoise").onclick=stopNoise;$("playBeat").onclick=playBeat;$("stopBeat").onclick=stopBeat;["beatF1","beatF2","beatVol"].forEach(id=>$(id).addEventListener("input",()=>{if(beatOsc1)beatOsc1.frequency.value=Number($("beatF1").value||440);if(beatOsc2)beatOsc2.frequency.value=Number($("beatF2").value||444);if(beatGain)beatGain.gain.value=Number($("beatVol").value||.06);drawBeat();}));["resV","resL","resMode"].forEach(id=>$(id).addEventListener("input",drawResonance));["toneFreq","toneVol","toneType"].forEach(id=>$(id).addEventListener("input",()=>{if(toneOsc)toneOsc.frequency.value=Number($("toneFreq").value||440);if(toneGain)toneGain.gain.value=Number($("toneVol").value||.06);if(toneOsc)toneOsc.type=$("toneType").value;}));$("noiseVol").addEventListener("input",()=>{if(noiseGain)noiseGain.gain.value=Number($("noiseVol").value||.03);});if("serviceWorker"in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}}
document.addEventListener("DOMContentLoaded",init);


/* v5.10 local export per experiment page */
const localPageLogs = {};
function getActiveTopicTitle(){
  const activeTitle = document.querySelector("section.activeDetail h2")?.textContent?.trim();
  if(activeTitle) return activeTitle;
  const brandTitle = document.querySelector(".detailNav .brand span")?.textContent?.trim();
  if(brandTitle) return brandTitle;
  const card = document.querySelector(".localExportCard[data-export-name]");
  if(card?.dataset?.exportName) return card.dataset.exportName;
  return document.title || "MelodyLab";
}
function safeFileNamePart(text){
  return String(text || "MelodyLab")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[()\[\]{}]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "MelodyLab";
}
function fileTimestamp(){
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function makeTopicFileName(kind, ext){
  const topic = safeFileNamePart(getActiveTopicTitle());
  const suffix = kind ? "_" + safeFileNamePart(kind) : "";
  return `${topic}${suffix}_${fileTimestamp()}.${ext}`;
}
function getActiveExperimentName(){
  return getActiveTopicTitle();
}
function getLocalPageSnapshot(){
  const page = getActiveExperimentName();
  const now = new Date().toLocaleString("th-TH");
  const row = {time: now, page};

  // Visualizer values / current parameter settings
  if($("vizFreq")) row.parameter_frequency_hz = Number($("vizFreq").value || 0);
  if($("vizAmp")) row.parameter_amplitude_A = Number($("vizAmp").value || 0);
  if($("vizSpeed")) row.parameter_wave_speed_m_s = Number($("vizSpeed").value || 0);
  if($("vizTimeSpeed")) row.parameter_time_speed_x = Number($("vizTimeSpeed").value || 0);
  if($("vizPhase")) row.parameter_phase_deg = Number($("vizPhase").value || 0);
  if($("vizPhaseDiff")) row.parameter_phase_difference_deg = Number($("vizPhaseDiff").value || 0);
  if($("vizSubMode")) row.parameter_mode = $("vizSubMode").value || "";
  if($("vizDistance")) { row.parameter_distance_m = Number($("vizDistance").value || 0); row.parameter_path_length_s_m = Number($("vizDistance").value || 0); }
  if($("vizTemp")) row.parameter_temperature_c = Number($("vizTemp").value || 0);
  if($("vizAngle")) row.parameter_angle_deg = Number($("vizAngle").value || 0);
  if($("vizTempDiff")) row.parameter_temperature_difference_c = Number($("vizTempDiff").value || 0);
  if($("vizSlit")) row.parameter_slit_width_lambda = Number($("vizSlit").value || 0);
  if($("vizSeparation")) row.parameter_source_separation_m = Number($("vizSeparation").value || 0);
  if($("vizTubeMode")) row.parameter_tube_mode_n = Number($("vizTubeMode").value || 0);
  if($("vizLength")) row.parameter_length_m = Number($("vizLength").value || 0);
  if($("vizMach")) row.parameter_mach_number = Number($("vizMach").value || 0);
  if($("vizPower")) row.parameter_sound_power_w = Number($("vizPower").value || 0);
  if($("vizIntensity")) row.parameter_log_intensity = Number($("vizIntensity").value || 0);
  if($("vizLevel")) row.parameter_sound_level_db = Number($("vizLevel").value || 0);
  if($("vizSourceLevel")) row.parameter_source_level_db = Number($("vizSourceLevel").value || 0);
  if($("vizProtection")) row.parameter_protection_db = Number($("vizProtection").value || 0);
  if($("vizFreqLabel")) row.frequency_display = $("vizFreqLabel").textContent || "";
  if($("vizAmpLabel")) row.amplitude_display = $("vizAmpLabel").textContent || "";
  if($("vizSpeedLabel")) row.wave_speed_display = $("vizSpeedLabel").textContent || "";
  if($("vizDistanceLabel")) row.distance_display = $("vizDistanceLabel").textContent || "";
  if($("vizTempLabel")) row.temperature_display = $("vizTempLabel").textContent || "";
  if($("vizSoundSpeedLabel")) row.sound_speed_display = $("vizSoundSpeedLabel").textContent || "";
  if($("vizTravelTimeLabel")) row.travel_time_display = $("vizTravelTimeLabel").textContent || "";
  if($("vizTimeLabel")) row.time_speed_display = $("vizTimeLabel").textContent || "";
  if($("vizPhaseLabel")) row.phase_display = $("vizPhaseLabel").textContent || "";
  if($("vizPhaseDiffLabel")) row.phase_difference_display = $("vizPhaseDiffLabel").textContent || "";
  const freqVal = Number($("vizFreq")?.value || 0);
  const speedVal = Number($("vizSpeed")?.value || 0);
  if(freqVal > 0 && speedVal > 0) row.parameter_wavelength_m = +(speedVal / freqVal).toFixed(4);

  // Legacy Visualizer outputs (if present)
  if($("vizFreqOut")) row.frequency = $("vizFreqOut").textContent || "";
  if($("vizAmpOut")) row.amplitude = $("vizAmpOut").textContent || "";
  if($("vizSpeedOut")) row.wave_speed = $("vizSpeedOut").textContent || "";
  if($("vizLambdaOut")) row.wavelength = $("vizLambdaOut").textContent || "";

  // Analysis / measure readouts
  if($("mainFreqOut")) row.main_frequency = $("mainFreqOut").textContent || "";
  if($("fftOut")) row.fft_peak = $("fftOut").textContent || "";
  if($("autoOut")) row.autocorrelation = $("autoOut").textContent || "";
  if($("periodOut")) row.period = $("periodOut").textContent || "";
  if($("dbOut")) row.db = $("dbOut").textContent || "";
  if($("dbStatsOut")) row.db_stats = $("dbStatsOut").textContent || "";

  // Resonance
  if($("resOut")) row.fundamental_frequency = $("resOut").textContent || "";
  if($("harmonicsOut")) row.harmonics = $("harmonicsOut").textContent || "";

  // Spectrogram / canvas state
  if($("spectrogramCanvas")) row.graph = "spectrogram_canvas";
  if($("spectrumCanvas")) row.graph = row.graph ? row.graph + "; spectrum_canvas" : "spectrum_canvas";
  if($("historyCanvas")) row.graph = row.graph ? row.graph + "; frequency_history_canvas" : "frequency_history_canvas";

  // Generator
  if($("toneFreq")) row.tone_frequency_hz = $("toneFreq").value || "";
  if($("toneType")) row.waveform = $("toneType").value || "";
  if($("beatF1")) row.beat_f1_hz = $("beatF1").value || "";
  if($("beatF2")) row.beat_f2_hz = $("beatF2").value || "";
  if($("beatOut")) row.beat_frequency = $("beatOut").textContent || "";

  // Settings / labels
  if($("labelInput")) row.label = $("labelInput").value || "";
  if($("runInput")) row.run = $("runInput").value || "";
  if($("preset")) row.preset = $("preset").value || "";

  return row;
}
function renderLocalExport(){
  const page = getActiveExperimentName();
  const logs = localPageLogs[page] || [];
  document.querySelectorAll(".localExportCard").forEach(card=>{
    const head = card.querySelector(".localHead");
    const body = card.querySelector(".localBody");
    if(!head || !body) return;
    head.innerHTML = "";
    body.innerHTML = "";
    const keys = Array.from(new Set(logs.flatMap(r=>Object.keys(r))));
    keys.forEach(k=>{
      const th = document.createElement("th");
      th.textContent = k;
      head.appendChild(th);
    });
    logs.forEach(r=>{
      const tr = document.createElement("tr");
      keys.forEach(k=>{
        const td = document.createElement("td");
        td.textContent = r[k] ?? "";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  });
}
function captureLocalPageData(){
  const page = getActiveExperimentName();
  localPageLogs[page] ??= [];
  localPageLogs[page].push(getLocalPageSnapshot());
  renderLocalExport();
}
function downloadLocalPageCsv(){
  const page = getActiveExperimentName();
  const logs = localPageLogs[page] || [];
  const keys = Array.from(new Set(logs.flatMap(r=>Object.keys(r))));
  if(!logs.length){
    alert("ยังไม่มีข้อมูลที่บันทึกในหน้านี้");
    return;
  }
  const csv = [keys, ...logs.map(r=>keys.map(k=>r[k] ?? ""))]
    .map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = makeTopicFileName("Data", "csv");
  a.click();
  URL.revokeObjectURL(url);
}
function clearLocalPageData(){
  const page = getActiveExperimentName();
  localPageLogs[page] = [];
  renderLocalExport();
}
function initLocalExportCards(){
  document.querySelectorAll(".localCaptureBtn").forEach(btn=>btn.onclick=captureLocalPageData);
  document.querySelectorAll(".localDownloadBtn").forEach(btn=>btn.onclick=downloadLocalPageCsv);
  document.querySelectorAll(".localClearBtn").forEach(btn=>btn.onclick=clearLocalPageData);
  renderLocalExport();
}



/* v5.14: redraw after orientation change to keep display consistent */
function refreshAfterOrientationChange(){
  setTimeout(()=>{
    if(typeof resizeVisualizerCanvas === "function") resizeVisualizerCanvas();
    if(typeof drawVisualizer === "function") drawVisualizer();
    if(typeof drawBeat === "function") drawBeat();
    if(typeof drawResonance === "function") drawResonance();
    document.querySelectorAll("canvas").forEach(c=>{
      c.style.width = "100%";
    });
  }, 250);
}
window.addEventListener("orientationchange", refreshAfterOrientationChange);
window.addEventListener("resize", refreshAfterOrientationChange);



/* v5.21 resize visualizer canvas for portrait/landscape */
function resizeVisualizerCanvas(){
  const canvas = $("visualizerCanvas");
  if(!canvas) return;

  const container = canvas.parentElement;
  if(!container) return;

  const rect = container.getBoundingClientRect();
  const cssW = Math.max(280, Math.floor(rect.width - 4));
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;
  const isLongitudinal = !!document.querySelector(".visualizerSinglePage[data-viz-mode='longitudinal']");
  const isDisplacementPressure = !!document.querySelector(".visualizerSinglePage[data-viz-mode='displacementPressure']");
  const isSpeedSound = !!document.querySelector(".visualizerSinglePage[data-viz-mode='speedSound']");
  const isSoundTopic = !!document.querySelector('.visualizerSinglePage.soundTopicPage');

  let cssH;
  if(isLongitudinal || isDisplacementPressure || isSpeedSound || isSoundTopic){
    // v5.88: allow more vertical room on phones so the graph can visibly fill the slot.
    const vh = Math.max(640, window.innerHeight || 800);
    cssH = isLandscape ? Math.round(Math.min(vh * 0.66, cssW * 0.58)) : Math.round(vh * 0.52);
    cssH = Math.max(isLandscape ? 280 : 430, Math.min(cssH, isLandscape ? 420 : 620));
  }else{
    cssH = isLandscape ? Math.round(cssW * 0.42) : Math.round(cssW * 0.54);
    cssH = Math.max(isLandscape ? 180 : 220, Math.min(cssH, isLandscape ? 235 : 320));
  }

  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
}

window.addEventListener("load", ()=>{ if(typeof resizeVisualizerCanvas === "function") resizeVisualizerCanvas(); });
