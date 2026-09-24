// Calibración: desplazamientos en píxeles del activo, rotación en grados.
const DEBUG = true;
const MASK_SCALE = 1;
const MASK_OFFSET_X = 0;
const MASK_OFFSET_Y = 0;
const MASK_ROTATION_OFFSET = 0;
const SMOOTHING = 0.65; // 0 = inmediato; <1. Mayor valor = más estabilización.
// Rasgos reales: 1 = tamaño original. La escala vertical multiplica la general.
const LEFT_EYE_SCALE = 1.50;
const RIGHT_EYE_SCALE = 1.50;
const MOUTH_SCALE = 1.40;
const EYE_VERTICAL_SCALE = 1.40;
const MOUTH_VERTICAL_SCALE = 1.40;
const MAX_FPS = 30;
const PNG_ANCHORS = { left: [390/1024,705/1536], right: [645/1024,705/1536], mouth: [515/1024,923/1536] };
const VERSION = '0.10.21';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
let tracker, stream, frame, active = false, busy = false, previousTime = -1, lastTick = 0, pose = null;
let mask, anchors, fallback = true, width = 0, height = 0;
const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
function status(message = '') { $('status').textContent = message; $('status').hidden = !message; }

async function loadMask() {
  // Nunca sustituir el personaje original por un diseño de prueba.
  try {
    const img = new Image();img.src = './elote-ranchero.png';await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
    const data=g.getImageData(0,0,c.width,c.height).data;
    const alpha=(x,y)=>data[(Math.floor(y)*c.width+Math.floor(x))*4+3];
    const points=Object.fromEntries(Object.entries(PNG_ANCHORS).map(([k,[x,y]])=>[k,[x*c.width,y*c.height]]));
    // Revisar área central de cada hueco, no solo un único píxel transparente.
    const clearHole=([x,y])=>{for(let dy=-8;dy<=8;dy+=4)for(let dx=-8;dx<=8;dx+=4)if(alpha(x+dx,y+dy)>10)return false;return true;};
    let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]<10)transparent++;
    if(transparent < c.width*c.height*.05 || !Object.values(points).every(clearHole)) {
      throw new Error('El PNG original requiere transparencia real en el exterior, ojos y boca.');
    }
    mask=img;anchors=points;fallback=false;
  } catch(e) { console.error('No se pudo cargar/verificar el PNG original. No se sustituirá el diseño.',e);throw e; }
}
function resize() {
  const r=$('stage').getBoundingClientRect();width=r.width;height=r.height;
  const dpr=Math.min(devicePixelRatio || 1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);pose=null;
}
// Misma transformación cover que el video. Ambos se reflejan juntos en CSS.
function project(p) {
  const s=Math.max(width/video.videoWidth,height/video.videoHeight);
  return {x:p.x*video.videoWidth*s+(width-video.videoWidth*s)/2,y:p.y*video.videoHeight*s+(height-video.videoHeight*s)/2};
}
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
// Tres recortes independientes reutilizados; no hay lecturas de píxeles por cuadro.
const featureLayers = Array.from({length:3},()=>{
  const image=document.createElement('canvas');image.width=256;image.height=256;
  return {image,context:image.getContext('2d'),pose:null};
});
const feather=document.createElement('canvas');feather.width=256;feather.height=256;
const featherContext=feather.getContext('2d');
const featherGradient=featherContext.createRadialGradient(128,128,0,128,128,128);
featherGradient.addColorStop(0,'rgba(255,255,255,1)');
featherGradient.addColorStop(.68,'rgba(255,255,255,1)');
featherGradient.addColorStop(1,'rgba(255,255,255,0)');
featherContext.fillStyle=featherGradient;featherContext.fillRect(0,0,256,256);

