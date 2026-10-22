import {createHabitat} from './assets/habitat.js?v=habitat-5';
import LunarCalendar from './assets/lunar-calendar.js';
import {weatherAt,weatherPreview,galaxyShader} from './assets/atmosphere.js?v=habitat-5';

import {seasonAt,easeSeason,cloudShader} from './assets/seasons.js?v=habitat-5';
import {quality,stoneMaterial,terrainMaterial,grassField,textureBytes,seasonalUniforms,stoneLightUniforms} from './assets/material-world.js?v=habitat-5';
import * as THREE from 'three';
import {EntryMotion} from './assets/entry-motion.js?v=island-controls-2';
import {audioCue,updateWind,updateWeatherAudio,audioState} from './audio.js?v=habitat-5';
import {WALK,terrainSampler} from './walk.js?v=island-controls-2';
import {makeInscription,disposeInscription} from './inscription.js?v=island-controls-2';
import {DrawingSurface} from './drawing.js?v=island-controls-2';
import {Navigation} from './navigation.js?v=habitat-5';
import {Placement} from './placement.js?v=island-controls-2';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {syncWorld,world,stoneHour,stoneClock,canonicalDate} from './clock.js';
import {lightingAt,celestialPose,solarPose,SOLAR,lunarPose,LUNAR} from './time.js?v=island-controls-2';
let climateReceived=0;
let weatherOverride='AUTO',habitat=null;
let seasonOverride='AUTO',seasonState=null,seasonManual={},seasonDt=.016;
const $=id=>document.getElementById(id),canvas=$('world');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:false});
renderer.setPixelRatio(quality().dpr);renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=.79;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const gpuGL=renderer.getContext(),gpuExt=gpuGL.getExtension('EXT_disjoint_timer_query_webgl2');let gpuQuery=null,gpuFrameMs=null,gpuCounter=0;const gpuSamples=[];let renderSubmitMs=0;let grass=null,grassBudget=quality().grass;const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.05,12000);
camera.position.set(0,1.3,10);camera.lookAt(0,1.3,0);
const entryMotion=new EntryMotion();let entryMotionSeen=false;let sampleGround,stone,placement,writing=false,entered=false,previousTime=performance.now(),serverReady=false,visitor={used:false},marks=[];
const markMeshes=new Map();
const uiEvents=[];function uiEvent(type,detail={}){if(debugEnabled){uiEvents.push({type,...detail,t:performance.now(),entered:nav?.entered});if(uiEvents.length>30)uiEvents.shift();}}
const nav=new Navigation(camera,canvas,{blocked:()=>true,placementSelecting:()=>Boolean(placement?.active&&placement?.moving),onSelect:(x,y)=>placement?.move(x,y),onSelected:()=>placement?.select(),onInteract:(x,y)=>{if(!stone||!nearStone())return;const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();if(document.pointerLockElement===canvas){x=r.x+r.width/2;y=r.y+r.height/2;}ray.setFromCamera(new THREE.Vector2((x-r.x)/r.width*2-1,-(y-r.y)/r.height*2+1),camera);if(ray.intersectObject(stone,false).length)openWriting();},onPause:()=>{entered=false;$('enter').hidden=false;}});
// The debug panel and test hour exist only when the server itself runs in development mode.
const introLoadStarted=0;const introFontReady=document.fonts.load('300 32px "Cormorant Garamond"').then(()=>performance.now());let introTrace={fontReady:0,revealStart:0,revealEnd:0,firstRender:0,samples:[]},round3Qa=false;let revealComplete=false,noticeTimer,noticeFadeTimer;function clockNotice(text,duration=6000){const notice=$('clock-notice');notice.textContent=stoneClock()+' · '+text;notice.dataset.started=performance.now();notice.dataset.duration=duration;document.body.classList.remove('notice-fading');document.body.classList.add('notice-active');clearTimeout(noticeTimer);clearTimeout(noticeFadeTimer);noticeFadeTimer=setTimeout(()=>document.body.classList.add('notice-fading'),duration-500);noticeTimer=setTimeout(()=>{document.body.classList.remove('notice-active','notice-fading');notice.textContent='';},duration);}
let reviewEnabled=false;let debugEnabled=false;$('debug-toggle').hidden=true;
// An invitation from the site's assistant: handed over in the URL fragment or by the embedding page.
let grant=null;try{grant=sessionStorage.getItem('stone-grant');}catch(e){}
function setGrant(token){if(typeof token!=='string'||!token||token.length>2000)return;grant=token;try{sessionStorage.setItem('stone-grant',token);}catch(e){}if(ready)syncMarks();}
// (At load the scene is not ready yet, so the token is only kept; the first sync sends it.)
{const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('grant');if(token&&token.length<=2000){grant=token;try{sessionStorage.setItem('stone-grant',token);}catch(e){}history.replaceState(null,'',location.pathname+location.search);}}
// The embedding site hears what happens at the stone; only the origins the server names are spoken to or listened to.
function notify(type,detail={}){if(parent===window)return;for(const origin of world()?.embedOrigins||[])parent.postMessage({source:'mona-mile-stone',type,...detail},origin);}
addEventListener('message',e=>{if((world()?.embedOrigins||[]).includes(e.origin)&&e.data?.type==='stone:grant')setGrant(e.data.grant);});
function resetPosition(){if(sampleGround)nav.reset(sampleGround);}
function nearStone(){return ready&&Math.hypot(camera.position.x,camera.position.z)<=(nav.mobile?2.05:WALK.interactionRadius);}
async function request(path,options){const response=await fetch(path,{cache:'no-store',...options}),data=await response.json();if(!response.ok){const e=new Error(data.error||'The stone cannot save this mark right now.');e.code=data.code;throw e;}return data;}
function renderMarks(records){marks=records;const ids=new Set(records.map(m=>m.id));for(const [id,mesh] of markMeshes)if(!ids.has(id)){disposeInscription(mesh);markMeshes.delete(id);}for(const record of records){if(!markMeshes.has(record.id)){const mesh=makeInscription(stone,record);scene.add(mesh);markMeshes.set(record.id,mesh);}
  // An intent mark weathers with the season; a journey mark is cut deep and stays.
  const material=markMeshes.get(record.id).material,journey=record.kind==='journey';const renderedWear=debugEnabled&&new URLSearchParams(location.search).has('wearProof')?Math.max(0,Math.min(1,Number(new URLSearchParams(location.search).get('wearProof')))):(record.wear||0);material.userData.cutUniforms.wear.value=journey?0:renderedWear;material.opacity=journey?.97:.96*(1-.74*renderedWear);material.normalScale.setScalar(journey?1.3:1.05*(1-.5*renderedWear));}}
