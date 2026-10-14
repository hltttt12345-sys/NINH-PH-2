'use strict';
(() => {
  const q=s=>document.querySelector(s); const fmt=n=>Number(n||0).toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1});
  const dt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('vi-VN')};
  const dur=s=>{s=Math.max(0,Number(s||0));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=Math.floor(s%60);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if(location.pathname==='/login'){if(new URLSearchParams(location.search).get('error')==='1')q('#loginError')?.classList.add('show');return;}
  const e={source:q('#sourceState'),shift:q('#shiftName'),window:q('#shiftWindow'),clock:q('#clock'),total:q('#totalCurrent'),run:q('#runningCount'),stop:q('#stoppedCount'),off:q('#offlineCount'),last:q('#lastSync'),machines:q('#machines'),rows:q('#historyRows'),days:q('#daysFilter'),machine:q('#machineFilter')};
  for(let id=9;id<=22;id++){const o=document.createElement('option');o.value=String(id);o.textContent=`Máy ${String(id).padStart(2,'0')}`;e.machine.appendChild(o);}
  let latest=null;
  function online(){if(!latest)return false;const t=new Date(latest.receivedAt||latest.sentAt).getTime();return Number.isFinite(t)&&Date.now()-t<=25000&&latest.reading!==false;}
  function stateOf(m,isOnline){if(!isOnline||!m.connected)return ['Mất kết nối','off'];if(m.realtimeCode==='DOFFING')return ['Đổ sợi','doff'];if(m.runState===true)return ['Đang chạy','run'];if(m.realtimeCode==='STOP_TROUBLE')return ['Dừng / sự cố','stop'];return ['Đang dừng','stop'];}
  function render(){
    const isOnline=online();e.clock.textContent=new Date().toLocaleString('vi-VN');e.source.classList.toggle('online',isOnline);e.source.classList.toggle('offline',!isOnline);e.source.lastChild.textContent=isOnline?'SCADA đang trực tuyến':'SCADA mất kết nối';
    if(!latest)return; e.shift.textContent=latest.shift?.name||'Ca hiện tại';e.window.textContent=`${dt(latest.shift?.start)} → ${dt(latest.shift?.end)}`;
    const ms=Array.isArray(latest.machines)?latest.machines:[];let total=0,run=0,stop=0,off=0;
    for(const m of ms){total+=Number(m.currentM||0);if(!isOnline||!m.connected)off++;else if(m.runState===true)run++;else stop++;}
    e.total.textContent=fmt(total);e.run.textContent=run;e.stop.textContent=stop;e.off.textContent=off;e.last.textContent=`Nhận dữ liệu: ${dt(latest.receivedAt||latest.sentAt)}`;
    e.machines.innerHTML=ms.map(m=>{const [label,cls]=stateOf(m,isOnline);const stale=!isOnline||!m.connected?' stale':'';return `<article class="machine-card${stale}"><div class="head"><h3>MÁY ${String(m.number).padStart(2,'0')}</h3><span class="status ${cls}">${label}</span></div><div class="values four"><div class="metric"><span>Sản lượng ca</span><strong>${fmt(m.currentM)} m</strong></div><div class="metric"><span>Cọc</span><strong>${fmt(m.spindle)} rpm</strong></div><div class="metric"><span>Lô</span><strong>${fmt(m.roller)} rpm</strong></div><div class="metric"><span>Tần số</span><strong>${Number(m.frequencyHz||0).toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2})} Hz</strong></div></div><div class="mini"><span>RUN <b>${dur(m.runtimeSeconds)}</b></span><span>STOP <b>${dur(m.stoptimeSeconds)}</b></span><span>Tổng <b>${fmt(m.totalM)} m</b></span></div><div class="foot">${esc(m.status||'—')}<br>Cập nhật: ${m.lastAt?dt(m.lastAt):'—'}</div></article>`}).join('');
  }
  async function loadLatest(){const r=await fetch('/api/latest',{cache:'no-store'});if(r.status===401){location.href='/login';return;}const d=await r.json();latest=d.latest;render();}
  async function loadHistory(){const r=await fetch(`/api/history?days=${encodeURIComponent(e.days.value)}&machine=${encodeURIComponent(e.machine.value)}`,{cache:'no-store'});if(!r.ok)return;const d=await r.json();const rows=d.records||[];e.rows.innerHTML=rows.length?rows.map(x=>`<tr><td>${x.workDate||dt(x.start)}</td><td>${esc(x.shift||'')}</td><td>Máy ${String(x.machine).padStart(2,'0')}</td><td><strong>${fmt(x.productionM)} m</strong></td><td>${dur(x.runtimeSeconds)}</td><td>${dur(x.stoptimeSeconds)}</td><td>${dt(x.end)}</td></tr>`).join(''):`<tr><td class="empty" colspan="7">Chưa có dữ liệu lịch sử.</td></tr>`;}
  e.days?.addEventListener('change',loadHistory);e.machine?.addEventListener('change',loadHistory);setInterval(render,1000);setInterval(loadLatest,15000);loadLatest().catch(()=>render());loadHistory();
  try{const es=new EventSource('/api/events');es.addEventListener('snapshot',ev=>{latest=JSON.parse(ev.data).latest;render();loadHistory();});}catch{}
})();
