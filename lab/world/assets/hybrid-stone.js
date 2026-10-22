import * as THREE from 'three';
export const studyVariant='HYBRID';
export let studyEvidence={};
// Review geometry only. Canonical asset and inscription coordinates are never overwritten.
export function refineStone(stone){
 const original=stone.geometry.clone(); original.computeBoundingBox(); const b=original.boundingBox;
 if(studyVariant==='A'){original.scale(.85,1.20,1);stone.geometry=original;}
 else{
 const H=2.00,W=.58,D=.36;
 const N=64, R=100, pos=[],ix=[];
 for(let j=0;j<=R;j++){const t=j/R,y=-.14+(H+.14)*t,above=Math.max(0,y/H),capStart=.925;
 const shoulder=Math.max(0,(above-capStart)/(1-capStart));const cap=Math.pow(Math.max(.000002,1-shoulder*shoulder),.40);
 const taper=1-.06*above, exponent=4.3;
 for(let i=0;i<N;i++){const a=i/N*Math.PI*2,cs=Math.cos(a),sn=Math.sin(a);
 const radius=(1+.009*Math.sin(a*3+t*11)+.005*Math.sin(a*7-t*17))*cap*taper;
 const x=Math.sign(cs)*Math.pow(Math.abs(cs),2/exponent)*W*.5*radius+.003*Math.sin(t*7)*Math.sin(Math.PI*t);
 const z=Math.sign(sn)*Math.pow(Math.abs(sn),2/exponent)*D*.5*radius+.002*Math.sin(t*9+1)*Math.sin(Math.PI*t);
 pos.push(x,y-.010*above**12*(.7+.3*cs)-.006*above**8*(.5+.5*sn),z);
 if(j<R){const k=j*N+i,l=j*N+(i+1)%N;ix.push(k,l,k+N,l,l+N,k+N);}}
 }
 // Close top and buried bottom; no manufactured inscription panels.
 const bottom=pos.length/3;pos.push(0,-.14,0);const top=pos.length/3;pos.push(0,H,0);
 for(let i=0;i<N;i++){ix.push(bottom,(i+1)%N,i);ix.push(top,R*N+i,R*N+(i+1)%N);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));for(let k=0;k<ix.length;k+=3){const n=ix[k+1];ix[k+1]=ix[k+2];ix[k+2]=n;}g.setIndex(ix);g.computeBoundingBox();const bb=g.boundingBox,sz=new THREE.Vector3();bb.getSize(sz);g.scale(W/sz.x,1,D/sz.z);g.computeVertexNormals();stone.geometry=g;
 }
 stone.geometry.computeBoundingBox();const box=stone.geometry.boundingBox,sz=new THREE.Vector3();box.getSize(sz);
 studyEvidence={variant:studyVariant,widthM:sz.x,depthM:sz.z,aboveGroundHeightM:box.max.y,buriedDepthM:-box.min.y,taper:.06,inscriptionRegions:[
 {face:'front',normal:[0,0,1],heightRange:[.28,1.72],edgeMarginM:.06},
 {face:'left',normal:[-1,0,0],heightRange:[.28,1.72],edgeMarginM:.055},
 {face:'right',normal:[1,0,0],heightRange:[.28,1.72],edgeMarginM:.055}],regionsVisible:false};
 stone.userData.futureInscriptionRegions=studyEvidence.inscriptionRegions;
}
