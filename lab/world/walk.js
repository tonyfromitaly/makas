export const WALK={speed:1.4,shiftSpeed:1.65,eyeHeight:1.7,acceleration:6,playerRadius:.24,stoneX:.60,stoneZ:.50,interactionRadius:1.25,start:[0,7.55],bounds:{minX:-10.7,maxX:10.7,minZ:-9.7,maxZ:25.7},minimumGround:-.82};
// Exact source triangles are indexed once into a lightweight XZ heightfield.
export function terrainSampler(geometry){
 const pos=geometry.attributes.position,index=geometry.index;
 const xs=[...new Set(Array.from({length:pos.count},(_,i)=>pos.getX(i).toFixed(5)))].map(Number).sort((a,b)=>a-b);
 const zs=[...new Set(Array.from({length:pos.count},(_,i)=>pos.getZ(i).toFixed(5)))].map(Number).sort((a,b)=>a-b);
 const locate=(list,v)=>{let l=0,r=list.length-1;while(l+1<r){const m=(l+r)>>1;if(list[m]<=v)l=m;else r=m;}return Math.min(l,list.length-2);};
 const cells=new Map(),count=index?index.count:pos.count;
 for(let k=0;k<count;k+=3){const vertices=[0,1,2].map(j=>{const i=index?index.getX(k+j):k+j;return [pos.getX(i),pos.getY(i),pos.getZ(i)];});const cx=vertices.reduce((s,v)=>s+v[0],0)/3,cz=vertices.reduce((s,v)=>s+v[2],0)/3,key=locate(xs,cx)+','+locate(zs,cz);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(vertices);}
 return (x,z)=>{
  if(x<xs[0]||x>xs.at(-1)||z<zs[0]||z>zs.at(-1))return null;
  const triangles=cells.get(locate(xs,x)+','+locate(zs,z))||[];
  for(const [a,b,c] of triangles){const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-12)continue;const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den,w=1-u-v;if(Math.min(u,v,w)>=-.0001)return u*a[1]+v*b[1]+w*c[1];}
  return null;
 };
}
export function stoneClear(x,z){return (x/WALK.stoneX)**2+(z/WALK.stoneZ)**2>=1;}
export function walkable(x,z,sample){const b=WALK.bounds;if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||!stoneClear(x,z))return false;const y=sample(x,z);if(y===null||!Number.isFinite(y)||y<WALK.minimumGround)return false;const margin=WALK.playerRadius;for(const [dx,dz] of [[margin,0],[-margin,0],[0,margin],[0,-margin]]){const edge=sample(x+dx,z+dz);if(edge===null||!Number.isFinite(edge)||edge<WALK.minimumGround)return false;}return true;}
export function moveWithCollision(position,dx,dz,sample){
 let [x,z]=position;const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.06));dx/=steps;dz/=steps;
 for(let i=0;i<steps;i++){if(walkable(x+dx,z+dz,sample)){x+=dx;z+=dz;}else {if(walkable(x+dx,z,sample))x+=dx;if(walkable(x,z+dz,sample))z+=dz;}}
 return [x,z];
}
