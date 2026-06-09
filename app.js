
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
function downloadCsv(){const csv=[exportCols.map(c=>colNames[c]),...logs.map(r=>exportCols.map(c=>r[c]??""))].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="PhySound_AcousticsPro_Data.csv";a.click();URL.revokeObjectURL(url);}

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
  a.download = 'PhySound_Raw_Data.xls';
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
function saveGraphs(){["scope","spectrum","spectrogram","history"].forEach(n=>{const c=canvases[n];if(!c)return;const a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=`PhySound_${n}.png`;a.click();});}
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
  const lambda=v/f;
  if($("vizFreqOut")) $("vizFreqOut").textContent=f.toFixed(0)+" Hz";
  if($("vizAmpOut")) $("vizAmpOut").textContent=A.toFixed(2);
  if($("vizSpeedOut")) $("vizSpeedOut").textContent=v.toFixed(0)+" m/s";
  if($("vizLambdaOut")) $("vizLambdaOut").textContent=lambda.toFixed(2)+" m";
  if($("vizFreqLabel")) $("vizFreqLabel").textContent=f.toFixed(0)+" Hz";
  if($("vizAmpLabel")) $("vizAmpLabel").textContent=A.toFixed(2);
  if($("vizSpeedLabel")) $("vizSpeedLabel").textContent=v.toFixed(0)+" m/s";
  if($("vizTimeLabel")) $("vizTimeLabel").textContent=speed.toFixed(1)+"×";
  return {f,A,v,speed,lambda,sub:$("vizSubMode")?.value||"closed"};
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

