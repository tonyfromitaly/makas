// Raw normalized points are retained; smoothing is only a rendering operation.
export function renderDrawing(ctx,drawing,width,height,strokeScale=1){
 ctx.clearRect(0,0,width,height);ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';
 for(const stroke of drawing.strokes){const raw=stroke.points,hasPressure=raw.some(p=>p.pressure>0);
  const points=raw.map((p,i)=>{const a=raw[i-1],b=raw[i+1];if(!a||!b)return p;const ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y,lu=Math.hypot(ux,uy),lv=Math.hypot(vx,vy);if(lu>.02||lv>.02||lu*lv===0||(ux*vx+uy*vy)/(lu*lv)<.8)return p;return {...p,x:p.x*.8+(a.x+b.x)*.1,y:p.y*.8+(a.y+b.y)*.1};});
  const thickness=p=>height*.010*strokeScale*(p.pressure===null||!hasPressure?1:.65+.7*p.pressure);
  if(points.length===1){const p=points[0];ctx.beginPath();ctx.arc(p.x*width,p.y*height,thickness(p)/2,0,Math.PI*2);ctx.fill();}
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];ctx.lineWidth=(thickness(a)+thickness(b))/2;ctx.beginPath();ctx.moveTo(a.x*width,a.y*height);ctx.lineTo(b.x*width,b.y*height);ctx.stroke();}
 }
}
export class DrawingSurface{
 constructor(canvas,onChange){this.canvas=canvas;this.onChange=onChange;this.ctx=canvas.getContext('2d');canvas.width=1024;canvas.height=512;this.clear();
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(this.active!==null||e.button!==0||this.data.strokes.length>=128||this.data.strokes.reduce((n,s)=>n+s.points.length,0)>=8000)return;e.preventDefault();this.active=e.pointerId;canvas.setPointerCapture(e.pointerId);this.current={pointerType:e.pointerType||'unknown',points:[]};this.data.strokes.push(this.current);this.capture(e);});
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==this.active)return;e.preventDefault();for(const sample of (e.getCoalescedEvents?.()?.length?e.getCoalescedEvents():[e]))this.capture(sample);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(e.pointerId!==this.active)return;if(type==='pointerup')this.capture(e);this.active=null;this.current=null;this.paint();});
  addEventListener('resize',()=>this.paint());
 }
 clear(){this.active=null;this.current=null;this.start=performance.now();this.lastTime=0;this.data={version:1,aspect:2,strokes:[]};this.paint();}
 capture(e){const count=this.data.strokes.reduce((n,s)=>n+s.points.length,0);if(count>=8000||this.data.strokes.length>128){this.active=null;this.onChange?.('The surface is full. Clear to begin again.');return;}const r=this.canvas.getBoundingClientRect(),p={x:Math.max(0,Math.min(1,(e.clientX-r.x)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.y)/r.height)),pressure:e.pointerType==='mouse'||!Number.isFinite(e.pressure)?null:Math.max(0,Math.min(1,e.pressure)),t:Math.max(this.lastTime||0,(Number.isFinite(e.timeStamp)&&e.timeStamp<1e12?e.timeStamp:performance.now())-this.start)};this.lastTime=p.t;this.current.points.push(p);if(!this.queued){this.queued=true;requestAnimationFrame(()=>{this.queued=false;this.paint();});}}
 paint(){renderDrawing(this.ctx,this.data,1024,512);this.onChange?.();}
 snapshot(){if(!this.data.strokes.some(s=>s.points.length))throw new Error('Draw your mark first.');return structuredClone(this.data);}
}
