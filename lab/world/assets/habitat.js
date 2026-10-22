import * as THREE from 'three';

// Real-time native geometry. No image assets or network generation.
function flowerGeometry(kind){
 const positions=[],colors=[];const add=(a,b,c,color)=>{positions.push(...a,...b,...c);for(let i=0;i<3;i++)colors.push(...color);};
 const green=[.055,.18,.018],stemTop=.34,petalColors=[[.87,.83,.66],[.44,.19,.61],[.91,.61,.035],[.67,.08,.045]],petal=petalColors[kind];
 add([-.003,0,0],[.003,0,0],[.003,stemTop,0],green);add([-.003,0,0],[.003,stemTop,0],[-.003,stemTop,0],green);
 add([0,0,-.003],[0,stemTop,.003],[0,0,.003],green);add([0,0,-.003],[0,stemTop,-.003],[0,stemTop,.003],green);
 add([0,.12,0],[.035,.21,.006],[.006,.19,0],green);add([0,.19,0],[-.030,.26,-.006],[-.006,.24,0],green);
 const n=kind===0?10:kind===1?6:5;
 for(let k=0;k<n;k++){
  const a=k*Math.PI*2/n,ca=Math.cos(a),sa=Math.sin(a),radius=kind===0?.025:.030;
  const center=[ca*.025,stemTop,sa*.025];
  for(let j=0;j<8;j++){
   const point=q=>{const t=q*Math.PI*2/8,l=Math.cos(t)*radius,w=Math.sin(t)*.014;return [center[0]+l*ca-w*sa,stemTop+Math.abs(l)*.18+(kind===3?.007:0),center[2]+l*sa+w*ca];};
   add(center,point(j),point(j+1),petal);
  }
 }
 for(let j=0;j<10;j++){const a=j*Math.PI/5,b=(j+1)*Math.PI/5;add([0,stemTop+.005,0],[Math.cos(a)*.011,stemTop+.004,Math.sin(a)*.011],[Math.cos(b)*.011,stemTop+.004,Math.sin(b)*.011],kind===3?[.04,.025,.01]:[.62,.33,.02]);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
export function createHabitat(scene,sample,mobile){
 const group=new THREE.Group();group.name='SEASONAL_MEADOW_HABITAT';scene.add(group);
 let seed=6719;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const bloom={value:0},wind={value:0},time={value:0};const flowers=[];let flowerCount=0;
 for(let kind=0;kind<4;kind++){
  seed=6719+kind*7919;
  const count=mobile?150:360,mat=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  mat.onBeforeCompile=s=>{s.uniforms.habitatBloom=bloom;s.uniforms.habitatWind=wind;s.uniforms.habitatTime=time;s.vertexShader='uniform float habitatBloom,habitatWind,habitatTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed*=habitatBloom;transformed.x+=sin(habitatTime*.8+float(gl_InstanceID)*1.13)*position.y*position.y*.045*habitatWind;');};
  const mesh=new THREE.InstancedMesh(flowerGeometry(kind),mat,count),dummy=new THREE.Object3D();let used=0;
  for(let tries=0;tries<count*30&&used<count;tries++){
   const x=(rnd()-.5)*10.2,z=rnd()*18-5.8,y=sample(x,z);
   if(y===null||y<-.20||Math.hypot(x,z)<.72)continue;
   // Broad overlapping colonies; species are mixed, not arranged as a garden.
   const colony=.45+.30*Math.sin(x*.9+kind*1.8)*Math.cos(z*.6-kind);if(rnd()>colony)continue;
   dummy.position.set(x,y+.004,z);dummy.rotation.set((rnd()-.5)*.28,rnd()*Math.PI*2,(rnd()-.5)*.24);dummy.scale.setScalar(.52+rnd()*.80);dummy.updateMatrix();mesh.setMatrixAt(used++,dummy.matrix);
  }
  mesh.count=used;flowerCount+=used;mesh.name=['Meadow daisies','Violet wildflowers','Golden buttercups','Red field flowers'][kind];mesh.frustumCulled=false;mesh.receiveShadow=true;group.add(mesh);flowers.push(mesh);
 }
 const rainCount=mobile?700:1900,snowCount=mobile?1000:2400;
 function particles(snow){
  const count=snow?snowCount:rainCount,positions=[],seeds=[],ends=[];
  for(let i=0;i<count;i++){
   const p=[(rnd()-.5)*22,rnd()*10,(rnd()-.5)*22],r=rnd();
   for(let j=0;j<(snow?1:2);j++){positions.push(...p);seeds.push(r);ends.push(j);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('dropSeed',new THREE.Float32BufferAttribute(seeds,1));geo.setAttribute('dropEnd',new THREE.Float32BufferAttribute(ends,1));
  const uniforms={clock:{value:0},strength:{value:0},breeze:{value:.3},baseY:{value:0},night:{value:0}};
  const vertex=`uniform float clock,breeze,baseY;attribute float dropSeed,dropEnd;varying float dropAlpha;void main(){vec3 p=position;float speed=${snow?'(.38+dropSeed*.34)':'(8.+dropSeed*4.)'};p.y=mod(p.y-clock*speed+10000.,10.);p.x+=${snow?'sin(clock*.6+dropSeed*19.)*.38':'p.y*breeze*.25'};p.z+=${snow?'cos(clock*.43+dropSeed*23.)*.27':'p.y*breeze*.09'};${snow?'':'p.y+=dropEnd*.28;'}p.y+=baseY;vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;${snow?'gl_PointSize=clamp((36.+dropSeed*24.)/max(1.,-view.z),1.5,7.);':''}dropAlpha=smoothstep(0.,.4,p.y-baseY)*(.5+dropSeed*.5);}`;
  const fragment=`uniform float strength,night;varying float dropAlpha;void main(){${snow?'float a=1.-smoothstep(.18,.5,length(gl_PointCoord-.5));':'float a=.52;'}vec3 c=mix(${snow?'vec3(.88,.92,.96)':'vec3(.42,.55,.64)'},vec3(.32,.43,.60),night*.65);gl_FragColor=vec4(c,a*strength*dropAlpha);}`;
  const mat=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false});
  const mesh=snow?new THREE.Points(geo,mat):new THREE.LineSegments(geo,mat);mesh.frustumCulled=false;mesh.name=snow?'Intermittent snowfall':'Coastal rain';scene.add(mesh);return {mesh,uniforms,count};
 }
 const rain=particles(false),snow=particles(true);
 return {update(state,camera,clock,night){
  bloom.value=state.flowerBloom;wind.value=state.wind;time.value=clock;
  for(const f of flowers)f.visible=bloom.value>.025;
  for(const [p,amount] of [[rain,state.rain],[snow,state.snow]]){p.mesh.visible=amount>.015;p.mesh.position.set(camera.position.x,0,camera.position.z);p.uniforms.clock.value=clock;p.uniforms.strength.value=amount;p.uniforms.breeze.value=state.wind;p.uniforms.baseY.value=camera.position.y-1.7;p.uniforms.night.value=night;}
 },dispose(){scene.remove(group);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});for(const p of [rain,snow]){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();}},stats(){return {flowerCount,flowerSpecies:4,rainParticles:rain.mesh.visible?rain.count:0,snowParticles:snow.mesh.visible?snow.count:0,bloom:bloom.value,precipitationTime:rain.uniforms.clock.value};}};
}