function drawLongitudinalFinal(ctx, c, p, w, h){
  ctx.clearRect(0,0,w,h);

  // Background
  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,"#020817");
  bg.addColorStop(1,"#08152b");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,w,h);

  // Subtle grid
  ctx.strokeStyle="rgba(148,163,184,.10)";
  ctx.lineWidth=1;
  for(let x=0;x<w;x+=80){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let y=0;y<h;y+=60){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  const pad = 46;
  const eqX = w * 0.50;

  // Particle band is above x-axis, compact and close to design mockup.
  const rows = 4;
  const rowGap = 16;
  const particleRadius = 6.8;
  const y0 = h * 0.47;
  const axisY = Math.min(h - 78, y0 + rowGap * 3 + 72);
  const xMin = pad + 32;
  const xMax = w - pad - 54;

  const ampPx = 18 + (18 * p.A);      // visual max displacement, fixed A marker uses this
  const currentAmpPx = 18 * p.A;      // moving particle field
  const baseGap = 28;
  const k = 2 * Math.PI / 280;
  const phase = vizState.t * 0.105 * p.speed;

  const obsRow = 1;
  const obsBaseX = eqX; // reference particle starts at the equilibrium position
  let obsX = obsBaseX;
  let obsY = y0 + obsRow * rowGap;

  // Decorative compression/rarefaction bands: subtle, not a legend.
  const bandCenters=[xMin+70,xMin+245,xMin+420,xMin+600,xMin+780];
  bandCenters.forEach((bx,i)=>{
    const g=ctx.createLinearGradient(bx-52,0,bx+52,0);
    const col=i%2===0?"rgba(34,211,238,.12)":"rgba(168,85,247,.12)";
    g.addColorStop(0,"rgba(0,0,0,0)");
    g.addColorStop(.5,col);
    g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g;
    ctx.fillRect(bx-58,118,116,255);
  });

  // Title label on canvas
  ctx.fillStyle="#cfe9ff";
  ctx.font="20px Sarabun, system-ui, sans-serif";
  ctx.textAlign="left";
  ctx.fillText("Longitudinal Wave (คลื่นตามยาว)", 24, 36);

  // Wave propagation arrow
  ctx.save();
  ctx.strokeStyle="rgba(34,211,238,.95)";
  ctx.fillStyle="rgba(34,211,238,.95)";
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(w*0.30,84);
  ctx.lineTo(w*0.72,84);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w*0.72,84);
  ctx.lineTo(w*0.70,72);
  ctx.lineTo(w*0.70,96);
  ctx.closePath();
  ctx.fill();
  ctx.font="bold 17px Sarabun, system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.fillText("ทิศทางการเคลื่อนที่ของคลื่น", w*0.51, 62);
  ctx.restore();

  // Equilibrium line and label
  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,.72)";
  ctx.setLineDash([8,8]);
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(eqX, y0 - 78);
  ctx.lineTo(eqX, y0 + rowGap*3 + 26);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle="rgba(255,255,255,.95)";
  ctx.textAlign="center";
  ctx.font="16px Sarabun, system-ui, sans-serif";
  ctx.fillText("ตำแหน่งสมดุล", eqX, y0 - 78);
  ctx.restore();


  // x-axis: no numbers, no lambda
  ctx.save();
  ctx.strokeStyle="rgba(255,245,220,.92)";
  ctx.fillStyle="rgba(255,255,255,.92)";
  ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(pad+25, axisY);
  ctx.lineTo(w-pad-10, axisY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w-pad-10, axisY);
  ctx.lineTo(w-pad-22, axisY-8);
  ctx.moveTo(w-pad-10, axisY);
  ctx.lineTo(w-pad-22, axisY+8);
  ctx.stroke();
  for(let i=0;i<7;i++){
    const tx=pad+70+i*((w-2*pad-150)/6);
    ctx.beginPath();
    ctx.moveTo(tx,axisY-10);
    ctx.lineTo(tx,axisY+10);
    ctx.stroke();
  }
  ctx.font="22px Sarabun, system-ui, sans-serif";
  ctx.fillText("x", w-pad-4, axisY+28);
  ctx.restore();

  // Particles: 4 compact rows, longitudinal spacing changes across x.
  const baseXs=[];
  for(let x=xMin;x<=xMax;x+=baseGap) baseXs.push(x);
  // Ensure the reference particle is anchored on the exact equilibrium position.
  // Without this, the nearest particle could be selected, causing the red point
  // to miss the equilibrium line after reset.
  if(!baseXs.some(v => Math.abs(v - eqX) < 0.5)) baseXs.push(eqX);
  baseXs.sort((a,b)=>a-b);

  for(let row=0; row<rows; row++){
    const y = y0 + row*rowGap;
    for(let i=0;i<baseXs.length;i++){
      const base=baseXs[i];
      const disp=currentAmpPx*Math.sin(k*(base-eqX)-phase);
      const x=base+disp;
      const isObs = row===obsRow && Math.abs(base-obsBaseX) < 0.5;
      if(isObs){
        obsX=x;
        obsY=y;
        continue;
      }

      drawParticleShadow(ctx,x,y,particleRadius);
      drawParticleSphere(ctx,x,y,particleRadius,"cyan");
    }
  }

  // Draw the observation particle last so it stays a full red circle with no blue overlap.
  ctx.save();
  const obsRadius = particleRadius + 1.8;
  drawParticleShadow(ctx,obsX,obsY,obsRadius);
  drawParticleSphere(ctx,obsX,obsY,obsRadius,"red");
  ctx.restore();

  // No legend dots under x-axis in this final visual.
}


function drawVizLegend(ctx,c){
  // legend hidden on longitudinal focus page to keep the graph clean
}

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
  ["vizFreq","vizAmp","vizSpeed","vizTimeSpeed","vizSubMode"].forEach(id=>$(id)?.addEventListener("input",getVizParams));
  $("vizPlayBtn").onclick=()=>{vizState.running=true;updateVizPlayerButtons("play");};
  $("vizPauseBtn").onclick=()=>{vizState.running=false;updateVizPlayerButtons("pause");};
  $("vizResetBtn").onclick=()=>{vizState.t=0;updateVizPlayerButtons("reset");};
  $("vizExportBtn").onclick=()=>{
    const c=$("visualizerCanvas");
    const a=document.createElement("a");
    a.href=c.toDataURL("image/png");
    a.download="MelodyLab_Wave_Visualizer.png";
    a.click();
  };
  if(vizState.raf) cancelAnimationFrame(vizState.raf);
  updateVizPlayerButtons();
  drawVisualizer();
}