let syncing=false;
async function syncMarks(){if(syncing||!stone)return;syncing=true;try{const [data,status]=await Promise.all([request('api/inscriptions'),request('api/visitor'+(debugEnabled?'?debug=1':''),grant?{headers:{'X-Stone-Grant':grant}}:{})]);renderMarks(data.inscriptions);visitor=status;serverReady=true;}catch(e){serverReady=false;clockNotice('marks unavailable');}finally{syncing=false;}}
// Banner is read-only: no inscription or visitor synchronization.
const drawingSurface=new DrawingSurface($('drawing-surface'),message=>{if(message)clockNotice('draw a mark');});
let walkCueSeen=false,walkCueTimer,walkCueCamera,walkCueRotation;
try{walkCueSeen=localStorage.getItem('mona-walk-cue')==='1';}catch(e){}
function dismissWalkCue(){if($('walk-cue').hidden)return;$('walk-cue').classList.add('fading');clearTimeout(walkCueTimer);setTimeout(()=>$('walk-cue').hidden=true,300);}
function showWalkCue(){if(walkCueSeen)return;walkCueSeen=true;try{localStorage.setItem('mona-walk-cue','1');}catch(e){}$('walk-cue').textContent=nav.mobile?'drag · look':'W A S D · walk';$('walk-cue').hidden=false;walkCueCamera=camera.position.clone();walkCueRotation=camera.rotation.clone();walkCueTimer=setTimeout(dismissWalkCue,8000);}
function enter(){if(!revealComplete)return;uiEvent('enter');audioCue('enter');entered=true;nav.enter();if(!entryMotionSeen){entryMotionSeen=true;entryMotion.begin(camera,nav,matchMedia('(prefers-reduced-motion: reduce)').matches);} $('enter').hidden=true;showWalkCue();}
function openWriting(){if(!revealComplete||!nearStone()||!serverReady)return;if(visitor.used){clockNotice('mark already here');return;}if(!visitor.canMark){clockNotice('invitation required');notify('stone:needs-grant');return;}audioCue('stone-interaction');writing=true;nav.clear();document.exitPointerLock?.();$('form-error').textContent='';drawingSurface.clear();$('writing').hidden=false;document.body.classList.add('writing');}
// Keep the approached valid face when returning from drawing to placement.
function frameInscriptionSurface(){
 nav.clear();const local=stone.worldToLocal(camera.position.clone()),side=Math.abs(local.x)>Math.abs(local.z),sign=local.x<0?-1:1;camera.position.copy(stone.localToWorld(new THREE.Vector3(...(side?[sign*1.65,1.42,0]:[0,1.42,1.85]))));
 if(sampleGround)camera.position.y=(sampleGround(camera.position.x,camera.position.z)??0)+WALK.eyeHeight;
 camera.lookAt(stone.localToWorld(new THREE.Vector3(...(side?[sign*.27,1.18,0]:[0,1.18,.17]))));
 const target=stone.localToWorld(new THREE.Vector3(...(side?[sign*.27,1.18,0]:[0,1.18,.17])));
 nav.yaw=nav.targetYaw=Math.atan2(camera.position.x-target.x,camera.position.z-target.z);nav.pitch=nav.targetPitch=Math.atan2(target.y-camera.position.y,Math.hypot(target.x-camera.position.x,target.z-camera.position.z));
 camera.updateMatrixWorld(true);
}
function closeWriting(){writing=false;$('writing').hidden=true;document.body.classList.remove('writing');nav.clear();}
function cancelPlacement(){placement?.cancel();$('placement-ui').hidden=true;document.body.classList.remove('placing');nav.clear();}
$('enter').onclick=enter;$('prompt').onclick=openWriting;$('cancel').onclick=closeWriting;
$('clear-drawing').onclick=()=>{drawingSurface.clear();$('form-error').textContent='Draw slowly, as if signing stone.';};
$('done-drawing').onclick=()=>{try{const drawing=drawingSurface.snapshot();closeWriting();frameInscriptionSurface();placement.begin(drawing);$('mark-angle').value='0';$('mark-size').value='112';document.body.classList.add('placing');$('placement-ui').hidden=false;}catch(error){clockNotice('draw a mark');}};
for(const id of ['mark-angle','mark-size'])$(id).oninput=()=>placement?.adjust(Number($('mark-angle').value)*Math.PI/180,Number($('mark-size').value)/100);
$('move-mark').onclick=()=>{placement.moving=true;placement.reason='Move the mark onto the stone. Lift or click to choose.';};$('cancel-placement').onclick=cancelPlacement;
let saving=false;
$('place-mark').onclick=async()=>{if(saving||!placement?.valid||!placement.candidate)return;saving=true;const chosen=structuredClone(placement.candidate);try{const data=await request('api/inscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(grant?{...chosen,grant}:chosen)});renderMarks([...marks,data.inscription]);visitor={...visitor,used:true,markId:data.inscription.id};cancelPlacement();audioCue('inscription');const fresh=markMeshes.get(data.inscription.id);if(fresh){fresh.material.userData.cutUniforms.flash.value=1;fresh.material.userData.flashStarted=performance.now();}clockNotice('mark '+marks.length);notify('stone:mark-placed',{id:data.inscription.id,stoneHour:data.inscription.stoneHour});await syncMarks();}catch(error){clockNotice('mark not saved');placement.reason=error.message;if(error.code==='DUPLICATE'){visitor.used=true;cancelPlacement();clockNotice('mark already here');await syncMarks();}else if(error.code==='GRANT_REQUIRED'||error.code==='GRANT'||error.code==='GRANT_EXPIRED'){grant=null;try{sessionStorage.removeItem('stone-grant');}catch(e){}cancelPlacement();clockNotice('mark not saved');notify('stone:needs-grant');await syncMarks();}else if(error.code==='OVERLAP'){placement.valid=false;placement.material.opacity=.16;await syncMarks();}}finally{saving=false;}};
addEventListener('keydown',e=>{uiEvent('key',{code:e.code,locked:document.pointerLockElement===canvas});if(e.code==='Escape'){if(writing){closeWriting();return;}if(placement?.active){cancelPlacement();return;}entered=false;audioCue('pause');nav.pause();$('enter').hidden=!revealComplete;return;}if(e.code==='KeyE'&&!writing&&!placement?.active)openWriting();});
const skyUniforms={horizon:{value:new THREE.Color()},zenith:{value:new THREE.Color()},night:{value:0},sunDirection:{value:new THREE.Vector3()},sunRadius:{value:THREE.MathUtils.degToRad(SOLAR.angularDiameterDeg/2)},sunColor:{value:new THREE.Color()},sunVisibility:{value:0},sunGlow:{value:.03},moonDirection:{value:new THREE.Vector3()},moonRadius:{value:THREE.MathUtils.degToRad(LUNAR.angularDiameterDeg/2)},moonVisibility:{value:0},moonPhase:{value:0},moonIllumination:{value:0}};
const eventUniforms={dawnEvent:{value:0},sunsetEvent:{value:0}};
const climateUniforms={cloudCover:{value:.2},seasonWind:{value:.3},seasonTime:{value:0},mountainSnow:{value:.25},mountainVisibility:{value:1},atmosphereTime:{value:0},meteorProof:{value:0}};
Object.assign(skyUniforms,climateUniforms,eventUniforms);
const sky=new THREE.Mesh(new THREE.SphereGeometry(SOLAR.visualDistance,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:skyUniforms,
 vertexShader:'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`uniform float meteorProof,atmosphereTime,dawnEvent,sunsetEvent,cloudCover,seasonWind,seasonTime,mountainSnow,mountainVisibility;${cloudShader}
varying vec3 vDirection; uniform vec3 horizon,zenith,sunDirection,sunColor,moonDirection; uniform float night,sunRadius,sunVisibility,sunGlow,moonRadius,moonVisibility,moonPhase,moonIllumination;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

 float stellarNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);vec2 a=i.xy+i.z*vec2(17.,59.),b=a+vec2(17.,59.);float value=mix(mix(mix(hash(a),hash(a+vec2(1,0)),f.x),mix(hash(a+vec2(0,1)),hash(a+vec2(1,1)),f.x),f.y),mix(mix(hash(b),hash(b+vec2(1,0)),f.x),mix(hash(b+vec2(0,1)),hash(b+vec2(1,1)),f.x),f.y),f.z);return mix(value,.5,smoothstep(.8,1.8,length(fwidth(p))));}
 float stableStars(vec2 uv,float threshold,float radius2,float seed,vec2 pixel,float period){
  vec2 cell=floor(uv),f=fract(uv);float width2=radius2+dot(pixel,pixel)/12.,energy=radius2/width2,total=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 offset=vec2(float(x),float(y));vec2 delta=f-.5-offset;total+=step(threshold,hash(vec2(mod(cell.x+offset.x,period),cell.y+offset.y)+seed))*exp(-dot(delta,delta)/(2.*width2))*energy;}
  return total;
 }
 void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);float localCloud=cloudField(d);float t=1.-exp(-h*5.2);vec3 c=mix(horizon,zenith,t);float aerial=exp(-h*27.);c=mix(c,horizon,aerial*.07);
 float colorEvent=max(dawnEvent,sunsetEvent);vec3 warmAir=mix(vec3(.78,.47,.30),vec3(.74,.38,.24),sunsetEvent/(colorEvent+.0001));float solarAz=atan(sunDirection.x,-sunDirection.z);float viewAz=atan(d.x,-d.z);float deltaAz=atan(sin(viewAz-solarAz),cos(viewAz-solarAz));float towardSun=exp(-pow(deltaAz/.85,2.));float horizonWarm=exp(-h*12.)*(.24+.76*towardSun)*colorEvent;c=mix(c,vec3(.16,.28,.40),colorEvent*(1.-exp(-h*7.))*.55);c=mix(c,warmAir,horizonWarm*.94);
 if(night>.001){vec2 angularPixel=vec2((abs(d.z)*fwidth(d.x)+abs(d.x)*fwidth(d.z))/max(dot(d.xz,d.xz),.0001),fwidth(d.y)/max(sqrt(max(0.,1.-d.y*d.y)),.01));vec2 uv=vec2(atan(d.x,d.z)/6.28318530718+.5,asin(clamp(d.y,-1.,1.))/3.14159265359+.5)*vec2(1200.,565.);float star=stableStars(uv,.9935,.0169,0.,angularPixel*vec2(1200./6.28318530718,565./3.14159265359),1200.)*smoothstep(.03,.2,h);c+=vec3(.35,.42,.58)*star*night*(1.-localCloud*.97)*.85;
 ${galaxyShader}
 }
 // V05.1 temporary distant range, angular silhouette only; existing lighting untouched.
 float az=atan(d.x,-d.z),mountainHeight=0.;
 mountainHeight+=.012*exp(-pow((az+.27)/.12,2.));
 mountainHeight+=.025*exp(-pow((az+.12)/.065,2.));
 mountainHeight+=.017*exp(-pow((az-.045)/.09,2.));
 mountainHeight+=.021*exp(-pow((az-.19)/.075,2.));
 mountainHeight+=.010*exp(-pow((az-.31)/.085,2.));
 mountainHeight*=.95+.05*sin(az*145.)+.025*sin(az*311.);
 float rangeAA=max(fwidth(d.y),.00008),rangeMask=(1.-smoothstep(mountainHeight-rangeAA,mountainHeight+rangeAA,d.y))*smoothstep(-.012,-.008,d.y)*smoothstep(.001,.003,mountainHeight);
 float lowSun=1.-smoothstep(.03,.12,sunDirection.y),evening=step(0.,sunDirection.x);
 float rangeContrast=mix(.84,mix(.79,.87,evening),lowSun)*(1.-night)+.50*night;
 vec3 rangeBase=mix(vec3(.015,.033,.067),vec3(.006,.013,.026),night);
 vec3 rangeColor=mix(mix(horizon,vec3(.11,.18,.27),colorEvent*.60),rangeBase,clamp(rangeContrast*mountainVisibility,0.,.9));
 float snow=smoothstep(.011,.023,mountainHeight)*smoothstep(mountainHeight*mix(.90,.44,mountainSnow),mountainHeight*.94,d.y);
 snow*=.65+.35*sin(az*89.+d.y*1200.);
 vec3 snowTint=mix(vec3(.67,.71,.74),vec3(.17,.22,.29),night);
 snowTint=mix(snowTint,vec3(.66,.58,.46),colorEvent*.14);
 rangeColor=mix(rangeColor,horizon,(1.-smoothstep(0.,.018,d.y))*.28);
 rangeColor=mix(rangeColor,snowTint,snow*(.04+mountainSnow*.30+night*.045));
 float rim=exp(-pow((d.y-mountainHeight)/.00055,2.))*(1.-evening)*lowSun*(1.-night);
 rangeColor+=vec3(.013,.007,.003)*rim;

 float solarAngle=acos(clamp(dot(d,sunDirection),-1.,1.));float aa=max(fwidth(solarAngle)*.7,.00003)*(1.+(1.-smoothstep(0.,.055,sunDirection.y))*.65);
 float disk=1.-smoothstep(sunRadius-aa,sunRadius+aa,solarAngle);
 float halo=exp(-pow(solarAngle/.065,2.));
 c+=sunColor*sunVisibility*disk;c+=sunColor*halo*sunVisibility*sunGlow*.50;c+=warmAir*exp(-pow(solarAngle/.24,2.))*colorEvent*.070*(1.-smoothstep(.0,.23,h));
 vec3 moonRight=normalize(cross(moonDirection,vec3(0.,1.,0.)));vec3 moonUp=cross(moonRight,moonDirection);
 float moonFacing=dot(d,moonDirection);vec2 mq=vec2(dot(d,moonRight),dot(d,moonUp))/(max(moonFacing,.00001)*tan(moonRadius));
 float maa=max(fwidth(mq.y),.003);float moonOuter=1.-smoothstep(1.-maa,1.+maa,length(mq));
 float lunarZ=sqrt(max(0.,1.-dot(mq,mq)));float phaseAngle=moonPhase*6.2831853;vec3 phaseLight=vec3(sin(phaseAngle),0.,-cos(phaseAngle));float moonShade=dot(vec3(mq,lunarZ),phaseLight);float lunarLit=smoothstep(-.025,.025,moonShade)*moonOuter*step(0.,moonFacing);float lunarTexture=.88+.12*cloudNoise(mq*27.);c+=vec3(.78,.90,1.07)*lunarLit*lunarTexture*moonVisibility;
 float moonAngle=acos(clamp(dot(d,moonDirection),-1.,1.));c+=vec3(.08,.11,.16)*exp(-pow(moonAngle/.027,2.))*moonVisibility*(.18+.55*moonIllumination);
 gl_FragColor=vec4(c,1.);
 if(cloudCover>.0001){float cloudOpacity=localCloud;float shade=cloudNoise(d.xz*18.+seasonTime*.002);float facing=.5+.5*dot(normalize(d.xz),normalize(sunDirection.xz));float underside=exp(-h*2.4)*(.30+.70*facing)*(.40+.60*cloudOpacity);vec3 cloudLit=vec3(.53,.59,.63)*(.86+.14*shade);cloudLit*=mix(1.,.55,smoothstep(.55,.94,cloudCover));vec3 warmCloud=mix(warmAir,vec3(.58,.26,.23),sunsetEvent*.20);cloudLit=mix(cloudLit,warmCloud,colorEvent*underside*.94);cloudLit=mix(cloudLit,vec3(.025,.042,.066),night*(1.-colorEvent*.25));c=mix(c,cloudLit,cloudOpacity*mix(.72,.97,smoothstep(.45,.90,cloudCover)));}
 // Front-to-back sky composite: clouds/celestials are behind the exact approved ridge silhouette.
 c=mix(c,rangeColor,rangeMask);gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`}));sky.frustumCulled=false;scene.add(sky);
const mainLight=new THREE.DirectionalLight(0xffffff,2);mainLight.name='SUNLIGHT_SEPARATE_DIRECTIONAL';mainLight.castShadow=true;mainLight.shadow.mapSize.set(quality().shadow,quality().shadow);Object.assign(mainLight.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:80});mainLight.shadow.bias=-.0003;mainLight.shadow.normalBias=.0015;mainLight.shadow.radius=2;scene.add(mainLight);scene.add(mainLight.target);
const moonLight=new THREE.DirectionalLight(0x859fff,.4);moonLight.name='MOONLIGHT_SEPARATE_DIRECTIONAL';moonLight.castShadow=true;moonLight.shadow.mapSize.set(quality().tier!=='DESKTOP'?512:1024,quality().tier!=='DESKTOP'?512:1024);Object.assign(moonLight.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.1,far:45});moonLight.shadow.bias=-.0005;moonLight.shadow.normalBias=.002;scene.add(moonLight);scene.add(moonLight.target);
const ambient=new THREE.HemisphereLight(0xffffff,0x262921,.8);scene.add(ambient);
const mist=new THREE.FogExp2(0x9eafb4,.001);scene.fog=mist;
const seaUniforms={seaColor:{value:new THREE.Color()},skyColor:{value:new THREE.Color()},body:{value:new THREE.Vector3()},solarDirection:{value:new THREE.Vector3()},lunarDirection:{value:new THREE.Vector3()},clock:{value:0},reflection:{value:1},night:{value:0},storm:{value:0}};
const waterMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,uniforms:seaUniforms,
 vertexShader:'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}',
 fragmentShader:`varying vec3 vWorld; uniform vec3 seaColor,skyColor,body,solarDirection,lunarDirection; uniform float clock,reflection,night,storm;
 void main(){vec2 p=vWorld.xz;float dist=length(vWorld-cameraPosition);
 float phase1=p.x*.65+p.y*.38+clock*.12*(1.+storm*2.),phase2=p.y*1.15-p.x*.31-clock*.08*(1.+storm*2.);
 float band1=1.-smoothstep(.7,2.8,fwidth(phase1)),band2=1.-smoothstep(.6,2.,fwidth(phase2));
 float rip=sin(phase1)*band1*.6+sin(phase2)*band2*.4;float nearDetail=exp(-dist*.018);
 vec2 viewRay=normalize((vWorld-cameraPosition).xz),solarRay=normalize(solarDirection.xz),lunarRay=normalize(lunarDirection.xz);
 float solarOffset=acos(clamp(dot(viewRay,solarRay),-1.,1.)),moonOffset=acos(clamp(dot(viewRay,lunarRay),-1.,1.));
 float path=mix(exp(-pow(solarOffset/.044,2.)),exp(-pow(moonOffset/.024,2.)),night)*reflection;
 float stripe=.38+.62*smoothstep(-.25,.75,rip);vec3 c=mix(seaColor,skyColor,.045)+rip*(.005+storm*.012)*nearDetail*(1.-night*.6);
 float lowSolar=1.-smoothstep(.03,.17,solarDirection.y);vec3 reflectionTint=mix(vec3(.27,.29,.30),vec3(.65,.37,.17),lowSolar);float broken=.16+.84*smoothstep(.05,.70,rip);c+=mix(reflectionTint,vec3(.24,.30,.40),night)*path*broken*.70;
 c=mix(c,skyColor,smoothstep(55.,1500.,dist)*.18);gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
let adaptiveLevel=0,slowFrames=0;const frameTiming=[];
let model,sun,moon,override=null,ready=false,frames=0,fps=0,lastFps=performance.now(),latest={},cameraTravel=0,lastCamera=camera.position.clone();
const errors=[],history=[],solarSamples=[];let lastSolarSample=0;addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const loader=new GLTFLoader();
loader.load('./assets/stone_hour.glb?v=island-controls-2',async gltf=>{
 model=gltf.scene;scene.add(model);
 model.traverse(o=>{if(o.isMesh){o.castShadow=o.name==='THE_MILESTONE';o.receiveShadow=!o.name.includes('DISC')&&!o.name.includes('CRESCENT');o.material.side=THREE.DoubleSide;}});
 sun=model.getObjectByName('SUN_DISC');moon=model.getObjectByName('FIXED_SLIM_CRESCENT');
 // Keep source geometry in the untouched GLB, but never render its near-field sun mesh.
 sun.visible=false;sun.removeFromParent();moon.visible=false;moon.removeFromParent();
 for(const body of [sun,moon]){body.material=new THREE.MeshBasicMaterial({color:body===sun?0xffedd4:0xd7e4f8,side:THREE.DoubleSide,transparent:true,depthWrite:false});body.castShadow=false;body.receiveShadow=false;}
 model.getObjectByName('Sea').material=waterMaterial;
 const sourceCamera=gltf.cameras[0];// V02 uses a 40 degree walking lens; V01's orbit camera is preserved.
 stone=model.getObjectByName('THE_MILESTONE');const terrain=model.getObjectByName('Flat_headland_summit');sampleGround=terrainSampler(terrain.geometry);if(!stone.geometry.getAttribute('uv')){const p=stone.geometry.getAttribute('position'),uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=Math.atan2(p.getZ(i)/.18,p.getX(i)/.29)/(Math.PI*2)+.5;uv[i*2+1]=(p.getY(i)+.14)/2.14;}stone.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));}stone.material=stoneMaterial();terrain.material=terrainMaterial();const oldGrass=model.getObjectByName('Short_wind_bent_grass')||model.getObjectByName('Short wind bent grass');if(oldGrass)oldGrass.visible=false;grass=grassField(sampleGround,grassBudget=quality().grass);scene.add(grass.mesh);habitat=createHabitat(scene,sampleGround,nav.mobile);resetPosition();placement=new Placement(scene,camera,canvas,stone,()=>marks);const here=await syncWorld();round3Qa=here.dev&&new URLSearchParams(location.search).has('round3qa');climateReceived=Date.now();debugEnabled=here.dev&&new URLSearchParams(location.search).has('debug');$('debug-toggle').hidden=!debugEnabled||new URLSearchParams(location.search).has('cleanqa');if(!here.dev){$('panel').remove();$('debug-toggle').remove();}reviewEnabled=here.dev&&new URLSearchParams(location.search).has('review');if((debugEnabled||reviewEnabled)&&new URLSearchParams(location.search).has('hour')){const requested=Number(new URLSearchParams(location.search).get('hour'));if(Number.isFinite(requested))override=((requested%24)+24)%24;}if(debugEnabled||reviewEnabled){const query=new URLSearchParams(location.search);weatherOverride=(query.get('weather')||'AUTO').toUpperCase();if(!['AUTO','CLEAR','OVERCAST','PRECIPITATION'].includes(weatherOverride))weatherOverride='AUTO';seasonOverride=(query.get('season')||'AUTO').toUpperCase();if(!['AUTO','SPRING','SUMMER','AUTUMN','WINTER'].includes(seasonOverride))seasonOverride='AUTO';for(const key of ['cloudCover','wind','snowMix'])if(query.has(key))seasonManual[key]=Math.max(0,Math.min(1,Number(query.get(key))));$('season-select').value=seasonOverride;}override=17.3;seasonOverride='AUTUMN';weatherOverride='CLEAR';seasonManual={cloudCover:.38,wind:.34,snowMix:0,grassHeight:.8,flowerBloom:0,grassBaseColor:[.25,.17,.055],grassTipColor:[.48,.34,.13],ground:[.24,.18,.075]};frameBanner();if(here.dev&&new URLSearchParams(location.search).has('recordqa')){const {installRecorder}=await import('./assets/launch-recorder.js?v=launch-2');installRecorder(canvas);$('debug-toggle').hidden=true;}ready=true;installReviewControls();if(debugEnabled&&new URLSearchParams(location.search).has('surfaceqa')){const {testSurfaces,showRegions}=await import('./assets/surface-qa.js?v=round4-2');const fixture=await fetch('./assets/qa_handwriting.json').then(r=>r.json());await testSurfaces(stone,fixture);if(new URLSearchParams(location.search).get('regions')==='1')showRegions(stone,scene);}notify('stone:ready',{clock:here.clock,season:here.season});updateWorld();renderer.render(scene,camera);introTrace.firstRender=performance.now();
 introFontReady.then(textReadyAt=>{introTrace.fontReady=textReadyAt;setTimeout(()=>{renderer.render(scene,camera);requestAnimationFrame(()=>{introTrace.revealStart=performance.now();const revealMs=1200;$('curtain').style.setProperty('--curtain-duration',Math.max(0,revealMs-120)+'ms');$('curtain').style.setProperty('--curtain-delay',Math.min(120,revealMs)+'ms');$('curtain').classList.add('opened');document.body.classList.add('ready');const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;introTrace.reduced=reduced;setTimeout(()=>{revealComplete=true;introTrace.revealEnd=performance.now();$('enter').hidden=false;$('curtain').hidden=true;},reduced?0:revealMs);});},Math.max(0,700-(performance.now()-introLoadStarted)));});
},undefined,error=>{clockNotice('world unavailable');errors.push(String(error));});
function updateWorld(){
 if(!world())return; // No calendar state before the canonical server clock arrives.
 const date=canonicalDate(),moonInfo=LunarCalendar.getMoonIllumination(new Date(date.getTime()-(world()?.utcOffsetMinutes||0)*60000)),h=override===null?stoneHour():override,c=lightingAt(h),p=celestialPose(h),solar=solarPose(h),lunar=lunarPose(h),night=p.moonVisibility;
 const target=seasonAt(date,seasonOverride);const canonicalMS=(world()?.serverTime||date.getTime())+(Date.now()-(climateReceived||Date.now()));Object.assign(target,weatherAt(canonicalMS,target));Object.assign(target,weatherPreview(target,weatherOverride));Object.assign(target,seasonManual);climateUniforms.atmosphereTime.value=(canonicalMS-Date.UTC(2026,9,7))/1000;climateUniforms.meteorProof.value=debugEnabled&&new URLSearchParams(location.search).has("meteorProof")?1:0;const qa=debugEnabled&&new URLSearchParams(location.search).has('visualqa');if(!seasonState||qa)seasonState=target;else easeSeason(seasonState,target,seasonDt);const ss=seasonState;const ramp=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);eventUniforms.dawnEvent.value=ramp(5,6,h)*(1-ramp(6.5,7.5,h));eventUniforms.sunsetEvent.value=ramp(16.5,17.5,h)*(1-ramp(18.25,19.5,h));grass?.update(ss,night);stoneLightUniforms.sun.value.copy(skyUniforms.sunDirection.value);stoneLightUniforms.warmth.value=Math.max(eventUniforms.dawnEvent.value,eventUniforms.sunsetEvent.value)*(1-night)*(1-ss.cloudCover*.35);updateWind(ss.wind);updateWeatherAudio(ss.rain);seasonalUniforms.wet.value=ss.wetness;habitat?.update(ss,camera,performance.now()/1000,night);seasonalUniforms.snow.value=ss.snowMix;seasonalUniforms.ground.value.setRGB(...ss.ground);climateUniforms.cloudCover.value=ss.cloudCover;climateUniforms.seasonWind.value=ss.wind;climateUniforms.seasonTime.value=qa?10:((world()?.serverTime||0)+(Date.now()-(climateReceived||Date.now())))/1000-Date.UTC(2026,9,7)/1000;climateUniforms.mountainSnow.value=ss.mountainSnow;climateUniforms.mountainVisibility.value=ss.mountainVisibility;
 sky.position.copy(camera.position);skyUniforms.sunDirection.value.set(...solar.direction);skyUniforms.sunVisibility.value=p.sunVisibility*(1-Math.pow(ss.cloudCover,3)*.95);
 skyUniforms.moonDirection.value.set(...lunar.direction);skyUniforms.moonVisibility.value=night;skyUniforms.moonPhase.value=moonInfo.phase;skyUniforms.moonIllumination.value=moonInfo.fraction;
 const sunset=1-THREE.MathUtils.smoothstep(solar.elevationDeg,0,12);
 skyUniforms.sunColor.value.setRGB(1.25-.25*sunset,1.05-.63*sunset,.68-.54*sunset);skyUniforms.sunGlow.value=.10+.22*sunset;
 skyUniforms.horizon.value.setRGB(...c.sky.map((v,i)=>v*ss.skyTint[i]));skyUniforms.zenith.value.setRGB(...c.top.map((v,i)=>v*ss.skyTint[i]));skyUniforms.night.value=night;
 const gloom=THREE.MathUtils.smoothstep(ss.cloudCover,.45,.95);skyUniforms.horizon.value.lerp(new THREE.Color(...(night>.5?[.022,.034,.052]:[.22,.25,.27])),gloom*.72);skyUniforms.zenith.value.lerp(new THREE.Color(...(night>.5?[.006,.012,.023]:[.12,.15,.18])),gloom*.78);
 ambient.color.setRGB(...c.ambient);ambient.groundColor.setRGB(.13,.11,.075);ambient.intensity=c.fill*(1+night*3.2)*(1+(1-night)*.20)*(1-ss.cloudCover*.28)*(1-ss.rain*.12);
 mainLight.color.setRGB(...c.color);mainLight.intensity=c.power*(1-ss.cloudCover*.84)*p.sunVisibility*(1-THREE.MathUtils.smoothstep(-solar.elevationDeg,0,.5));mainLight.target.position.set(0,.7,0);mainLight.position.copy(mainLight.target.position).addScaledVector(skyUniforms.sunDirection.value,30);mainLight.visible=mainLight.intensity>.0001;
 moonLight.color.setRGB(.61,.75,1.0);moonLight.intensity=c.power*2.3*night*(1-ss.cloudCover*.70)*(.35+.65*moonInfo.fraction)*(1-THREE.MathUtils.smoothstep(-lunar.elevationDeg,0,.5));moonLight.visible=night>.001;moonLight.target.position.set(0,.7,0);moonLight.position.copy(moonLight.target.position).addScaledVector(skyUniforms.moonDirection.value,30);
 const bodyPos=night>.5?p.moon:p.sun;
 if(sun){sun.visible=false;moon.visible=false;}
 seaUniforms.storm.value=Math.max(ss.rain,ss.snow*.35,ss.wind*.35);seaUniforms.seaColor.value.setRGB(...c.sea).multiplyScalar(1-gloom*.25);seaUniforms.skyColor.value.setRGB(...c.sky);seaUniforms.body.value.set(...bodyPos);seaUniforms.night.value=night;seaUniforms.reflection.value=Math.max(p.sunVisibility*(1-gloom*.94),night*(.16+.84*moonInfo.fraction)*(1-gloom*.85));
 seaUniforms.solarDirection.value.set(...solar.direction);seaUniforms.lunarDirection.value.set(...lunar.direction);
 mist.color.setRGB(...c.sky);mist.density=(.00030+.0010*Math.exp(-Math.pow((h-6)/1.3,2)))*ss.haze+ss.rain*.005+ss.snow*.002+gloom*.001;
 const lightDirection=new THREE.Vector3().subVectors(mainLight.position,mainLight.target.position).normalize();
 latest={entryMotion:{active:entryMotion.active,elapsed:entryMotion.elapsed},audio:audioState(),moonPhase:moonInfo.phase,moonIllumination:moonInfo.fraction,grassDrawn:grass?.mesh.count,adaptiveQuality:adaptiveLevel,dawnEvent:eventUniforms.dawnEvent.value,sunsetEvent:eventUniforms.sunsetEvent.value,solarOcclusion:"exact mountain silhouette composited in front of celestial/cloud layers",gpuMeanMs:gpuSamples.length?gpuSamples.reduce((a,b)=>a+b,0)/gpuSamples.length:null,gpuSampleCount:gpuSamples.length,gpuFrameMs,gpuTimerAvailable:Boolean(gpuExt),habitat:habitat?.stats(),rain:ss.rain,snowfall:ss.snow,weatherMode:weatherOverride,canonicalDate:date.toISOString(),seasonProgress:ss.seasonProgress,seasonBlend:ss.blend,seasonMode:seasonOverride,cloudCover:ss.cloudCover,wind:ss.wind,snowMix:ss.snowMix,grassInstanceCount:grass?.capacity,grassVisibleEstimate:Math.round((grass?.capacity||0)*ss.grassDensity*(1-ss.snowMix*.32)),renderSubmitMs,cloudRenderingCost:'two warped cloud decks in existing sky draw; no extra draw or textures',uiEvents:[...uiEvents],lastPointerType:nav.lastPointerType,device:nav.device,viewport:[innerWidth,innerHeight],cameraMode:nav.entered?'walking':'paused',placementMode:Boolean(placement?.active),placementMoving:Boolean(placement?.moving),raycastTriangle:placement?.triangle,placementValidity:Boolean(placement?.valid),selectedPlacement:placement?.candidate,visitorHash:debugEnabled?visitor.debugHash:undefined,serverInscriptionCount:marks.length,visitorAlreadyUsed:visitor.used,serverReady,inscriptions:marks,distanceToStone:Math.hypot(camera.position.x,camera.position.z),interactionAvailable:nearStone(),groundHeight:sampleGround?.(camera.position.x,camera.position.z),eyeHeight:WALK.eyeHeight,writing,entered,mode:override===null?'LIVE':'PRESET',local:stoneClock(),localDecimal:stoneHour(),hour:h,state:c.name,sunAngle:p.sunAngle*180/Math.PI,sunAzimuth:solar.azimuthDeg,sunElevation:solar.elevationDeg,sunVisualDistance:solar.visualDistance,sunAngularSize:solar.angularDiameterDeg,sunDirection:solar.direction,sunlightDirection:lightDirection.toArray(),sunlightDirectionErrorDeg:THREE.MathUtils.radToDeg(lightDirection.angleTo(skyUniforms.sunDirection.value)),sunlightIntensity:mainLight.intensity,nearSunVisible:sun?.visible??false,nearSunInScene:Boolean(sun?.parent),visualSun:'sky shader, camera-centered celestial sphere',skyCenter:sky.position.toArray(),moonVisibility:night,moonAzimuth:lunar.azimuthDeg,moonElevation:lunar.elevationDeg,moonDirection:lunar.direction,moonVisualDistance:lunar.visualDistance,moonAngularSize:lunar.angularDiameterDeg,nearMoonInScene:Boolean(moon?.parent),nearMoonVisible:moon?.visible??false,moonlightDirection:new THREE.Vector3().subVectors(moonLight.position,moonLight.target.position).normalize().toArray(),camera:camera.position.toArray(),fps,ready,curtainOpen:$('curtain').classList.contains('opened'),stonePosition:model?.getObjectByName('THE_MILESTONE')?.position.toArray(),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,textureMemoryEstimate:textureBytes(scene),dpr:renderer.getPixelRatio(),qualityTier:quality().tier,shadowSettings:{sun:mainLight.shadow.mapSize.toArray(),moon:moonLight.shadow.mapSize.toArray()},cameraFov:camera.fov,errors:[...errors]};
 if(ready&&performance.now()-lastSolarSample>250){lastSolarSample=performance.now();solarSamples.push({...latest});if(solarSamples.length>1500)solarSamples.shift();}
 if(debugEnabled&&!$('panel').hidden){$('local').textContent=latest.local;$('decimal').textContent=h.toFixed(4)+(override===null?' LIVE':' TEST');$('state').textContent=c.name;$('angle').textContent=latest.sunAngle.toFixed(1)+'°';$('moon').textContent=(night*100).toFixed(0)+'%';$('camera').textContent=camera.position.toArray().map(v=>v.toFixed(2)).join(', ');$('fps').textContent=fps.toFixed(0);}
 if(debugEnabled&&!$('panel').hidden){$('sun-azimuth').textContent=solar.azimuthDeg.toFixed(2)+'°';$('sun-elevation').textContent=solar.elevationDeg.toFixed(2)+'°';$('sun-distance').textContent=solar.visualDistance+' u / sky';$('sun-size').textContent=solar.angularDiameterDeg.toFixed(2)+'°';$('moon-distance').textContent=lunar.visualDistance+' u / sky';$('moon-size').textContent=lunar.angularDiameterDeg.toFixed(2)+'°';$('moon-elevation').textContent=lunar.elevationDeg.toFixed(2)+'°';}
}
function animate(t){requestAnimationFrame(animate);if(document.hidden){previousTime=t;return;}if(round3Qa){if(!revealComplete&&introTrace.samples.length<800)introTrace.samples.push({t,opacity:Number(getComputedStyle($('curtain')).opacity),left:getComputedStyle($('curtain'),'::before').transform,right:getComputedStyle($('curtain'),'::after').transform,camera:camera.position.toArray(),rotation:camera.rotation.toArray()});let proof=document.getElementById('round3-proof');if(!proof){proof=document.createElement('pre');proof.id='round3-proof';proof.hidden=true;document.body.append(proof);}proof.textContent=JSON.stringify({...introTrace,flash:[...markMeshes.values()].map(m=>m.material.userData.cutUniforms?.flash.value),notice:document.body.classList.contains('notice-active'),time:t});}const frameMs=t-previousTime;const dt=Math.min(.05,frameMs/1000);previousTime=t;if(ready&&revealComplete&&!document.hidden&&frameMs<500){frameTiming.push(frameMs);if(frameTiming.length>1800)frameTiming.shift();if(nav.mobile){slowFrames=frameMs>32?slowFrames+1:Math.max(0,slowFrames-1);if(slowFrames>75&&adaptiveLevel<2){adaptiveLevel++;slowFrames=0;renderer.setPixelRatio(adaptiveLevel===1?1:.85);grass?.limit(adaptiveLevel===1?.65:.42);mainLight.shadow.mapSize.set(512,512);mainLight.shadow.map?.dispose();mainLight.shadow.map=null;moonLight.castShadow=false;}}}seasonDt=dt;nav.update(dt);entryMotion.update(dt,camera,nav,sampleGround,writing||Boolean(placement?.active));if(nav.mobile){const target=innerHeight>innerWidth?58:48;if(Math.abs(camera.fov-target)>.02){camera.fov=THREE.MathUtils.lerp(camera.fov,target,1-Math.exp(-5*dt));camera.updateProjectionMatrix();}}
 if(walkCueCamera&&!$('walk-cue').hidden&&(camera.position.distanceTo(walkCueCamera)>.015||Math.abs(camera.rotation.y-walkCueRotation.y)>.003||Math.abs(camera.rotation.x-walkCueRotation.x)>.003))dismissWalkCue();
 $('enter').textContent='ENTER THE LANDSCAPE';$('prompt').hidden=visitor.used||!entered||writing||Boolean(placement?.active)||!nearStone()||!serverReady;$('prompt').disabled=visitor.used;$('prompt').textContent=visitor.used?'YOUR MARK IS ALREADY HERE':!visitor.canMark?'SAY THE FEELING FIRST':nav.mobile?'LEAVE A MARK':'E · LEAVE A MARK';if(revealComplete&&ready&&override===null&&$('stone-clock').textContent!==stoneClock())$('stone-clock').textContent=stoneClock();
 if(debugEnabled){$('distance').textContent=Math.hypot(camera.position.x,camera.position.z).toFixed(2)+' m';$('interaction').textContent=nearStone()&&!visitor.used?'YES':'NO';$('inscription').textContent=visitor.used?'HAND-DRAWN':'—';}
 if(placement?.active){$('placement-help').textContent='';$('place-mark').disabled=!placement.valid||saving;$('place-mark').textContent=saving?'…':'PLACE';}
 if(debugEnabled&&!$('panel').hidden){for(const [id,value] of Object.entries({'device':nav.device+(nav.lastPointerType?' / '+nav.lastPointerType:''),'viewport':innerWidth+' × '+innerHeight,'camera-mode':nav.entered?'WALK':'PAUSED','placement-mode':placement?.active?'YES':'NO','hit-triangle':placement?.triangle??'—','placement-valid':placement?.valid?'YES':'NO','visitor-hash':visitor.debugHash||'—','server-count':marks.length,'visitor-used':visitor.used?'YES':'NO'}))$(id).textContent=value;}
 for(const mesh of [...markMeshes.values(),...(placement?.preview?[placement.preview]:[])]){const u=mesh.material.userData.cutUniforms;if(u){u.flash.value=mesh.material.userData.flashStarted===undefined?0:Math.max(0,1-(t-mesh.material.userData.flashStarted)/1200);u.sun.value.copy(skyUniforms.sunDirection.value);u.moon.value.copy(skyUniforms.moonDirection.value);u.night.value=skyUniforms.moonVisibility.value;}}
 frameBanner();cameraTravel+=camera.position.distanceTo(lastCamera);lastCamera.copy(camera.position);seaUniforms.clock.value=debugEnabled&&new URLSearchParams(location.search).has('visualqa')?10:t/1000;updateWorld();if(grass)grass.clock.value=climateUniforms.seasonTime.value;visualQa();if(debugEnabled&&gpuQuery&&gpuGL.getQueryParameter(gpuQuery,gpuGL.QUERY_RESULT_AVAILABLE)){if(!gpuGL.getParameter(gpuExt.GPU_DISJOINT_EXT))gpuFrameMs=gpuGL.getQueryParameter(gpuQuery,gpuGL.QUERY_RESULT)/1e6;if(gpuFrameMs!==null){gpuSamples.push(gpuFrameMs);if(gpuSamples.length>60)gpuSamples.shift();}gpuGL.deleteQuery(gpuQuery);gpuQuery=null;}let measuring=false;if(debugEnabled&&gpuExt&&!gpuQuery&&gpuCounter++%30===0){gpuQuery=gpuGL.createQuery();gpuGL.beginQuery(gpuExt.TIME_ELAPSED_EXT,gpuQuery);measuring=true;}const submitStart=performance.now();renderer.render(scene,camera);if(debugEnabled&&visualQaReady&&!document.getElementById("frame-data")){const p=document.createElement("pre");p.id="frame-data";p.hidden=true;p.textContent=canvas.toDataURL("image/png");p.dataset.proof=JSON.stringify({camera:camera.position.toArray(),rotation:camera.rotation.toArray(),fov:camera.fov,viewport:[innerWidth,innerHeight],exposure:renderer.toneMappingExposure,hour:override});document.body.append(p);}if(measuring)gpuGL.endQuery(gpuExt.TIME_ELAPSED_EXT);renderSubmitMs=renderSubmitMs*.95+(performance.now()-submitStart)*.05;frames++;if(t-lastFps>=1000){fps=frames*1000/(t-lastFps);frames=0;lastFps=t;}}
