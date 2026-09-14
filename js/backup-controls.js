
(function qPokoyBackupInit(){
  const KEY='incomes';

  function canonicalDate(value){
    const s=String(value||'').trim();
    let m=s.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(m)return m[1]+'.'+m[2]+'.'+m[3].slice(-2);
    m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return m[3]+'.'+m[2]+'.'+m[1].slice(-2);
    return s;
  }

  function readCurrentIncomes(){
    // Prefer the live array because it is what the visible site is currently using.
    if(Array.isArray(window.incomes) && window.incomes.length){
      return window.incomes.map(x=>Object.assign({},x,{date:canonicalDate(x.date)}));
    }
    // If the live array is empty, read the app's actual localStorage key.
    try{
      const raw=JSON.parse(localStorage.getItem(KEY)||'[]');
      return Array.isArray(raw)
        ? raw.map(x=>Object.assign({},x,{date:canonicalDate(x.date)}))
        : [];
    }catch(e){
      return [];
    }
  }

  function exportData(){
    const incomes=readCurrentIncomes();
    const payload={
      format:'qPokoy-income-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      incomes:incomes
    };
    const json=JSON.stringify(payload,null,2);
    const blob=new Blob([json],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='income-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  async function importData(file){
    if(!file) return;
    if(window.IncomeBackup && typeof window.IncomeBackup.importData==='function'){
      try{
        await window.IncomeBackup.importData(file);
        if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Импорт завершён','Данные успешно загружены из файла.','success');
      }catch(e){
        console.error('qPokoy import error:',e);
        if(typeof window.qPokoyNotice==='function') window.qPokoyNotice('Ошибка импорта',e && e.message ? e.message : 'Не удалось импортировать файл. Проверьте формат JSON.','error');
      }
      return;
    }
    throw new Error('Модуль импорта недоступен.');
  }

  function bind(){
    const exp=document.getElementById('exportDataBtn');
    const imp=document.getElementById('importDataBtn');
    const input=document.getElementById('importDataInput');

    if(exp && !exp.__qPokoyBackup){
      exp.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        exportData();
      },true);
      exp.__qPokoyBackup=true;
    }

    if(imp && input && !imp.__qPokoyBackup){
      imp.addEventListener('click',function(e){
        e.preventDefault();
        e.stopImmediatePropagation();
        input.click();
      },true);
      imp.__qPokoyBackup=true;
      input.addEventListener('change',function(){
        if(input.files && input.files[0])importData(input.files[0]);
        input.value='';
      });
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',bind);
  }else{
    bind();
  }
})();
