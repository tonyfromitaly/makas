const banner=document.querySelector('.banner'),frame=banner.querySelector('iframe'),motion=matchMedia('(prefers-reduced-motion: reduce)');
function load(){if(!motion.matches&&!frame.hasAttribute('src'))frame.src=frame.dataset.src;}
addEventListener('message',e=>{if(e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.source==='mona-mile-banner'&&e.data.ready)banner.classList.add('live');});
motion.addEventListener('change',()=>{if(motion.matches){banner.classList.remove('live');frame.removeAttribute('src');}else load();});load();