requestAnimationFrame(animate);
function resize(){
 const q=quality();camera.fov=(Math.min(innerWidth,innerHeight)<700||matchMedia('(pointer: coarse)').matches)?(innerHeight>innerWidth?58:48):40;
 if(ready&&grass&&grassBudget!==q.grass){
  const previous=grass;grass=grassField(sampleGround,grassBudget=q.grass);scene.add(grass.mesh);scene.remove(previous.mesh);previous.mesh.geometry.dispose();previous.mesh.material.dispose();habitat?.dispose();habitat=createHabitat(scene,sampleGround,nav.mobile);
 }
 if(ready){adaptiveLevel=0;slowFrames=0;grass?.limit(1);moonLight.castShadow=true;
  for(const light of [mainLight,moonLight])if(light.shadow.mapSize.x!==q.shadow){light.shadow.mapSize.set(q.shadow,q.shadow);light.shadow.map?.dispose();light.shadow.map=null;}
 }
 renderer.setPixelRatio(q.dpr);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
}resize();addEventListener('resize',resize);
$('debug-toggle').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('debug-toggle').setAttribute('aria-expanded',String(!$('panel').hidden));};
for(const button of document.querySelectorAll('[data-hour]'))button.onclick=()=>{override=button.dataset.hour==='live'?null:Number(button.dataset.hour);$('debug-time').value=override===null?stoneClock():`${String(override).padStart(2,'0')}:00`;document.querySelectorAll('[data-hour]').forEach(b=>b.classList.toggle('active',b===button));updateWorld();history.push({...latest});$('status').textContent=override===null?'LIVE · stone time':`${String(override).padStart(2,'0')}:00 test hour`;};
$('debug-time').oninput=()=>{const [hours,minutes]=$('debug-time').value.split(':').map(Number);if(!Number.isFinite(hours)||!Number.isFinite(minutes))return;override=hours+minutes/60;document.querySelectorAll('[data-hour]').forEach(b=>b.classList.remove('active'));updateWorld();history.push({...latest});$('status').textContent=$('debug-time').value+' test hour';};
$('reset').onclick=()=>{cancelPlacement();closeWriting();resetPosition();};
$('report').onclick=async()=>{try{await request('qa/browser_report.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latest,cameraTravel,history:history.slice(-20),samples:solarSamples.slice(-30),userAgent:navigator.userAgent})});$('status').textContent='Browser QA saved';}catch(e){$('status').textContent=e.message;}};
// The clock is re-read so daylight saving and drift never part one visitor's sky from another's.
setInterval(()=>{if(ready&&!document.hidden)syncWorld().then(()=>{climateReceived=Date.now();}).catch(()=>{});},300000);

addEventListener('pointerlockchange',()=>uiEvent('pointer-lock',{locked:document.pointerLockElement===canvas}));

// Visual QA is available solely behind the existing server-controlled development gate.
let visualQaReady=false;
function visualQa(){if(!debugEnabled||!new URLSearchParams(location.search).has('visualqa')||!ready)return;
 if(!visualQaReady){visualQaReady=true;const mode=new URLSearchParams(location.search).get('view')||'hero';const poses={skyseam:[[0,1.7,7.55],[0,9,-20]],rearskyseam:[[0,1.7,7.55],[0,9,30]],rear:[[0,1.7,-3.8],[0,1.1,15]],rearstart:[[0,1.7,7.55],[0,1.2,30]],range3:[[0,1.7,3.18],[0,1.08,.18]],range1:[[.12,1.7,1.18],[0,1.12,.18]],cut:[[.08,1.25,.58],[0,1.18,.17]],markright:[[.62,1.42,.05],[.28,1.4,0]],regionfront:[[0,1.45,3.2],[0,1.05,0]],regionleft:[[-3.2,1.45,.1],[0,1.05,0]],regionright:[[3.2,1.45,.1],[0,1.05,0]],readability:[[.05,1.7,2],[0,1.25,.17]],approach:[[0,1.7,2.4],[0,1.35,0]],threequarter:[[1.15,1.7,1.45],[0,1.3,0]],left:[[-1.5,1.55,.1],[0,1.15,0]],right:[[1.5,1.55,.1],[0,1.15,0]],front:[[0,1.6,2.1],[0,1.15,0]],mark:[[.10,1.55,1.8],[0,1.2,.17]],cloud:[[0,1.7,7.55],[0,4,-5]],transition:[[.65,.72,1.6],[0,.40,0]],hero:[[0,1.70,7.55],[0,1.20,0]],stone:[[.48,1.73,1.4],[0,1.55,0]],mark:[[.18,1.42,.95],[0,1.229,.17]],grass:[[1.25,.50,2.1],[0,.08,0]],horizon:[[1.4,1.7,5.3],[1.4,1.7,-70]],grazing:[[.68,1.55,1.2],[0,1.45,0]],night:[[.32,1.62,1.5],[0,1.45,0]]};const [position,target]=poses[mode]||poses.hero;camera.position.set(...position);camera.lookAt(new THREE.Vector3(...target));const facing=new THREE.Vector3(...target).sub(camera.position).normalize();nav.yaw=nav.targetYaw=Math.atan2(-facing.x,-facing.z);nav.pitch=nav.targetPitch=Math.asin(facing.y);camera.rotation.set(nav.pitch,nav.yaw,0,'YXZ');
 const css=document.createElement('style');css.textContent='body>*:not(canvas):not(script):not(style):not(#visual-evidence){display:none!important}';document.head.append(css);const evidence=document.createElement('pre');evidence.id='visual-evidence';evidence.hidden=true;document.body.append(evidence);}
 document.getElementById('visual-evidence').textContent=JSON.stringify({...latest,cameraDirection:camera.getWorldDirection(new THREE.Vector3()).toArray(),rearGround:sampleGround(0,10),terrainBounds:terrainQaBounds(),rearRay:rearQaRay(),textureMemoryEstimate:typeof textureBytes==='function'?textureBytes(scene):estimateQaTexture(scene),dpr:renderer.getPixelRatio(),shadowSettings:{sun:mainLight.shadow.mapSize.toArray(),moon:moonLight.shadow.mapSize.toArray()},cameraFov:camera.fov,frameTiming:frameTiming.slice(-900),measurement:'browser viewport emulation; not physical mobile hardware'});
}
function rearQaRay(){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,-.7),camera);return ray.intersectObjects(model.children,true).slice(0,3).map(x=>({name:x.object.name,point:x.point.toArray(),distance:x.distance}));}
function terrainQaBounds(){const terrain=model?.getObjectByName('Flat_headland_summit');return terrain?new THREE.Box3().setFromObject(terrain).max.toArray():null;}
function estimateQaTexture(scene){const seen=new Set();let bytes=0;scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)for(const t of Object.values(m))if(t?.isTexture&&!seen.has(t)){seen.add(t);if(t.image?.width)bytes+=t.image.width*t.image.height*4*(t.generateMipmaps?4/3:1);}});return Math.round(bytes);}

