// Slow, deterministic weather fronts; season controls both baseline and rain/snow type.
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function weatherAt(ms,season={cloudCover:.3,wind:.3,blend:{WINTER:0}}){
 const t=ms/2700000,k=Math.floor(t),u=t-k,s=u*u*(3-2*u);
 const hash=n=>{const x=Math.sin(n*127.1+918.73)*43758.5453;return x-Math.floor(x);};
 const front=hash(k)*(1-s)+hash(k+1)*s;
 const cloudCover=clamp(season.cloudCover+(front-.4)*.65,.035,.98);
 const storm=smooth(.56,.86,cloudCover)*smooth(.38,.76,front);
 const winter=season.blend?.WINTER||0;
 return {cloudCover,wind:clamp(season.wind*.65+front*.36),rain:storm*(1-winter),snow:storm*winter*smooth(-.10,.55,Math.sin(ms/1000/210+1.7)),wetness:clamp((season.wetness||0)+storm*.85)};
}
export function weatherPreview(base,mode='AUTO'){
 if(mode==='AUTO')return base;
 if(mode==='CLEAR')return {...base,cloudCover:.035,wind:.16,rain:0,snow:0,wetness:.02};
 if(mode==='OVERCAST')return {...base,cloudCover:.94,wind:.45,rain:0,snow:0,wetness:.18};
 if(mode==='PRECIPITATION'){const winter=base.blend?.WINTER||0;return {...base,cloudCover:.97,wind:.62,rain:.88*(1-winter),snow:.9*winter,wetness:.95};}
 return base;
}
export const galaxyShader=`
 float band=exp(-pow(dot(d,normalize(vec3(.92,-.28,-.08)))/.115,2.));
 vec2 galaxyUV=vec2(dot(d,normalize(vec3(.08,0.,.92))),dot(d,normalize(vec3(-.2576,-.8528,.0224))));
 float dust=stellarNoise(d*13.+3.)*.45+stellarNoise(d*37.+11.)*.30+stellarNoise(d*117.+31.)*.15+stellarNoise(d*251.+7.)*.10;
 float knots=stellarNoise(d*71.+18.)*.55+stellarNoise(d*149.+61.)*.45;
 float clearAir=1.-localCloud*.97;
 float galaxy=band*(.18+.82*dust)*(.42+.58*knots)*smoothstep(.025,.20,d.y)*night*clearAir;
 c+=mix(vec3(.038,.042,.079),vec3(.12,.096,.081),dust)*galaxy;
 vec2 fineUV=vec2(atan(d.x,d.z)/6.28318530718+.5,asin(clamp(d.y,-1.,1.))/3.14159265359+.5)*vec2(2890.,1350.);
 vec2 fineCell=floor(fineUV);float fineStar=stableStars(fineUV,.982-band*.065,.0081,17.,angularPixel*vec2(2890./6.28318530718,1350./3.14159265359),2890.);
 c+=vec3(.45,.48,.56)*fineStar*night*clearAir*smoothstep(.03,.16,d.y)*.45;
 // One short meteor opportunity per 12-second slot; most slots remain empty.
 float slot=floor(atmosphereTime/12.),phase=mod(atmosphereTime,12.);
 float day=floor(atmosphereTime/86400.);float chosenSlot=floor(hash(vec2(day,77.))*7200.);float chance=step(.82,hash(vec2(day,91.)))*(1.-step(.5,abs(mod(slot,7200.)-chosenSlot)));float start=2.+hash(vec2(slot,31.))*7.;
 if(meteorProof>.5){chance=1.;start=2.;phase=2.42;}
 float age=(phase-start)/.85;float meteorActive=step(.994,chance)*step(0.,age)*(1.-step(1.,age))*sin(clamp(age,0.,1.)*3.14159);
 vec2 meteorUV=vec2(atan(d.x,-d.z),asin(d.y));
 vec2 origin=vec2((hash(vec2(slot,5.))-.5)*2.1,.22+hash(vec2(slot,8.))*.62);
 if(meteorProof>.5)origin=vec2(-.1,.38);
 vec2 velocity=vec2(.28,-.17);vec2 delta=meteorUV-origin-velocity*age;
 vec2 along=normalize(velocity);float longitudinal=dot(delta,along),transverse=abs(dot(delta,vec2(-along.y,along.x)));
 float tail=exp(min(longitudinal,0.)/.020)*smoothstep(-.070,-.055,longitudinal)*(1.-smoothstep(0.,.003,longitudinal));
 float head=exp(-(longitudinal*longitudinal+transverse*transverse)/.000006);
 float meteor=exp(-transverse*transverse/.0000007)*tail+head*.7;
 c+=vec3(.6,.64,.72)*meteor*meteorActive*night*clearAir;
`;
