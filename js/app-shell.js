(function(){
  'use strict';
  const DEV='dev-2026.09.15.14';
  const mobile=window.matchMedia('(max-width:560px)');

  function syncDesktopShell(){
    if(mobile.matches)return;
    const page=document.querySelector('.page.active') || document.querySelector('main');
    const sidebar=document.querySelector('.sidebar');
    const add=document.querySelector('.add-income-btn');
    if(!page||!sidebar)return;
    const r=page.getBoundingClientRect();
    sidebar.style.setProperty('left',Math.round(r.left)+'px','important');
    sidebar.style.setProperty('right','auto','important');
    sidebar.style.setProperty('width',Math.round(r.width)+'px','important');
    sidebar.style.setProperty('transform','none','important');
    if(add){
      const a=Math.max(16,window.innerWidth-r.right+16);
      add.style.setProperty('right',Math.round(a)+'px','important');
      add.style.setProperty('bottom','84px','important');
    }
  }

  function initNativeMobileNav(){
    if(!mobile.matches)return;
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar||sidebar.dataset.qpNativeNavReady==='1')return;
    const items=Array.from(sidebar.querySelectorAll('.nav-item[data-page]'));
    if(!items.length)return;
    sidebar.dataset.qpNativeNavReady='1';
    sidebar.classList.add('qp-native-nav-ready');
    const indicator=document.createElement('div');
    indicator.className='qp-native-nav-indicator';
    indicator.setAttribute('aria-hidden','true');
    const track=document.createElement('div');
    track.className='qp-native-nav-track';
    track.setAttribute('aria-hidden','true');
    const rail=document.createElement('div');
    rail.className='qp-native-nav-rail';
    items.forEach(()=>{const snap=document.createElement('div');snap.className='qp-native-nav-snap';rail.appendChild(snap)});
    track.appendChild(rail);
    sidebar.append(indicator,track);
    let centers=[];
    let step=0;
    function activeIndex(){const index=items.findIndex(item=>item.classList.contains('active'));return index<0?0:index}
    function measure(){const bar=sidebar.getBoundingClientRect();step=track.clientWidth;rail.style.width=(step*items.length)+'px';centers=items.map(item=>{const rect=item.getBoundingClientRect();return rect.left+rect.width/2-bar.left})}
    function indicatorX(){if(!step||!centers.length)return;const raw=Math.max(0,Math.min(items.length-1,track.scrollLeft/step));const left=Math.floor(raw);const right=Math.min(items.length-1,left+1);const x=centers[left]+(centers[right]-centers[left])*(raw-left);indicator.style.setProperty('--qp-native-nav-x',x+'px')}
    function scrollToIndex(index,behavior){if(step)track.scrollTo({left:index*step,behavior})}
    function selectIndex(index,behavior){const item=items[index];if(!item)return;scrollToIndex(index,behavior);if(!item.classList.contains('active'))item.click()}
    function settle(){if(step)selectIndex(Math.max(0,Math.min(items.length-1,Math.round(track.scrollLeft/step))),'auto')}
    track.addEventListener('scroll',indicatorX,{passive:true});
    track.addEventListener('scrollend',settle,{passive:true});
    track.addEventListener('click',event=>{const rect=track.getBoundingClientRect();const index=Math.max(0,Math.min(items.length-1,Math.floor((event.clientX-rect.left)/rect.width*items.length)));selectIndex(index,'smooth')});
    const observer=new MutationObserver(records=>{if(records.some(record=>record.attributeName==='class'))scrollToIndex(activeIndex(),'smooth')});
    items.forEach(item=>observer.observe(item,{attributes:true,attributeFilter:['class']}));
    const refresh=()=>{if(!mobile.matches)return;measure();scrollToIndex(activeIndex(),'auto');indicatorX()};
    window.addEventListener('resize',refresh,{passive:true});
    window.addEventListener('orientationchange',refresh,{passive:true});
    refresh();
  }

  function setDev(){const label=document.getElementById('qPokoyDevVersion');if(label)label.textContent=DEV}
  window.addEventListener('load',()=>{syncDesktopShell();initNativeMobileNav();setDev()},{passive:true});
  window.addEventListener('resize',syncDesktopShell,{passive:true});
  document.addEventListener('DOMContentLoaded',()=>{syncDesktopShell();initNativeMobileNav();setDev()},{passive:true});
  if(document.readyState!=='loading'){syncDesktopShell();initNativeMobileNav();setDev()}
  requestAnimationFrame(syncDesktopShell);
  setTimeout(syncDesktopShell,100);
})();