$('season-select').onchange=()=>{seasonOverride=$('season-select').value;if(seasonOverride==='AUTO'){seasonManual={};}updateWorld();};
for(const [id,key] of [['cloud-cover','cloudCover'],['season-wind','wind'],['snow-mix','snowMix']])$(id).oninput=()=>{seasonManual[key]=Number($(id).value);};
setInterval(()=>{if(!debugEnabled||!seasonState)return;$('canonical-date').textContent=latest.canonicalDate;$('season-progress').textContent=seasonState.seasonProgress.toFixed(4);$('season-blend').textContent=Object.entries(seasonState.blend).filter(([k,v])=>v>.01).map(([k,v])=>k+' '+Math.round(v*100)+'%').join(' / ');for(const [id,key] of [['cloud-cover','cloudCover'],['season-wind','wind'],['snow-mix','snowMix']]){if(document.activeElement!==$(id))$(id).value=seasonState[key];$(id+'-value').textContent=seasonState[key].toFixed(2);}},300);

setInterval(()=>{if(!debugEnabled)return;let p=document.getElementById('launch-evidence');if(!p){p=document.createElement('pre');p.id='launch-evidence';p.hidden=true;document.body.append(p);}p.textContent=JSON.stringify({...latest,frameTiming:frameTiming.slice(-900),stoneUV:stone?.geometry.getAttribute('uv')?.count,drawing:drawingSurface.data});},250);

