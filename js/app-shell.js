
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
})();
