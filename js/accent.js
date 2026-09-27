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
    if(typeof window.renderIncomeMonthChart==="function") window.renderIncomeMonthChart();
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
          <div class="qp-background-custom-caption"><span>Свой фон</span><button type="button" class="qp-background-remove" id="qpBackgroundRemove" aria-label="Удалить свой фон" title="Удалить свой фон" hidden>×</button></div>\
          <span class="qp-background-help"><button type="button" class="qp-background-help-btn" id="qpBackgroundHelp" aria-label="Информация о своём фоне" aria-expanded="false">?</button><span class="qp-background-help-tip" role="tooltip">Свой фон хранится только на этом устройстве.</span></span>\
        </div>\
      </div>\
      <input type="file" id="qpBackgroundFile" accept="image/jpeg,image/png,image/webp,image/avif" hidden>\
      <div class="qp-background-status" id="qpBackgroundStatus" aria-live="polite"></div>';
    var account=document.getElementById("qpAccountCard");
    settings.insertBefore(card,account||settings.lastChild);

    var file=document.getElementById("qpBackgroundFile");
    var remove=document.getElementById("qpBackgroundRemove");
    var help=document.getElementById("qpBackgroundHelp");
    var helpWrap=help&&help.closest(".qp-background-help");
    if(help&&helpWrap){
      help.addEventListener("click",function(e){
        e.stopPropagation();
        var open=!helpWrap.classList.contains("open");
        helpWrap.classList.toggle("open",open);
        help.setAttribute("aria-expanded",open?"true":"false");
      });
      document.addEventListener("click",function(e){
        if(!helpWrap.contains(e.target)){
          helpWrap.classList.remove("open");
          help.setAttribute("aria-expanded","false");
        }
      });
    }

    document.querySelectorAll("[data-qp-bg-mode]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var next=btn.getAttribute("data-qp-bg-mode");
        if(next!=="custom"){
          storeMode(next);
          setStatus("");
          return;
        }
        if(btn.classList.contains("has-image")){
          storeMode("custom");
          setStatus("");
          return;
        }
        file.click();
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