function init(){fillBrowserInfo();initVisualizer();initLocalExportCards();Object.entries(ctxs).forEach(([n,ctx])=>drawGrid(ctx,canvases[n]));drawBeat();drawResonance();renderColumnToggles();readConfig();loadSettings();renderLog();$("startMic").onclick=startMic;$("stopMic").onclick=stopMic;$("captureBtn").onclick=capture;$("downloadBtn").onclick=downloadCsv;$("downloadExcelBtn").onclick=downloadExcel;if($("captureCalBtn"))$("captureCalBtn").onclick=captureCalibration;if($("downloadCalBtn"))$("downloadCalBtn").onclick=downloadCalibrationCsv;if($("applyDbCalBtn"))$("applyDbCalBtn").onclick=applyDbCalibration;if($("playCalTone"))$("playCalTone").onclick=()=>{$("toneFreq").value=440;playTone();};if($("stopCalTone"))$("stopCalTone").onclick=stopTone;$("clearBtn").onclick=()=>{logs=[];renderLog();};$("autoLogBtn").onclick=toggleAutoLog;$("preset").onchange=()=>{applyPreset();};if($("userMode")) $("userMode").onchange=applyMode;$("freezeBtn").onclick=()=>{frozen=!frozen;$("freezeBtn").textContent=frozen?"Unfreeze Graph":"Freeze Graph";};$("resetPeakBtn").onclick=()=>{peakHold=[];};$("saveGraphsBtn").onclick=saveGraphs;$("saveSettingsBtn").onclick=saveSettings;$("resetSettingsBtn").onclick=resetSettings;$("configLinkBtn").onclick=copyConfig;$("playTone").onclick=playTone;$("stopTone").onclick=stopTone;$("playNoise").onclick=playNoise;$("stopNoise").onclick=stopNoise;$("playBeat").onclick=playBeat;$("stopBeat").onclick=stopBeat;["beatF1","beatF2","beatVol"].forEach(id=>$(id).addEventListener("input",()=>{if(beatOsc1)beatOsc1.frequency.value=Number($("beatF1").value||440);if(beatOsc2)beatOsc2.frequency.value=Number($("beatF2").value||444);if(beatGain)beatGain.gain.value=Number($("beatVol").value||.06);drawBeat();}));["resV","resL","resMode"].forEach(id=>$(id).addEventListener("input",drawResonance));["toneFreq","toneVol","toneType"].forEach(id=>$(id).addEventListener("input",()=>{if(toneOsc)toneOsc.frequency.value=Number($("toneFreq").value||440);if(toneGain)toneGain.gain.value=Number($("toneVol").value||.06);if(toneOsc)toneOsc.type=$("toneType").value;}));$("noiseVol").addEventListener("input",()=>{if(noiseGain)noiseGain.gain.value=Number($("noiseVol").value||.03);});if("serviceWorker"in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}}
document.addEventListener("DOMContentLoaded",init);


/* v5.10 local export per experiment page */
const localPageLogs = {};
function getActiveExperimentName(){
  const card = document.querySelector(".localExportCard[data-export-name]");
  if(card?.dataset?.exportName) return card.dataset.exportName;
  const main = document.querySelector("main.detailMain");
  if(main?.dataset?.current) return main.dataset.current;
  const sec = document.querySelector("section.activeDetail");
  if(sec?.id) return sec.id;
  return document.title || "experiment";
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
  if($("vizSubMode")) row.parameter_mode = $("vizSubMode").value || "";
  if($("vizFreqLabel")) row.frequency_display = $("vizFreqLabel").textContent || "";
  if($("vizAmpLabel")) row.amplitude_display = $("vizAmpLabel").textContent || "";
  if($("vizSpeedLabel")) row.wave_speed_display = $("vizSpeedLabel").textContent || "";
  if($("vizTimeLabel")) row.time_speed_display = $("vizTimeLabel").textContent || "";
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
  a.download = `MelodyLab_${String(page).replaceAll(" ","_")}_Data.csv`;
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
  let cssW = Math.max(280, Math.floor(rect.width - 4));
  const isLandscape = window.matchMedia("(orientation: landscape)").matches;

  let cssH = isLandscape ? Math.round(cssW * 0.42) : Math.round(cssW * 0.54);
  cssH = Math.max(isLandscape ? 180 : 220, Math.min(cssH, isLandscape ? 235 : 320));

  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
}


window.addEventListener("load", ()=>{ if(typeof resizeVisualizerCanvas === "function") resizeVisualizerCanvas(); });
