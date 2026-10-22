// Local DEV capture only. Captures the live WebGL render and visible ritual UI.
export function installRecorder(world){
 const out=document.createElement('canvas');out.width=innerWidth;out.height=innerHeight;const ctx=out.getContext('2d'),chunks=[];let recording=false,started=0;
 const recorder=new MediaRecorder(out.captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:5000000});
 const control=document.createElement('button');control.id='qa-record';control.textContent='RECORD VISIT';control.style.cssText='position:fixed;top:10px;left:10px;z-index:100';document.body.append(control);
 const data=document.createElement('pre');data.id='recording-data';data.hidden=true;document.body.append(data);
 function opacity(el){let a=1;while(el?.nodeType===1){const s=getComputedStyle(el);if(el.hidden||s.display==='none'||s.visibility==='hidden')return 0;a*=Number(s.opacity);el=el.parentElement;}return a;}
 function visible(el){return opacity(el)>.01;}
 function box(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);ctx.fillStyle=s.backgroundColor;ctx.fillRect(r.x,r.y,r.width,r.height);if(s.borderStyle==='solid'){ctx.strokeStyle=s.borderColor;ctx.lineWidth=1;ctx.strokeRect(r.x,r.y,r.width,r.height);}return r;}
 function text(el){if(!visible(el))return;const r=el.getBoundingClientRect(),s=getComputedStyle(el);ctx.save();ctx.globalAlpha=opacity(el);ctx.font=`${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;ctx.fillStyle=s.color;ctx.textAlign=s.textAlign==='center'?'center':'left';ctx.textBaseline='middle';ctx.fillText(el.textContent.trim(),s.textAlign==='center'?r.x+r.width/2:r.x,r.y+r.height/2,r.width);ctx.restore();}
 function frame(){requestAnimationFrame(frame);if(!recording)return;ctx.clearRect(0,0,out.width,out.height);ctx.drawImage(world,0,0,out.width,out.height);
 const curtain=document.getElementById('curtain');if(visible(curtain)){for(const el of curtain.querySelectorAll('.left,.right'))box(el);for(const el of curtain.querySelectorAll('p,small'))text(el);}
 for(const id of ['writing','placement-ui']){const el=document.getElementById(id);if(visible(el)){box(el);if(id==='writing'){box(document.getElementById('mark-form'));const d=document.getElementById('drawing-surface'),r=box(d);ctx.drawImage(d,r.x,r.y,r.width,r.height);}}}
 for(const id of ['enter','prompt','clear-drawing','done-drawing','cancel','place-mark','move-mark','cancel-placement']){const el=document.getElementById(id);if(visible(el)){box(el);text(el);}}
 for(const id of ['drawing-title','form-error','mark-consent','placement-help','message','hint','look-hint','stone-clock','loading'])text(document.getElementById(id));
 for(const id of ['mark-angle','mark-size']){const el=document.getElementById(id);if(visible(el)){const r=el.getBoundingClientRect();ctx.fillStyle='#777';ctx.fillRect(r.x,r.y+r.height/2,r.width,2);ctx.fillStyle='#bbb';ctx.beginPath();ctx.arc(r.x+(el.value-el.min)/(el.max-el.min)*r.width,r.y+r.height/2,6,0,Math.PI*2);ctx.fill();}}
 }
 requestAnimationFrame(frame);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{const reader=new FileReader();reader.onload=()=>{data.textContent=reader.result.split(',')[1];data.dataset.duration=((performance.now()-started)/1000).toFixed(2);control.textContent='VISIT SAVED';};reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};
 control.onclick=()=>{if(recording){recording=false;recorder.stop();return;}chunks.length=0;started=performance.now();recording=true;recorder.start(1000);control.textContent='STOP RECORDING';const curtain=document.getElementById('curtain'),parts=[...curtain.querySelectorAll('.left,.right,#hero')];for(const el of parts)el.style.transition='none';curtain.classList.remove('opened');void curtain.offsetWidth;requestAnimationFrame(()=>{for(const el of parts)el.style.transition='';});setTimeout(()=>curtain.classList.add('opened'),1000);};
}
