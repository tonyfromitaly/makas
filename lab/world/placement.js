import * as THREE from 'three';
import {SCALE,faceScale,regionValid,overlaps} from './inscription_data.js?v=round4-2';
import {markMaterial,makeInscription,disposeInscription} from './inscription.js?v=island-controls-2';
export class Placement {
 constructor(scene,camera,canvas,stone,marks){Object.assign(this,{scene,camera,canvas,stone,marks});this.ray=new THREE.Raycaster();this.active=false;this.moving=false;this.candidate=null;this.valid=false;this.triangle=null;this.lastUpdate=0;}
 begin(drawing){this.cancel();this.drawing=drawing;this.angle=0;this.size=1.12;this.material=markMaterial(drawing);this.active=true;this.moving=true;this.reason='Move across the stone, then click to choose.';const r=this.canvas.getBoundingClientRect();this.lastUpdate=-Infinity;this.move(r.x+r.width/2,r.y+r.height/2);this.select();}
 move(x,y){if(!this.active||!this.moving||performance.now()-this.lastUpdate<35)return;this.lastUpdate=performance.now();const r=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((x-r.x)/r.width*2-1,-(y-r.y)/r.height*2+1),this.camera);const hit=this.ray.intersectObject(this.stone,false)[0];this.valid=false;this.triangle=hit?.faceIndex??null;
  if(!hit){this.candidate=null;this.reason='Move back onto the stone to see your mark.';if(this.preview){this.preview.visible=true;this.material.opacity=.55;}return;}
  const p=this.stone.worldToLocal(hit.point.clone()),geometry=this.stone.geometry,pos=geometry.attributes.position,normals=geometry.attributes.normal,face=hit.face;const a=new THREE.Vector3().fromBufferAttribute(pos,face.a),b=new THREE.Vector3().fromBufferAttribute(pos,face.b),c=new THREE.Vector3().fromBufferAttribute(pos,face.c),bary=new THREE.Vector3();THREE.Triangle.getBarycoord(p,a,b,c,bary);const n=new THREE.Vector3().fromBufferAttribute(normals,face.a).multiplyScalar(bary.x).addScaledVector(new THREE.Vector3().fromBufferAttribute(normals,face.b),bary.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(normals,face.c),bary.z).normalize();
  const candidate={drawing:this.drawing,positionLocal:p.toArray(),normalLocal:n.toArray(),rotation:[Math.asin(-n.y),Math.atan2(n.x,n.z),this.angle],scale:faceScale(n.toArray()).map((v,i)=>i<2?v*this.size:v),triangleIndex:hit.faceIndex,barycentric:bary.toArray()};this.candidate=candidate;this.refresh();
 }
 adjust(angle,size){this.angle=angle;this.size=size;if(this.candidate){this.candidate.rotation[2]=angle;this.candidate.scale=faceScale(this.candidate.normalLocal).map((v,i)=>i<2?v*size:v);this.refresh();}}
 refresh(){const candidate=this.candidate;if(!candidate)return;
  this.valid=regionValid(candidate.positionLocal,candidate.normalLocal,candidate.scale,candidate.rotation);this.reason=this.valid?'This place is available.':'Keep away from the cap, foot and outer edges.';
  if(this.valid&&this.marks().some(m=>overlaps(candidate,m))){this.valid=false;this.reason='Choose a little space beside the existing mark.';}
  if(this.preview)disposeInscription(this.preview,true);this.preview=null;
  if(regionValid(candidate.positionLocal,candidate.normalLocal,candidate.scale,candidate.rotation)){this.material.opacity=this.valid?1:.45;this.preview=makeInscription(this.stone,candidate,this.material);this.scene.add(this.preview);}
 }
 select(){if(this.valid){this.moving=false;this.material.opacity=1;}}
 cancel(){if(this.preview)disposeInscription(this.preview);else if(this.material){this.material.map?.dispose();this.material.normalMap?.dispose();this.material.dispose();}this.preview=null;this.material=null;this.candidate=null;this.active=false;this.valid=false;this.moving=false;this.triangle=null;}
}
