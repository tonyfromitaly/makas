export const SCALE=[.235,.1175,.045];
export function surfaceFace(n){if(Math.abs(n[1])>.22)return null;if(n[2]>=.90)return 'front';if(n[2]<-.25)return null;if(n[0]<=-.90)return 'left';if(n[0]>=.90)return 'right';return null;}
export function faceScale(n){return surfaceFace(n)==='front'?SCALE:[.142,.071,.045];}
export function footprint(mark){const a=mark.rotation[2],c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return [mark.scale[0]*c+mark.scale[1]*s,mark.scale[1]*c+mark.scale[0]*s];}
export function regionValid(p,n,scale=SCALE,rotation=[0,0,0]){const face=surfaceFace(n),b=footprint({scale,rotation});if(!face||p[1]-b[1]/2<.35||p[1]+b[1]/2>1.77)return false;const taper=1-.06*p[1]/2,half=(face==='front'?.58:.36)*taper/2-.040;return (face==='front'?p[2]>.11:Math.abs(p[0])>.20)&&Math.abs(p[face==='front'?0:2])+b[0]/2<=half;}
export function overlaps(a,b){const fa=surfaceFace(a.normalLocal),fb=surfaceFace(b.normalLocal);if(fa!==fb)return false;const axis=fa==='front'?0:2,aa=footprint(a),bb=footprint(b);return Math.abs(a.positionLocal[axis]-b.positionLocal[axis])<(aa[0]+bb[0])/2+.012&&Math.abs(a.positionLocal[1]-b.positionLocal[1])<(aa[1]+bb[1])/2+.012;}
