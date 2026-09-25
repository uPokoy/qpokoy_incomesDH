(function(){
  'use strict';
  const DEV='dev-2026.09.25.37';
  const mobile=window.matchMedia('(max-width:560px)');
  const HALF_WIDTH=44;
  const TRANSITION='transform 200ms cubic-bezier(.22,.8,.25,1)';

  function init(){
    if(!mobile.matches)return;
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar||sidebar.dataset.qpBottomNavReady==='1')return;
    const historyItem=sidebar.querySelector('#historyNavItem');
    if(historyItem){
      historyItem.hidden=false;
      historyItem.removeAttribute('aria-hidden');
    }
    const items=Array.from(sidebar.querySelectorAll('.nav-item[data-page]'));
    if(!items.length)return;
    sidebar.dataset.qpBottomNavReady='1';
    sidebar.classList.add('qp-bottom-nav-ready');
    const indicator=document.createElement('div');
    indicator.className='qp-bottom-nav-indicator';
    indicator.setAttribute('aria-hidden','true');
    sidebar.appendChild(indicator);

    let centers=[];
    let barLeft=0;
    let barWidth=0;
    let pointerId=null;
    let startX=0;
    let startY=0;
    let dragging=false;
    let pendingX=null;
    let writer=0;
    let positionX=HALF_WIDTH;

    function activeIndex(){const index=items.findIndex(item=>item.classList.contains('active'));return index<0?0:index}
    function measure(){const rect=sidebar.getBoundingClientRect();barLeft=rect.left;barWidth=rect.width;centers=items.map(item=>{const itemRect=item.getBoundingClientRect();return itemRect.left+itemRect.width/2-barLeft})}
    function clamp(x){return Math.max(HALF_WIDTH,Math.min(Math.max(HALF_WIDTH,barWidth-HALF_WIDTH),x))}
    function write(x){positionX=clamp(x);indicator.style.transform='translate3d('+(positionX-HALF_WIDTH)+'px,-50%,0)'}
    function queueWrite(){if(!writer)writer=requestAnimationFrame(()=>{writer=0;if(pendingX!==null)write(pendingX)})}
    function cancelWrite(){if(writer){cancelAnimationFrame(writer);writer=0}pendingX=null}
    function setTransition(enabled){indicator.style.transition=enabled?TRANSITION:'none'}
    function nearest(x){let chosen=0;let distance=Infinity;centers.forEach((center,index)=>{const next=Math.abs(center-x);if(next<distance){distance=next;chosen=index}});return chosen}
    function currentX(){const transform=getComputedStyle(indicator).transform;if(!transform||transform==='none')return positionX;const values=transform.match(/matrix(?:3d)?\(([^)]+)\)/);if(!values)return positionX;const parts=values[1].split(',').map(Number);const offset=transform.startsWith('matrix3d')?parts[12]:parts[4];return Number.isFinite(offset)?offset+HALF_WIDTH:positionX}
    function moveToActive(){if(pointerId!==null||!centers.length)return;setTransition(true);write(centers[activeIndex()])}
    function release(event,commit){if(event.pointerId!==pointerId)return;const wasDragging=dragging;pointerId=null;if(sidebar.hasPointerCapture(event.pointerId))sidebar.releasePointerCapture(event.pointerId);if(wasDragging){event.preventDefault();cancelWrite();const finalFingerX=clamp(event.clientX-barLeft);write(finalFingerX);const target=nearest(finalFingerX);setTransition(true);write(centers[target]);if(commit&&target!==activeIndex())items[target].click()}else setTransition(true);dragging=false}

    sidebar.addEventListener('pointerdown',event=>{if(!mobile.matches||!event.isPrimary||pointerId!==null)return;measure();pointerId=event.pointerId;startX=event.clientX;startY=event.clientY;dragging=false});
    sidebar.addEventListener('pointermove',event=>{if(event.pointerId!==pointerId)return;const dx=event.clientX-startX;const dy=event.clientY-startY;if(!dragging){if(Math.abs(dx)<6||Math.abs(dx)<=Math.abs(dy))return;dragging=true;positionX=currentX();setTransition(false);write(positionX);sidebar.setPointerCapture(event.pointerId)}event.preventDefault();pendingX=clamp(event.clientX-barLeft);queueWrite()},{passive:false});
    sidebar.addEventListener('pointerup',event=>release(event,true),{passive:false});
    sidebar.addEventListener('pointercancel',event=>{release(event,false);moveToActive()},{passive:false});
    const observer=new MutationObserver(records=>{if(records.some(record=>record.attributeName==='class'))moveToActive()});
    items.forEach(item=>observer.observe(item,{attributes:true,attributeFilter:['class']}));
    const refresh=()=>{if(!mobile.matches)return;measure();setTransition(false);write(centers[activeIndex()]);setTransition(true)};
    window.addEventListener('resize',refresh,{passive:true});
    window.addEventListener('orientationchange',refresh,{passive:true});
    measure();
    write(centers[activeIndex()]);
    const label=document.getElementById('qPokoyDevVersion');
    if(label)label.textContent=DEV;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();