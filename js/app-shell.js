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

  /* Mobile bottom navigation: finger scrubbing across the bar.
     The preview follows the finger; the page changes only on release. */
  const qPokoyMobileNavDevVersion='dev-2026.09.15.03';

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
        html,body{
          overscroll-behavior-x:none;
        }
        .content{
          padding-bottom:calc(105px + env(safe-area-inset-bottom)) !important;
        }
        .sidebar.qp-nav-drag-ready{
          bottom:calc(20px + env(safe-area-inset-bottom)) !important;
          touch-action:none !important;
          overscroll-behavior:none !important;
          -webkit-user-select:none;
          user-select:none;
        }
        .sidebar.qp-nav-drag-ready .nav-item{
          position:relative;
          z-index:4;
          -webkit-user-select:none;
          user-select:none;
        }
        .sidebar.qp-nav-dragging,
        .sidebar.qp-nav-drag-settling{
          overflow:visible !important;
        }
        .sidebar.qp-nav-dragging .nav-item.active{
          background:transparent !important;
        }
        .sidebar .qp-nav-drag-lens{
          position:absolute;
          top:50%;
          left:0;
          width:58px;
          height:58px;
          margin:0;
          border:1px solid color-mix(in srgb,var(--primary) 32%,rgba(255,255,255,.22));
          border-radius:999px;
          background:
            radial-gradient(circle at 34% 24%,rgba(255,255,255,.12),transparent 38%),
            color-mix(in srgb,var(--panel) 55%,transparent);
          box-shadow:
            0 6px 18px rgba(0,0,0,.22),
            inset 0 1px 0 rgba(255,255,255,.11),
            inset 0 -1px 0 rgba(255,255,255,.025);
          -webkit-backdrop-filter:blur(10px) saturate(130%);
          backdrop-filter:blur(10px) saturate(130%);
          pointer-events:none;
          opacity:0;
          z-index:3;
          transform:translate3d(0,-50%,0);
          will-change:transform,opacity;
          transition:opacity .10s ease;
        }
        .sidebar.qp-nav-dragging .qp-nav-drag-lens,
        .sidebar.qp-nav-drag-settling .qp-nav-drag-lens{
          opacity:1;
        }
        .sidebar.qp-nav-drag-settling .qp-nav-drag-lens{
          transition:transform .13s cubic-bezier(.2,.8,.2,1),opacity .11s ease;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview{
          background:transparent !important;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview .nav-icon,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview .nav-icon{
          color:var(--primary) !important;
          transform:scale(1.06);
          transform-origin:center;
          transition:transform .10s ease,color .10s ease;
        }
        .sidebar.qp-nav-dragging .nav-item.qp-nav-drag-preview .nav-label,
        .sidebar.qp-nav-drag-settling .nav-item.qp-nav-drag-preview .nav-label{
          color:var(--primary) !important;
          transition:color .10s ease;
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
    let dragging=false;
    let previewItem=null;
    let suppressNativeClick=false;
    let programmaticCommit=false;
    let settleTimer=0;

    function items(){
      return Array.from(sidebar.querySelectorAll('.nav-item[data-page]'));
    }

    /* Split the entire bar into equal horizontal hit-zones.
       This makes a tab selectable even when the finger is between icon/label elements. */
    function itemFromX(clientX){
      const list=items();
      if(!list.length)return null;
      const rect=sidebar.getBoundingClientRect();
      const local=Math.min(rect.width-0.001,Math.max(0,clientX-rect.left));
      const index=Math.min(list.length-1,Math.max(0,Math.floor(local/rect.width*list.length)));
      return list[index];
    }

    function setPreview(item){
      if(previewItem===item)return;
      if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
      previewItem=item;
      if(previewItem)previewItem.classList.add('qp-nav-drag-preview');
    }

    function setLensX(clientX){
      const rect=sidebar.getBoundingClientRect();
      const size=58;
      const local=clientX-rect.left;
      const x=Math.min(rect.width-size/2,Math.max(size/2,local));
      lens.style.transform=`translate3d(${Math.round(x-size/2)}px,-50%,0)`;
    }

    function centerLensOn(item){
      if(!item)return;
      const itemRect=item.getBoundingClientRect();
      setLensX(itemRect.left+itemRect.width/2);
    }

    function settleLens(item){
      if(!item)return;
      centerLensOn(item);
      sidebar.classList.remove('qp-nav-dragging');
      sidebar.classList.add('qp-nav-drag-settling');
      clearTimeout(settleTimer);
      settleTimer=setTimeout(()=>{
        sidebar.classList.remove('qp-nav-drag-settling');
        if(previewItem)previewItem.classList.remove('qp-nav-drag-preview');
        previewItem=null;
      },145);
    }

    function clearDrag(){
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
      dragging=false;
      setPreview(itemFromX(event.clientX));
      setLensX(event.clientX);
      sidebar.classList.add('qp-nav-dragging');
      try{sidebar.setPointerCapture(pointerId);}catch(e){}
    });

    sidebar.addEventListener('pointermove',event=>{
      if(event.pointerId!==pointerId || !mobile.matches)return;
      const dx=event.clientX-startX;
      if(!dragging && Math.abs(dx)<5)return;
      dragging=true;
      if(event.cancelable)event.preventDefault();
      setLensX(event.clientX);
      setPreview(itemFromX(event.clientX));
    },{passive:false});

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
      const target=itemFromX(event.clientX) || previewItem;
      setPreview(target);
      suppressNativeClick=true;
      settleLens(target);

      setTimeout(()=>{
        if(!target){
          suppressNativeClick=false;
          return;
        }
        programmaticCommit=true;
        target.click();
        programmaticCommit=false;
        suppressNativeClick=false;
      },0);
    });

    sidebar.addEventListener('pointercancel',event=>{
      if(event.pointerId===pointerId)clearDrag();
    });

    /* iOS Safari may try to interpret a horizontal drag as browser navigation.
       This blocks page-level scrolling gestures; the system home gesture itself
       is avoided by keeping the control physically above the reserved bottom zone. */
    sidebar.addEventListener('touchmove',event=>{
      if(pointerId!==null && event.cancelable)event.preventDefault();
    },{passive:false});

    sidebar.addEventListener('click',event=>{
      if(!suppressNativeClick || programmaticCommit)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressNativeClick=false;
    },true);

    window.addEventListener('resize',()=>{
      if(!mobile.matches)clearDrag();
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