// Local product review: the canonical server clock stays unchanged.
function reviewTime(hour){const minutes=Math.round(hour*60)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
function syncReviewControls(){
 if(!reviewEnabled||!ready)return;
 const h=override===null?stoneHour():override,label=reviewTime(h);
 $('review-time-label').textContent=override===null?'LIVE '+label:label;
 $('review-hour-output').textContent=label;
 if(document.activeElement!==$('review-hour'))$('review-hour').value=h;
 for(const b of document.querySelectorAll('[data-review-hour]'))b.setAttribute('aria-pressed',String(override!==null&&Math.abs(Number(b.dataset.reviewHour)-override)<.001));
 $('review-live').setAttribute('aria-pressed',String(override===null));
 $('review-pause').disabled=!revealComplete; $('review-pause').textContent=nav.entered?'Pause walk':'Resume walk';
 $('review-tools').dataset.state=JSON.stringify({ready,hour:h,device:nav.device,camera:camera.position.toArray(),entered:nav.entered,entryActive:entryMotion.active,season:seasonOverride,weather:weatherOverride,rain:seasonState?.rain,snow:seasonState?.snow,snowCover:seasonState?.snowMix,cloudCover:seasonState?.cloudCover,grassHeight:seasonState?.grassHeight,grassColors:seasonState?.grassTipColor,habitat:habitat?.stats(),errors:[...errors],fps:Math.round(fps),grassCapacity:grass?.capacity,grassDrawn:grass?.mesh.count,dpr:renderer.getPixelRatio(),serverReady});
 $('stone-clock').textContent=label+(override===null?'':' · PREVIEW');
}
function setReviewHour(value){
 if(!reviewEnabled||!ready)return;
 override=value===null?null:((Number(value)%24)+24)%24;
 if(override!==null&&!Number.isFinite(override))override=null;
 nav.clear();updateWorld();syncReviewControls();
 const url=new URL(location.href);if(override===null)url.searchParams.delete('hour');else url.searchParams.set('hour',String(override));
 window.history.replaceState(null,'',url);
}
function installReviewControls(){
 if(!reviewEnabled)return;
 const tools=$('review-tools');tools.hidden=false;
 tools.addEventListener('pointerdown',()=>{nav.clear();document.exitPointerLock?.();});
 for(const b of document.querySelectorAll('[data-review-hour]'))b.onclick=()=>setReviewHour(b.dataset.reviewHour);
 $('review-hour').oninput=e=>setReviewHour(e.target.value);
 $('review-season').value=seasonOverride;$('review-weather').value=weatherOverride;
 $('review-season').onchange=e=>{seasonOverride=e.target.value;storeHabitatPreview();};
 $('review-weather').onchange=e=>{weatherOverride=e.target.value;storeHabitatPreview();};
 $('review-live').onclick=()=>setReviewHour(null);
 $('review-pause').onclick=()=>{if(nav.entered){entered=false;entryMotion.active=false;audioCue('pause');nav.pause();$('enter').hidden=false;}else enter();syncReviewControls();};
 $('review-reset').onclick=()=>{cancelPlacement();closeWriting();entryMotion.active=false;resetPosition();updateWorld();};
 tools.addEventListener('keydown',e=>e.stopPropagation());
 syncReviewControls();setInterval(syncReviewControls,1000);
}

function storeHabitatPreview(){
 nav.clear();const url=new URL(location.href);url.searchParams.set('season',seasonOverride);url.searchParams.set('weather',weatherOverride);window.history.replaceState(null,'',url);updateWorld();syncReviewControls();
}

let bannerReadySent=false;
function frameBanner(){
 const portrait=innerHeight>innerWidth;
 camera.position.set(.15,1.7,7.5);camera.lookAt(portrait?.45:0,portrait?1.25:1.28,0);
 const sensor=portrait?24:Math.max(20.25,36/(innerWidth/innerHeight));
 camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(sensor/(2*35)));camera.updateProjectionMatrix();
 if(ready){
 document.body.dataset.bannerReady='true';
 if(!bannerReadySent){bannerReadySent=true;parent.postMessage({source:'mona-mile-banner',ready:true},location.origin);}
 let proof=document.getElementById('banner-proof');if(!proof){proof=document.createElement('pre');proof.id='banner-proof';proof.hidden=true;document.body.append(proof);}
 camera.updateMatrixWorld();const projectedSun=skyUniforms.sunDirection.value.clone().multiplyScalar(1000).add(camera.position).project(camera);
 proof.textContent=JSON.stringify({ready,frames,hour:override,season:seasonOverride,weather:weatherOverride,camera:camera.position.toArray(),fov:camera.fov,viewport:[innerWidth,innerHeight],sunNDC:projectedSun.toArray(),errors:[...errors],grass:grass?.mesh.count,drawCalls:renderer.info.render.calls});
 }
}
