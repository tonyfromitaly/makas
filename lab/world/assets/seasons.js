// Calendar is the stone's server-synchronised civil date, never visitor geography.
export const STATES={
 WINTER:{cloudCover:.68,wind:.55,snowMix:.90,grassHeight:.35,grassDensity:.32,dryness:.8,windResponse:.45,grassBaseColor:[.12,.13,.09],grassTipColor:[.27,.25,.18],ground:[.16,.18,.14],skyTint:[.82,.91,1.0],haze:1.8,mountainSnow:.95,mountainVisibility:.75,flowerBloom:0,rain:0,snow:0,wetness:.15},
 SPRING:{cloudCover:.36,wind:.28,snowMix:0,grassHeight:1.35,grassDensity:.96,dryness:.16,windResponse:1,grassBaseColor:[.065,.21,.025],grassTipColor:[.24,.43,.08],ground:[.10,.19,.042],skyTint:[.97,1.02,1.02],haze:1.15,mountainSnow:.32,mountainVisibility:.95,flowerBloom:1,rain:0,snow:0,wetness:.12},
 SUMMER:{cloudCover:.12,wind:.23,snowMix:0,grassHeight:1.85,grassDensity:1,dryness:.06,windResponse:.9,grassBaseColor:[.055,.19,.018],grassTipColor:[.24,.42,.055],ground:[.085,.17,.026],skyTint:[1.02,1,.98],haze:.95,mountainSnow:.06,mountainVisibility:1.04,flowerBloom:.12,rain:0,snow:0,wetness:.03},
 AUTUMN:{cloudCover:.56,wind:.46,snowMix:0,grassHeight:1.15,grassDensity:.90,dryness:.97,windResponse:.8,grassBaseColor:[.31,.19,.028],grassTipColor:[.63,.43,.095],ground:[.31,.22,.055],skyTint:[.94,.95,.97],haze:1.5,mountainSnow:.30,mountainVisibility:.86,flowerBloom:.025,rain:0,snow:0,wetness:.12}
};
const names=Object.keys(STATES),smooth=t=>t*t*(3-2*t);
export function calendarSeason(date){
 const y=date.getUTCFullYear(),start=Date.UTC(y,0,1),end=Date.UTC(y+1,0,1);const progress=(date.getTime()-start)/(end-start);
 const phase=((progress-.045+1)%1)*4,i=Math.floor(phase),t=smooth(phase-i),blend=Object.fromEntries(names.map(n=>[n,0]));blend[names[i]]=1-t;blend[names[(i+1)%4]]=t;
 return {seasonProgress:progress,blend};
}
export function seasonAt(date,override='AUTO'){
 const calendar=calendarSeason(date),blend=override in STATES?Object.fromEntries(names.map(n=>[n,n===override?1:0])):calendar.blend;
 const result={...calendar,blend};for(const key of Object.keys(STATES.WINTER)){const value=STATES.WINTER[key];result[key]=Array.isArray(value)?value.map((_,i)=>names.reduce((sum,n)=>sum+STATES[n][key][i]*blend[n],0)):names.reduce((sum,n)=>sum+STATES[n][key]*blend[n],0);}return result;
}
export function easeSeason(current,target,dt){const t=1-Math.exp(-dt/3);for(const key of Object.keys(STATES.WINTER)){if(Array.isArray(target[key]))current[key]=current[key].map((v,i)=>v+(target[key][i]-v)*t);else current[key]+=(target[key]-current[key])*t;}for(const key of Object.keys(target.blend))current.blend[key]+=(target.blend[key]-current.blend[key])*t;current.seasonProgress=target.seasonProgress;return current;}
export const cloudShader=`
 float cloudHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float cloudNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),f.x),f.y);}
 // Two atmospheric decks: different projection height, scale, wind speed and warped edges.
 float cloudDeck(vec3 d,float height,float scale,vec2 drift,float seed){vec2 uv=d.xz/(max(d.y,.045)+height)*scale+drift;vec2 warp=vec2(cloudNoise(uv*.61+seed),cloudNoise(uv*.73-seed));uv+=(warp-.5)*.72;float broad=cloudNoise(uv+seed),medium=cloudNoise(uv*2.07+vec2(seed,17.)),edge=cloudNoise(uv*5.3+seed*3.);float n=broad*.54+medium*.31+edge*.15;float threshold=mix(.78,.32,cloudCover);return smoothstep(threshold-.08,threshold+.14,n)*smoothstep(.014,.085,d.y);}
 float cloudField(vec3 d){vec2 drift=vec2(seasonTime*.0014*seasonWind,seasonTime*.0005333333*seasonWind);float low=cloudDeck(d,.21,3.5,drift,4.7);float high=cloudDeck(d,.53,6.2,drift*.38+vec2(13.2,-8.4),23.1);return (1.-(1.-low)*(1.-high*.48))*smoothstep(0.,.05,cloudCover);}
`;
