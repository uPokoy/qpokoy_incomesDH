
(function(){
  var KEY="qPokoyAccentColor", DEFAULT="#2563eb";
  function valid(c){return /^#[0-9a-fA-F]{6}$/.test(c||"");}
  function apply(c){
    if(!valid(c)) c=DEFAULT;
    var root=document.documentElement;
    root.style.setProperty("--primary",c);
    root.style.setProperty("--qp-accent",c);
    root.style.setProperty("--qp-accent-2",c);
    var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);
    root.style.setProperty("--active","rgba("+r+", "+g+", "+b+", .10)");
    root.style.setProperty("--bg-accent","rgba("+r+", "+g+", "+b+", .08)");
    try{localStorage.setItem(KEY,c);}catch(e){}
    document.querySelectorAll(".accent-swatch").forEach(function(el){
      var color=el.getAttribute("data-accent")||DEFAULT;
      el.style.setProperty("--accent-swatch",color);
      el.classList.toggle("active",color.toLowerCase()===c.toLowerCase());
    });
    var custom=document.getElementById("accentCustomColor");
    if(custom) custom.value=c;
  }
  function init(){
    document.querySelectorAll(".accent-swatch").forEach(function(el){
      el.addEventListener("click",function(){apply(el.getAttribute("data-accent"));});
    });
    var custom=document.getElementById("accentCustomColor");
    if(custom) custom.addEventListener("input",function(){apply(custom.value);});
    var saved=DEFAULT;
    try{saved=localStorage.getItem(KEY)||DEFAULT;}catch(e){}
    apply(saved);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();

/* TEMP MOBILE NAV DEV LOADER — remove after mobile navigation is finalized. */
(function(){
  if(document.getElementById('qPokoyLiquidNavScript')) return;
  var s=document.createElement('script');
  s.id='qPokoyLiquidNavScript';
  s.src='js/mobile-nav-liquid.js?v=dev-2026.09.15.12';
  s.async=false;
  document.head.appendChild(s);
})();
