import {moveWithCollision,WALK} from '../walk.js?v=island-controls-2';
// A brief invitation into the landscape. Visitor input always wins.
export class EntryMotion{
 constructor(){this.active=false;this.elapsed=0;this.duration=1.6;}
 begin(camera,nav,reduced){this.active=!reduced;this.elapsed=0;this.yaw=nav.targetYaw;this.pitch=nav.targetPitch;this.previous=0;}
 update(dt,camera,nav,sample,blocked){if(!this.active)return;if(!nav.entered||blocked||nav.keys.size||Math.hypot(...nav.stick)>.01||Math.abs(nav.targetYaw-this.yaw)>.001||Math.abs(nav.targetPitch-this.pitch)>.001){this.active=false;return;}this.elapsed=Math.min(this.duration,this.elapsed+dt);const t=this.elapsed/this.duration,s=t*t*t*(t*(t*6-15)+10),step=(s-this.previous)*.85;this.previous=s;if(sample){const [x,z]=moveWithCollision([camera.position.x,camera.position.z],-Math.sin(this.yaw)*step,-Math.cos(this.yaw)*step,sample);const ground=sample(x,z);if(ground!==null)camera.position.set(x,ground+WALK.eyeHeight,z);}if(t>=1)this.active=false;}
}
