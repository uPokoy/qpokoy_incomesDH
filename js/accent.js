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

/* qPokoy local background settings. Custom image stays only on this device. */
(function(){
  "use strict";
  var MODE_KEY="qPokoyBackgroundMode";
  var DB_NAME="qPokoyLocalAppearance";
  var STORE_NAME="backgrounds";
  var CUSTOM_KEY="custom";
  var currentObjectUrl="";
  var mode="standard";

  function installStyles(){
    if(document.getElementById("qpBackgroundSettingsStyle")) return;
    var style=document.createElement("style");
    style.id="qpBackgroundSettingsStyle";
    style.textContent=`
      body.qp-bg-standard{
        background:
          radial-gradient(78% 58% at -8% 76%,rgba(47,70,99,.30) 0 24%,transparent 55%),
          radial-gradient(84% 60% at 108% 24%,rgba(46,69,98,.28) 0 22%,transparent 54%),
          radial-gradient(118% 84% at 50% -22%,rgba(72,99,135,.30) 0 18%,rgba(32,48,70,.14) 35%,transparent 54%),
          linear-gradient(145deg,#05080e 0%,#09111c 42%,#070c14 72%,#04070c 100%) fixed !important;
      }
      body.qp-bg-off{background:var(--bg) !important;}
      body.qp-bg-custom{
        background-color:#070b12 !important;
        background-image:linear-gradient(rgba(4,8,14,.22),rgba(4,8,14,.22)),var(--qp-custom-bg-image) !important;
        background-position:center center !important;
        background-size:cover !important;
        background-repeat:no-repeat !important;
        background-attachment:fixed !important;
      }
      body.qp-bg-standard .app,body.qp-bg-custom .app,body.qp-bg-off .app{background:transparent;}
      body.qp-bg-off #qpAuthGate{background:#070b12 !important;}
      body.qp-bg-custom #qpAuthGate{
        background-color:#070b12 !important;
        background-image:linear-gradient(rgba(4,8,14,.30),rgba(4,8,14,.30)),var(--qp-custom-bg-image) !important;
        background-position:center center !important;
        background-size:cover !important;
        background-repeat:no-repeat !important;
      }
      body.qp-bg-off #qpAuthGate::before,body.qp-bg-off #qpAuthGate::after,
      body.qp-bg-custom #qpAuthGate::before,body.qp-bg-custom #qpAuthGate::after{display:none !important;}
      .qp-background-settings{margin-top:16px;}
      .qp-background-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;}
      .qp-background-option{min-width:0;padding:8px;border:1px solid var(--border);border-radius:14px;background:var(--panel-muted);color:var(--text);cursor:pointer;text-align:left;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease;}
      .qp-background-option:hover{border-color:color-mix(in srgb,var(--primary) 55%,var(--border));}
      .qp-background-option.active{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 22%,transparent);}
      .qp-background-preview{display:block;position:relative;width:100%;aspect-ratio:16/9;margin-bottom:8px;overflow:hidden;border-radius:10px;border:1px solid rgba(148,163,184,.18);background:#0b1018;}
      .qp-background-preview-standard{background:radial-gradient(82% 70% at 0% 90%,rgba(67,95,132,.52),transparent 58%),radial-gradient(82% 70% at 100% 10%,rgba(62,89,126,.48),transparent 58%),linear-gradient(145deg,#05080e,#0a1421 48%,#05080e);}
      .qp-background-preview-off{background:#0b1018;}
      .qp-background-preview-custom{display:grid;place-items:center;background-position:center;background-size:cover;background-repeat:no-repeat;}
      .qp-background-preview-custom b{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(15,23,42,.74);border:1px solid rgba(203,213,225,.36);font-size:20px;font-weight:400;line-height:1;}
      .qp-background-option.has-image .qp-background-preview-custom b{opacity:0;}
      .qp-background-option>span:last-child{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;text-align:center;}
      .qp-background-custom-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
      .qp-background-note{margin-top:10px;color:var(--text-muted);font-size:12px;}
      .qp-background-status{min-height:18px;margin-top:5px;color:var(--text-muted);font-size:12px;}
      .qp-background-status.error{color:var(--danger);}
      @media (max-width:560px){
        body.qp-bg-custom{background-attachment:scroll !important;}
        .qp-background-options{gap:8px;}
        .qp-background-option{padding:6px;border-radius:12px;}
        .qp-background-preview{border-radius:8px;}
        .qp-background-option>span:last-child{font-size:11px;}
      }
    `;
    (document.head||document.documentElement).appendChild(style);
  }
  installStyles();
  try{
    var saved=localStorage.getItem(MODE_KEY);
    if(saved==="standard"||saved==="off"||saved==="custom") mode=saved;
  }catch(e){}

  function setBodyMode(next){
    document.body.classList.remove("qp-bg-standard","qp-bg-off","qp-bg-custom");
    document.body.classList.add("qp-bg-"+next);
  }
  setBodyMode(mode);

  function openDb(){
    return new Promise(function(resolve,reject){
      if(!window.indexedDB){reject(new Error("indexedDB unavailable"));return;}
      var request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=function(){
        var db=request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error||new Error("indexedDB error"));};
    });
  }

  function readCustomBackground(){
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var tx=db.transaction(STORE_NAME,"readonly");
        var request=tx.objectStore(STORE_NAME).get(CUSTOM_KEY);
        request.onsuccess=function(){resolve(request.result||null);};
        request.onerror=function(){reject(request.error||new Error("read error"));};
        tx.oncomplete=function(){db.close();};
      });
    });
  }

  function writeCustomBackground(blob){
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).put(blob,CUSTOM_KEY);
        tx.oncomplete=function(){db.close();resolve();};
        tx.onerror=function(){db.close();reject(tx.error||new Error("write error"));};
        tx.onabort=function(){db.close();reject(tx.error||new Error("write aborted"));};
      });
    });
  }

  function deleteCustomBackground(){
    return openDb().then(function(db){
      return new Promise(function(resolve,reject){
        var tx=db.transaction(STORE_NAME,"readwrite");
        tx.objectStore(STORE_NAME).delete(CUSTOM_KEY);
        tx.oncomplete=function(){db.close();resolve();};
        tx.onerror=function(){db.close();reject(tx.error||new Error("delete error"));};
      });
    });
  }

  function applyCustomBlob(blob){
    if(currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl=blob?URL.createObjectURL(blob):"";
    if(currentObjectUrl) document.documentElement.style.setProperty("--qp-custom-bg-image",'url("'+currentObjectUrl+'")');
    else document.documentElement.style.removeProperty("--qp-custom-bg-image");
    var preview=document.getElementById("qpBackgroundCustomPreview");
    if(preview) preview.style.backgroundImage=currentObjectUrl?'url("'+currentObjectUrl+'")':"";
  }

  function storeMode(next){
    mode=next;
    try{localStorage.setItem(MODE_KEY,next);}catch(e){}
    setBodyMode(next);
    document.querySelectorAll("[data-qp-bg-mode]").forEach(function(btn){
      var active=btn.getAttribute("data-qp-bg-mode")===next;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",active?"true":"false");
    });
    var controls=document.getElementById("qpBackgroundCustomControls");
    if(controls) controls.hidden=next!=="custom";
  }

  function setStatus(text,isError){
    var el=document.getElementById("qpBackgroundStatus");
    if(!el) return;
    el.textContent=text||"";
    el.classList.toggle("error",!!isError);
  }

  function refreshCustomState(blob){
    applyCustomBlob(blob);
    var remove=document.getElementById("qpBackgroundRemove");
    if(remove) remove.hidden=!blob;
    var customBtn=document.querySelector('[data-qp-bg-mode="custom"]');
    if(customBtn) customBtn.classList.toggle("has-image",!!blob);
  }

  function createUi(){
    var settings=document.getElementById("settings");
    if(!settings||document.getElementById("qpBackgroundSettings")) return;
    var card=document.createElement("div");
    card.className="settings-card qp-background-settings";
    card.id="qpBackgroundSettings";
    card.innerHTML='\
      <div class="settings-title">Фон</div>\
      <div class="qp-background-options" role="group" aria-label="Фон сайта">\
        <button type="button" class="qp-background-option" data-qp-bg-mode="standard" aria-pressed="false">\
          <span class="qp-background-preview qp-background-preview-standard" aria-hidden="true"></span><span>Стандартный</span>\
        </button>\
        <button type="button" class="qp-background-option" data-qp-bg-mode="off" aria-pressed="false">\
          <span class="qp-background-preview qp-background-preview-off" aria-hidden="true"></span><span>Без фона</span>\
        </button>\
        <button type="button" class="qp-background-option" data-qp-bg-mode="custom" aria-pressed="false">\
          <span class="qp-background-preview qp-background-preview-custom" id="qpBackgroundCustomPreview" aria-hidden="true"><b>+</b></span><span>Свой фон</span>\
        </button>\
      </div>\
      <div class="qp-background-custom-controls" id="qpBackgroundCustomControls" hidden>\
        <input type="file" id="qpBackgroundFile" accept="image/jpeg,image/png,image/webp,image/avif" hidden>\
        <button type="button" class="btn-secondary" id="qpBackgroundChoose">Выбрать изображение</button>\
        <button type="button" class="btn-secondary" id="qpBackgroundRemove" hidden>Удалить свой фон</button>\
      </div>\
      <div class="qp-background-note">Свой фон хранится только на этом устройстве.</div>\
      <div class="qp-background-status" id="qpBackgroundStatus" aria-live="polite"></div>';
    var account=document.getElementById("qpAccountCard");
    settings.insertBefore(card,account||settings.lastChild);

    var file=document.getElementById("qpBackgroundFile");
    var choose=document.getElementById("qpBackgroundChoose");
    var remove=document.getElementById("qpBackgroundRemove");

    document.querySelectorAll("[data-qp-bg-mode]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var next=btn.getAttribute("data-qp-bg-mode");
        if(next!=="custom"){
          storeMode(next);
          setStatus("");
          return;
        }
        readCustomBackground().then(function(blob){
          if(blob){refreshCustomState(blob);storeMode("custom");setStatus("");}
          else file.click();
        }).catch(function(){file.click();});
      });
    });

    choose.addEventListener("click",function(){file.click();});
    file.addEventListener("change",function(){
      var selected=file.files&&file.files[0];
      file.value="";
      if(!selected) return;
      if(!/^image\/(jpeg|png|webp|avif)$/i.test(selected.type||"")){
        setStatus("Выберите изображение JPG, PNG, WebP или AVIF.",true);
        return;
      }
      if(selected.size>25*1024*1024){
        setStatus("Файл слишком большой. Максимум 25 МБ.",true);
        return;
      }
      writeCustomBackground(selected).then(function(){
        refreshCustomState(selected);
        storeMode("custom");
        setStatus("Фон сохранён на этом устройстве.",false);
      }).catch(function(){
        setStatus("Не удалось сохранить фон на этом устройстве.",true);
      });
    });

    remove.addEventListener("click",function(){
      deleteCustomBackground().then(function(){
        refreshCustomState(null);
        storeMode("standard");
        setStatus("Свой фон удалён с этого устройства.",false);
      }).catch(function(){setStatus("Не удалось удалить фон.",true);});
    });

    storeMode(mode);
    readCustomBackground().then(function(blob){
      refreshCustomState(blob);
      if(mode==="custom"&&!blob) storeMode("standard");
    }).catch(function(){
      if(mode==="custom") storeMode("standard");
    });
  }

  if(mode==="custom"){
    readCustomBackground().then(function(blob){
      if(blob) applyCustomBlob(blob);
      else storeMode("standard");
    }).catch(function(){storeMode("standard");});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",createUi); else createUi();
  window.addEventListener("beforeunload",function(){if(currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);});
})();
