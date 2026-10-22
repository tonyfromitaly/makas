let state=null;
export async function syncWorld(){state={serverTime:Date.now(),utcOffsetMinutes:0,dev:false,embedOrigins:[],season:'AUTUMN',clock:'17:18'};return state;}
export const world=()=>state;
export const stoneHour=()=>17.3;
export const stoneClock=()=> '17:18';
export const canonicalDate=()=>new Date('2026-11-15T17:18:00Z');
