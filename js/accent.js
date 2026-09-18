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
    document.querySelectorAll(".accent-swatch").forEach(function(el){el.addEventListener("click",function(){apply(el.getAttribute("data-accent"));});});
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
      body.qp-bg-standard>.app,body.qp-bg-off>.app{background:transparent !important;}
      #qpCustomBackgroundLayer{position:fixed;inset:0;z-index:0;display:none;pointer-events:none;background-color:#070b12;background-position:center center;background-size:cover;background-repeat:no-repeat;}
      body.qp-bg-custom{background:#070b12 !important;}
      body.qp-bg-custom #qpCustomBackgroundLayer{display:block;}
      body.qp-bg-custom>.app{position:relative;z-index:1;background:transparent !important;}

      .qp-background-settings{display:block !important;margin-top:16px;}
      .qp-background-settings>.settings-title{display:block !important;position:static !important;width:auto !important;margin:0 0 12px !important;order:-999 !important;text-align:left !important;}
      .qp-background-options{display:grid;grid-template-columns:repeat(3,170px);gap:12px;justify-content:start;align-items:start;max-width:100%;margin-top:0;}
      .qp-background-option{display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;width:170px !important;min-width:0 !important;height:auto !important;padding:7px !important;border:1px solid var(--border);border-radius:12px;background:var(--panel-muted);color:var(--text);cursor:pointer;text-align:center !important;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease;}
      .qp-background-option:hover{border-color:color-mix(in srgb,var(--primary) 55%,var(--border));}
      .qp-background-option.active{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 22%,transparent);}
      .qp-background-custom-wrap{position:relative;width:170px;min-width:0;}
      .qp-background-custom-wrap>.qp-background-option{width:100% !important;}
      .qp-background-custom-caption{position:absolute;z-index:4;left:7px;right:7px;bottom:7px;text-align:center;pointer-events:none;font-size:12px;font-weight:600;line-height:1.3;color:var(--text);}
      .qp-background-remove{position:absolute !important;left:calc(50% + 30px);top:50%;transform:translateY(-50%);width:22px !important;min-width:22px !important;height:22px !important;padding:0 !important;border:0 !important;border-radius:0 !important;background:transparent !important;box-shadow:none !important;color:rgba(239,68,68,.58) !important;font-size:17px !important;font-weight:500 !important;line-height:1 !important;pointer-events:auto !important;}
      .qp-background-remove:hover,
      .qp-background-remove:active{transform:translateY(-50%) !important;background:transparent !important;color:rgba(239,68,68,.88) !important;}
      .qp-background-preview{display:block;position:relative;width:100%;height:88px;margin:0 0 7px;overflow:hidden;border-radius:8px;border:1px solid rgba(148,163,184,.18);background:#0b1018;}
      .qp-background-preview-standard{background:radial-gradient(82% 70% at 0% 90%,rgba(67,95,132,.52),transparent 58%),radial-gradient(82% 70% at 100% 10%,rgba(62,89,126,.48),transparent 58%),linear-gradient(145deg,#05080e,#0a1421 48%,#05080e);}
      .qp-background-preview-off{background:#0b1018;}
      .qp-background-preview-custom{display:grid;place-items:center;background-position:center;background-size:cover;background-repeat:no-repeat;}
      .qp-background-preview-custom b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:rgba(15,23,42,.74);border:1px solid rgba(203,213,225,.36);font-size:19px;font-weight:400;line-height:1;}
      .qp-background-option.has-image .qp-background-preview-custom b{opacity:0;}
      .qp-background-option>span:last-child{display:block !important;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;line-height:1.3;text-align:center !important;}
      .qp-background-note{margin-top:10px;color:var(--text-muted);font-size:12px;}
      .qp-background-status{min-height:0;margin-top:5px;color:var(--text-muted);font-size:12px;}
      .qp-background-status:empty{display:none;}
      .qp-background-status.error{color:var(--danger);}
      @media (max-width:700px){
        .qp-background-options{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
        .qp-background-option{width:auto !important;padding:5px !important;border-radius:10px;}
        .qp-background-custom-wrap{width:auto;}
        .qp-background-custom-caption{left:5px;right:5px;bottom:5px;font-size:10px;}
        .qp-background-remove{left:calc(50% + 25px);width:22px !important;min-width:22px !important;height:22px !important;font-size:17px !important;}
        .qp-background-preview{height:64px;margin-bottom:6px;border-radius:7px;}
        .qp-background-option>span:last-child{font-size:10px;}
      }
    `;
    (document.head||document.documentElement).appendChild(style);
  }
  installStyles();

  try{
    var saved=localStorage.getItem(MODE_KEY);
    if(saved==="standard"||saved==="off"||saved==="custom") mode=saved;
  }catch(e){}

  function ensureCustomLayer(){
    var layer=document.getElementById("qpCustomBackgroundLayer");
    if(layer) return layer;
    if(!document.body) return null;
    layer=document.createElement("div");
    layer.id="qpCustomBackgroundLayer";
    layer.setAttribute("aria-hidden","true");
    document.body.insertBefore(layer,document.body.firstChild);
    return layer;
  }

  function setBodyMode(next){
    if(!document.body) return;
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
    var layer=ensureCustomLayer();
    if(layer){
      layer.style.backgroundImage=currentObjectUrl ? 'linear-gradient(rgba(4,8,14,.18),rgba(4,8,14,.18)),url("'+currentObjectUrl+'")' : "";
    }
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
    ensureCustomLayer();
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
        <div class="qp-background-custom-wrap">\
          <button type="button" class="qp-background-option" data-qp-bg-mode="custom" aria-pressed="false" aria-label="Свой фон">\
            <span class="qp-background-preview qp-background-preview-custom" id="qpBackgroundCustomPreview" aria-hidden="true"><b>+</b></span><span aria-hidden="true">&nbsp;</span>\
          </button>\
          <div class="qp-background-custom-caption"><span>Свой фон</span><button type="button" class="qp-background-remove qp-category-delete" id="qpBackgroundRemove" aria-label="Удалить свой фон" title="Удалить свой фон" hidden>×</button></div>\
        </div>\
      </div>\
      <input type="file" id="qpBackgroundFile" accept="image/jpeg,image/png,image/webp,image/avif" hidden>\
      <div class="qp-background-note">Свой фон хранится только на этом устройстве.</div>\
      <div class="qp-background-status" id="qpBackgroundStatus" aria-live="polite"></div>';
    var account=document.getElementById("qpAccountCard");
    settings.insertBefore(card,account||settings.lastChild);

    var file=document.getElementById("qpBackgroundFile");
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

      refreshCustomState(selected);
      storeMode("custom");
      setStatus("Фон применён. Сохраняю на этом устройстве…",false);

      writeCustomBackground(selected).then(function(){
        setStatus("Фон сохранён на этом устройстве.",false);
      }).catch(function(){
        setStatus("Фон применён, но браузер не смог сохранить его после перезапуска.",true);
      });
    });

    remove.addEventListener("click",function(){
      deleteCustomBackground().then(function(){
        refreshCustomState(null);
        storeMode("standard");
        setStatus("");
      }).catch(function(){setStatus("Не удалось удалить фон.",true);});
    });

    storeMode(mode);
    readCustomBackground().then(function(blob){
      refreshCustomState(blob);
      if(mode==="custom"&&!blob) storeMode("standard");
    }).catch(function(){if(mode==="custom") storeMode("standard");});
  }

  if(mode==="custom"){
    readCustomBackground().then(function(blob){
      if(blob){applyCustomBlob(blob);setBodyMode("custom");}
      else storeMode("standard");
    }).catch(function(){storeMode("standard");});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",createUi); else createUi();
  window.addEventListener("beforeunload",function(){if(currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);});
})();
