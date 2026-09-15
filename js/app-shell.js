(function(){
  function syncAppShell(){
    if(window.matchMedia('(max-width:560px)').matches)return;
    const page=document.querySelector('.page.active') || document.querySelector('main');
    const sidebar=document.querySelector('.sidebar');
    const add=document.querySelector('.add-income-btn');
    if(!page||!sidebar)return;
    const r=page.getBoundingClientRect();
    sidebar.style.setProperty('left', Math.round(r.left)+'px','important');
    sidebar.style.setProperty('right','auto','important');
    sidebar.style.setProperty('width', Math.round(r.width)+'px','important');
    sidebar.style.setProperty('transform','none','important');
    if(add){
      const a=Math.max(16, window.innerWidth-r.right+16);
      add.style.setProperty('right', Math.round(a)+'px','important');
      add.style.setProperty('bottom','84px','important');
    }
  }
  window.addEventListener('load',syncAppShell,{passive:true});
  window.addEventListener('resize',syncAppShell,{passive:true});
  document.addEventListener('DOMContentLoaded',syncAppShell,{passive:true});
  requestAnimationFrame(syncAppShell);
  setTimeout(syncAppShell,100);

  /* Mobile bottom navigation: drag the finger across the bar, then switch
     to the highlighted section when the finger is released. Normal taps remain intact. */
  const qPokoyMobileNavDevVersion='dev-2026.09.15.01';

  function qPokoySetMobileNavDevVersion(){
    const label=document.getElementById('qPokoyDevVersion');
    if(label)label.textContent=qPokoyMobileNavDevVersion;
  }

  function qPokoyInstallMobileNavDragStyles(){
    if(document.getElementById('qPokoyMobileNavDragStyles'))return;
    const style=document.createElement('style');
    style.id='qPokoyMobileNavDragStyles';
    style.textContent=`
      @media (max-width:560px){
        .sidebar.qp-nav-drag-ready{touch-action:pan-y;}
        .sidebar.qp-nav-drag-ready .nav-item{position:relative;z-index:4;}
        .sidebar.qp-nav-dragging,
        .sidebar.qp-nav-drag-settling{overflow:visible !important;}
        .sidebar.qp-nav-dragging .nav-item.active{background:transparent !important;}
        .sidebar .qp-nav-drag-lens{
          position:absolute;
          top:50%;
          left:0;
          width:74px;
          height:74px;
          margin:0;
          border:1px solid color-mix(in srgb,var(--primary) 42%,rgba(255,255,255,.30));
          border-radius:999px;
          background:
            radial-gradient(circle at 32% 22%,rgba(255,255,255,.18),transparent 34%),
            color-mix(in srgb,var(--panel) 70%,rgba(35,48,68,.28));
          box-shadow:
            0 10px 28px rgba(0,0,0,.28),
            inset 0 1px 0 rgba(255,255,255,.16),
            inset 0 -1px 0 rgba(255,255,255,.05),
            0 0 0 1px color-mix(in srgb,var(--primary) 18%,transparent);
          -webkit-backdrop-filter:blur(18px) saturate(155%);
          backdrop-filter:blur(18px) saturate(155%);
          pointer-events:none;
          opacity:0;
          z-index:3;
          transform:translate3d(0,-50%,0);
          will-change:transform,opacity;
          transition:opacity .12s ease;
        }
        .sidebar.qp-nav-dragging .qp-nav-drag-lens,
        .sidebar.qp-nav-drag-settling .qp-nav-drag-lens{opacity:1;}
        .sidebar.qp-nav-drag-settling .qp-nav-drag-lens{
          transition:transform .18s cubic-bezier(.2,.8,.2,1),opacity .14s ease;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview{
          background:transparent !important;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview .nav-icon,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview .nav-icon{
          color:var(--primary) !important;
          transform:scale(1.12);
          transform-origin:center;
          transition:transform .12s ease,color .12s ease;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview .nav-label,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview .nav-label{
          color:var(--primary) !important;
          transition:color .12s ease;
        }
        #qPokoyDevVersion{font-size:0 !important;}
        #qPokoyDevVersion::after{
          content:"${qPokoyMobileNavDevVersion}" !important;
          font-size:12px !important;
          line-height:1.2 !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function qPokoyInitMobileNavDrag(){
    const mobile=window.matchMedia('(max-width:560px)');
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar || sidebar.dataset.qpNavDragReady==='1')return;

    sidebar.dataset.qpNavDragReady='1';
    sidebar.classList.add('qp-nav-drag-ready');

    const lens=document.createElement('div');
    lens.className='qp-nav-drag-lens';
    lens.setAttribute('aria-hidden','true');
    sidebar.appendChild(lens);

    let pointerId=null;
    let startX=0;
    let startY=0;
    let dragging=false;
    let previewItem=null;
    let suppressNativeClick=false;
    let programmaticCommit=false;
    let settleTimer=0;

    function items(){
      return Array.from(sidebar.querySelectorAll('.nav-item[data-page]'));
    }

    function nearestItem(clientX){
      const list=items();
      let best=null;
      let bestDistance=Infinity;
      list.forEach(item=>{
        const rect=item.getBoundingClientRect();
        const distance=Math.abs(clientX-(rect.left+rect.width/2));
        if(distance<bestDistance){
          bestDistance=distance;
          best=item;
        }
      });
      return best;
    }

    function setPreview(item){
      if(previewItem===item)return;
      if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
      previewItem=item;
      if(previewItem)previewItem.classList.add('qp-nav-drag-preview');
    }

    function setLensX(clientX){
      const rect=sidebar.getBoundingClientRect();
      const size=74;
      const x=Math.min(rect.width-size/2,Math.max(size/2,clientX-rect.left));
      lens.style.transform=`translate3d(${Math.round(x-size/2)}px,-50%,0)`;
    }

    function settleLens(item){
      if(!item)return;
      const itemRect=item.getBoundingClientRect();
      setLensX(itemRect.left+itemRect.width/2);
      sidebar.classList.remove('qp-nav-dragging');
      sidebar.classList.add('qp-nav-drag-settling');
      clearTimeout(settleTimer);
      settleTimer=setTimeout(()=>{
        sidebar.classList.remove('qp-nav-drag-settling');
        if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
        previewItem=null;
      },190);
    }

    function cancelDrag(){
      pointerId=null;
      dragging=false;
      sidebar.classList.remove('qp-nav-dragging','qp-nav-drag-settling');
      if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
      previewItem=null;
    }

    sidebar.addEventListener('pointerdown',event=>{
      if(!mobile.matches || event.pointerType==='mouse' || !event.isPrimary)return;
      clearTimeout(settleTimer);
      sidebar.classList.remove('qp-nav-drag-settling');
      pointerId=event.pointerId;
      startX=event.clientX;
      startY=event.clientY;
      dragging=false;
      setPreview(nearestItem(event.clientX));
      setLensX(event.clientX);
      sidebar.classList.add('qp-nav-dragging');
      try{sidebar.setPointerCapture(pointerId);}catch(e){}
    });

    sidebar.addEventListener('pointermove',event=>{
      if(event.pointerId!==pointerId || !mobile.matches)return;
      const dx=event.clientX-startX;
      const dy=event.clientY-startY;
      if(!dragging){
        if(Math.abs(dy)>12 && Math.abs(dy)>Math.abs(dx)){
          cancelDrag();
          return;
        }
        if(Math.abs(dx)<8)return;
        dragging=true;
      }
      setLensX(event.clientX);
      setPreview(nearestItem(event.clientX));
    });

    sidebar.addEventListener('pointerup',event=>{
      if(event.pointerId!==pointerId)return;
      try{sidebar.releasePointerCapture(pointerId);}catch(e){}
      pointerId=null;

      if(!dragging){
        sidebar.classList.remove('qp-nav-dragging');
        if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
        previewItem=null;
        return;
      }

      dragging=false;
      const target=previewItem || nearestItem(event.clientX);
      suppressNativeClick=true;
      settleLens(target);

      setTimeout(()=>{
        if(!target)return;
        programmaticCommit=true;
        target.click();
        programmaticCommit=false;
        suppressNativeClick=false;
      },0);
    });

    sidebar.addEventListener('pointercancel',event=>{
      if(event.pointerId===pointerId)cancelDrag();
    });

    sidebar.addEventListener('click',event=>{
      if(!suppressNativeClick || programmaticCommit)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressNativeClick=false;
    },true);

    window.addEventListener('resize',()=>{
      if(!mobile.matches)cancelDrag();
    },{passive:true});
  }

  qPokoyInstallMobileNavDragStyles();
  qPokoySetMobileNavDevVersion();
  document.addEventListener('DOMContentLoaded',()=>{
    qPokoyInstallMobileNavDragStyles();
    qPokoySetMobileNavDevVersion();
    qPokoyInitMobileNavDrag();
  },{once:true});
  window.addEventListener('load',()=>{
    qPokoySetMobileNavDevVersion();
    qPokoyInitMobileNavDrag();
  },{once:true});
  setTimeout(()=>{
    qPokoySetMobileNavDevVersion();
    qPokoyInitMobileNavDrag();
  },250);
})();
