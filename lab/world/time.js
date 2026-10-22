// Artistic source anchors; substitute a solar-position provider at celestialPose().
export const anchors=[
 {hour:0,name:'NIGHT',sky:[.025,.041,.074],top:[.008,.017,.038],ambient:[.18,.23,.34],power:.36,fill:.22,color:[.61,.71,.90],sea:[.009,.021,.043]},
 {hour:6,name:'MORNING',sky:[.42,.455,.47],top:[.17,.29,.42],ambient:[.42,.46,.50],power:.8,fill:.62,color:[1,.80,.60],sea:[.07,.135,.19]},
 {hour:12,name:'NOON',sky:[.27,.49,.70],top:[.11,.285,.49],ambient:[.63,.67,.68],power:2.0,fill:1.28,color:[1,.96,.88],sea:[.050,.105,.160]},
 {hour:18,name:'SUNSET',sky:[.42,.285,.20],top:[.105,.20,.32],ambient:[.33,.31,.30],power:.95,fill:.72,color:[1,.71,.48],sea:[.055,.105,.16]},
 {hour:21,name:'NIGHT',sky:[.025,.041,.074],top:[.008,.017,.038],ambient:[.18,.23,.34],power:.36,fill:.22,color:[.61,.71,.90],sea:[.009,.021,.043]},
 {hour:24,name:'NIGHT',sky:[.025,.041,.074],top:[.008,.017,.038],ambient:[.18,.23,.34],power:.36,fill:.22,color:[.61,.71,.90],sea:[.009,.021,.043]}
];
export const wrap=h=>((h%24)+24)%24;
export const SOLAR={visualDistance:6000,angularDiameterDeg:.8,maxElevationDeg:12,azimuthSpanDeg:36};
// Artistic azimuth is clockwise from -Z. A sky ray and sunlight share this unit vector.
// Replace this provider with astronomy later; no island-sized solar position is used.
export function solarPose(hour){
 const h=wrap(hour),phase=(h-6)/12,azimuthDeg=8;
 const elevationDeg=2.3;
 const az=azimuthDeg*Math.PI/180,el=elevationDeg*Math.PI/180;
 const direction=[Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el)];
 return {azimuthDeg:(azimuthDeg+360)%360,elevationDeg,direction,visualDistance:SOLAR.visualDistance,angularDiameterDeg:SOLAR.angularDiameterDeg};
}
const smooth=t=>t*t*(3-2*t);
const ramp=(a,b,x)=>smooth(Math.max(0,Math.min(1,(x-a)/(b-a))));
export function lightingAt(hour){
 const h=wrap(hour); let i=anchors.findIndex((a,j)=>j<anchors.length-1&&h>=a.hour&&h<anchors[j+1].hour);
 const a=anchors[i],b=anchors[i+1],t=smooth((h-a.hour)/(b.hour-a.hour)); const result={hour:h,name:t<.001?a.name:a.name===b.name?a.name:`${a.name} → ${b.name}`,blend:t};
 for(const key of ['sky','top','ambient','color','sea'])result[key]=a[key].map((v,j)=>v+(b[key][j]-v)*t);
 for(const key of ['power','fill'])result[key]=a[key]+(b[key]-a[key])*t;
 return result;
}
export function celestialPose(hour){
 const h=wrap(hour),sunAngle=(h-12)*Math.PI/12,nightHour=h<12?h+24:h,moonAngle=(nightHour-24)*Math.PI/12;
 const position=angle=>[1.22*Math.sin(angle),1.55+1.19*Math.cos(angle),0];
 return {sunAngle,moonAngle,sun:position(sunAngle),moon:position(moonAngle),sunVisibility:ramp(5.5,6.5,h)*(1-ramp(17.5,18.5,h)),moonVisibility:h<12?1-ramp(5,6,h):ramp(18,19,h)};
}

export const LUNAR={visualDistance:6000,angularDiameterDeg:1.05};
export function lunarPose(hour){const p=solarPose(wrap(hour+12)),el=p.elevationDeg*8.2/SOLAR.maxElevationDeg,az=p.azimuthDeg*Math.PI/180,e=el*Math.PI/180;return {...p,...LUNAR,elevationDeg:el,direction:[Math.sin(az)*Math.cos(e),Math.sin(e),-Math.cos(az)*Math.cos(e)]};}