function drawEnlargedFeatures(points, angle, smoothing, reset) {
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const eye=(a,b,top,bottom,scale)=>{
    const span=distance(points[a],points[b]);
    return {center:midpoint(points[a],points[b]),rx:span*.85,
      ry:Math.max(span*.48,distance(points[top],points[bottom])*.9),scale,vertical:EYE_VERTICAL_SCALE};
  };
  // Izquierda/derecha anatómicas de la persona, antes del espejo compartido.
  const mouthSpan=distance(points[61],points[291]);
  const features=[eye(362,263,386,374,LEFT_EYE_SCALE),eye(33,133,159,145,RIGHT_EYE_SCALE),
    {center:midpoint(points[13],points[14]),rx:mouthSpan*.8,
      ry:Math.max(mouthSpan*.42,distance(points[0],points[17])*.75),scale:MOUTH_SCALE,vertical:MOUTH_VERTICAL_SCALE}];
  const cover=Math.max(width/video.videoWidth,height/video.videoHeight);
  const videoWidth=video.videoWidth*cover,videoHeight=video.videoHeight*cover;
  features.forEach((feature,index)=>{
    const layer=featureLayers[index],g=layer.context;
    const target={x:feature.center.x,y:feature.center.y,rx:feature.rx,ry:feature.ry,r:angle};
    if(reset || !layer.pose)layer.pose={...target};
    const p=layer.pose;
    for(const key of ['x','y','rx','ry'])p[key]+=(target[key]-p[key])*smoothing;
    p.r+=Math.atan2(Math.sin(angle-p.r),Math.cos(angle-p.r))*smoothing;
    if(feature.rx<1 || feature.ry<1 || (feature.scale===1 && feature.vertical===1))return;
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,256,256);
    // Muestrear el cuadro actual en su centro real: los párpados y labios no
    // se suavizan temporalmente, solo la geometría de colocación del recorte.
    g.save();g.translate(128,128);g.scale(128/feature.rx,128/feature.ry);
    g.rotate(-angle);g.translate(-target.x,-target.y);
    g.drawImage(video,(width-videoWidth)/2,(height-videoHeight)/2,videoWidth,videoHeight);
    g.restore();
    g.globalCompositeOperation='destination-in';g.drawImage(feather,0,0);
    g.globalCompositeOperation='source-over';
    const rx=p.rx*Math.max(.1,feature.scale),ry=p.ry*Math.max(.1,feature.scale)*Math.max(.1,feature.vertical);
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);
    ctx.drawImage(layer.image,-rx,-ry,rx*2,ry*2);ctx.restore();
  });
}
function render(landmarks, dt) {
  ctx.clearRect(0,0,width,height);
  if(!landmarks){pose=null;status('Coloca una cara frente a la cámara');$('debug').hidden=true;return;}
  status();
  const points=landmarks.map(project);
  const left=midpoint(points[33],points[133]),right=midpoint(points[362],points[263]);
  const center=midpoint(left,right), mouth=midpoint(points[13],points[14]);
  const eyeDistance=Math.hypot(right.x-left.x,right.y-left.y);
  const angle=Math.atan2(right.y-left.y,right.x-left.x);
  const ax=(anchors.left[0]+anchors.right[0])/2,ay=(anchors.left[1]+anchors.right[1])/2;
  const sx=eyeDistance/(anchors.right[0]-anchors.left[0])*MASK_SCALE;
  // Ajuste vertical independiente para alinear también la boca con diferentes proporciones.
  const mouthHeight=-(mouth.x-center.x)*Math.sin(angle)+(mouth.y-center.y)*Math.cos(angle);
  const sy=Math.max(sx*.65,Math.min(sx*1.5,mouthHeight/(anchors.mouth[1]-ay)*MASK_SCALE));
  const target={x:center.x,y:center.y,sx,sy,r:angle+MASK_ROTATION_OFFSET*Math.PI/180};
  const resetFeatures=!pose;
  if(!pose)pose={...target};
  const t=1-Math.pow(Math.min(.98,Math.max(0,SMOOTHING)),Math.min(dt,100)/(1000/30));
  for(const key of ['x','y','sx','sy'])pose[key]+=(target[key]-pose[key])*t;
  pose.r+=Math.atan2(Math.sin(target.r-pose.r),Math.cos(target.r-pose.r))*t;
  drawEnlargedFeatures(points,angle,t,resetFeatures);
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.r);ctx.scale(pose.sx,pose.sy);
  ctx.drawImage(mask,-ax+MASK_OFFSET_X,-ay+MASK_OFFSET_Y);ctx.restore();
  if(DEBUG) {
    ctx.strokeStyle='#78ffca';ctx.lineWidth=1.5;ctx.beginPath();oval.forEach((i,k)=>{const p=points[i];k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.closePath();ctx.stroke();
    for(const p of [left,right,midpoint(points[10],points[152])]){ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#ff5777';ctx.fill();}
    $('debug').hidden=false;$('debug').textContent=`Scale: ${MASK_SCALE.toFixed(2)} (${pose.sx.toFixed(2)} px/px)\nOffset X: ${MASK_OFFSET_X}\nOffset Y: ${MASK_OFFSET_Y}\nRotation: ${(pose.r*180/Math.PI).toFixed(1)}°\nRotation offset: ${MASK_ROTATION_OFFSET}°`;
  }
}
function loop(now) {
  if(!active)return;
  try {
    if(!document.hidden && video.readyState>=2 && video.currentTime!==previousTime && now-lastTick>=1000/MAX_FPS) {
      const dt=lastTick?now-lastTick:33;lastTick=now;previousTime=video.currentTime;
      render(tracker.detectForVideo(video,now).faceLandmarks[0],dt);
    }
    frame=requestAnimationFrame(loop);
  } catch(e) { console.error(e);stop();status('Se interrumpió el seguimiento. Vuelve a activar la cámara.'); }
}
async function initializeTracker() {
  if(tracker)return;
  const {FaceLandmarker,FilesetResolver}=await import(`${CDN}/vision_bundle.mjs`);
  const files=await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const options={baseOptions:{modelAssetPath:MODEL,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6};
  try{tracker=await FaceLandmarker.createFromOptions(files,options);}catch{options.baseOptions.delegate='CPU';tracker=await FaceLandmarker.createFromOptions(files,options);}
}
async function start() {
  if(busy || active)return;busy=true;$('start').disabled=true;
  try {
    if(!isSecureContext || !navigator.mediaDevices?.getUserMedia)throw new Error('Abre esta página mediante HTTPS o localhost para utilizar la cámara.');
    status('Permite el acceso a tu cámara…');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}});
    video.srcObject=stream;await video.play();status('Preparando el filtro…');
    await loadMask();await initializeTracker();
    if(document.hidden){stop();return;}
    active=true;previousTime=-1;lastTick=0;resize();$('welcome').hidden=true;$('stop').hidden=false;
    $('asset-note').hidden=!fallback;document.body.classList.add('active');
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(active){stop();status('La cámara se desconectó. Puedes activarla nuevamente.');}});
    frame=requestAnimationFrame(loop);
  } catch(e) {
    console.error(e);stop();
    const messages={NotAllowedError:'No se autorizó la cámara. Permite su acceso en el navegador y vuelve a intentarlo.',NotFoundError:'No se encontró una cámara en este dispositivo.',NotReadableError:'La cámara está ocupada. Cierra otras aplicaciones e inténtalo de nuevo.'};
    status(messages[e.name] || (e.message.includes('HTTPS')?e.message:'No se pudo preparar el filtro. Revisa tu conexión a internet y vuelve a intentarlo.'));
  } finally {busy=false;$('start').disabled=false;}
}
function stop() {
  active=false;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;
  video.srcObject=null;pose=null;ctx.clearRect(0,0,width,height);$('welcome').hidden=false;
  $('stop').hidden=true;$('asset-note').hidden=true;$('debug').hidden=true;document.body.classList.remove('active');status();
}
$('start').addEventListener('click',start);$('stop').addEventListener('click',stop);
window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);
document.addEventListener('visibilitychange',()=>{if(document.hidden && active)stop();});
resize();
