(function qPokoyReportPrintInit(){
  'use strict';

  const monthNames=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function money(value){
    return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value)||0)+' ₽';
  }

  function parseDate(value){
    const text=String(value||'').trim();
    let match=text.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
    if(match){
      let year=Number(match[3]);
      if(year<100)year+=2000;
      const date=new Date(year,Number(match[2])-1,Number(match[1]));
      return Number.isNaN(date.getTime())?null:date;
    }
    match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match){
      const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
      return Number.isNaN(date.getTime())?null:date;
    }
    return null;
  }

  function readRecords(){
    try{
      if(window.IncomeStore&&typeof window.IncomeStore.load==='function'){
        const rows=window.IncomeStore.load();
        if(Array.isArray(rows))return rows.slice();
      }
    }catch(e){}
    try{
      const rows=JSON.parse(localStorage.getItem('incomes')||'[]');
      return Array.isArray(rows)?rows:[];
    }catch(e){
      return [];
    }
  }

  function readSelectedPeriod(){
    try{
      const saved=JSON.parse(localStorage.getItem('incomeSelectedPeriod')||'null');
      if(saved&&Number.isInteger(saved.month)&&saved.month>=0&&saved.month<12&&Number.isInteger(saved.year)){
        return {month:saved.month,year:saved.year};
      }
    }catch(e){}
    const now=new Date();
    return {month:now.getMonth(),year:now.getFullYear()};
  }

  function filterReport(mode){
    const period=readSelectedPeriod();
    const records=readRecords().filter(function(item){
      return item&&Number.isFinite(Number(item.amount));
    });
    let label='Все доходы';
    let filtered=records;

    if(mode==='month'){
      label=monthNames[period.month]+' '+period.year;
      filtered=records.filter(function(item){
        const date=parseDate(item.date);
        return date&&date.getMonth()===period.month&&date.getFullYear()===period.year;
      });
    }else if(mode==='year'){
      label=String(period.year);
      filtered=records.filter(function(item){
        const date=parseDate(item.date);
        return date&&date.getFullYear()===period.year;
      });
    }

    filtered=filtered.map(function(item,index){
      return {
        index:index,
        date:String(item.date||''),
        amount:Number(item.amount)||0,
        category:String(item.category||'Без категории'),
        description:String(item.description||'')
      };
    }).sort(function(a,b){
      const ad=parseDate(a.date);
      const bd=parseDate(b.date);
      const diff=(bd?bd.getTime():0)-(ad?ad.getTime():0);
      return diff||a.index-b.index;
    });

    return {records:filtered,label:label};
  }

  function categoryRows(records,total){
    const map=new Map();
    records.forEach(function(item){
      map.set(item.category,(map.get(item.category)||0)+item.amount);
    });
    return Array.from(map.entries()).sort(function(a,b){return b[1]-a[1];}).map(function(entry){
      const share=total>0?Math.round(entry[1]/total*100):0;
      return '<tr><td>'+escapeHtml(entry[0])+'</td><td class="number">'+escapeHtml(money(entry[1]))+'</td><td class="number">'+share+'%</td></tr>';
    }).join('');
  }

  function incomeRows(records){
    return records.map(function(item){
      return '<tr>'+
        '<td>'+escapeHtml(item.date)+'</td>'+
        '<td>'+escapeHtml(item.category)+'</td>'+
        '<td class="description">'+escapeHtml(item.description||'—')+'</td>'+
        '<td class="number">'+escapeHtml(money(item.amount))+'</td>'+
      '</tr>';
    }).join('');
  }

  function buildReportHtml(report){
    const records=report.records;
    const total=records.reduce(function(sum,item){return sum+item.amount;},0);
    const categories=new Set(records.map(function(item){return item.category;})).size;
    const generated=new Date().toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'});
    const title='qPokoy — '+report.label;

    return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title>'+
      '<style>'+
      '@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:12px;line-height:1.4}'+
      'body{padding:24px;max-width:1000px;margin:0 auto}.report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:2px solid #111827}.brand{font-size:22px;font-weight:800;letter-spacing:-.03em}.muted{color:#6b7280}.report-head h1{margin:4px 0 2px;font-size:20px}.period{font-size:13px;font-weight:600}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.metric{padding:12px 14px;border:1px solid #d1d5db;border-radius:10px}.metric span{display:block;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.metric strong{display:block;margin-top:3px;font-size:17px}.section{margin-top:18px}.section h2{margin:0 0 8px;font-size:14px}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{background:#f3f4f6;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#4b5563}.number{text-align:right;white-space:nowrap}.description{word-break:break-word}.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:10px}.report-actions{position:fixed;right:20px;bottom:20px;display:flex;gap:8px}.report-actions button{padding:10px 14px;border:0;border-radius:9px;background:#2563eb;color:#fff;font:600 12px inherit;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,.25)}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{padding:0;max-width:none}.report-actions{display:none}.section{break-inside:auto}.metric{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body>'+
      '<header class="report-head"><div><div class="brand">qPokoy</div><h1>Отчёт по доходам</h1><div class="period">'+escapeHtml(report.label)+'</div></div><div class="muted">Сформировано<br>'+escapeHtml(generated)+'</div></header>'+
      '<section class="summary"><div class="metric"><span>Общий доход</span><strong>'+escapeHtml(money(total))+'</strong></div><div class="metric"><span>Записей</span><strong>'+records.length+'</strong></div><div class="metric"><span>Категорий</span><strong>'+categories+'</strong></div></section>'+
      '<section class="section"><h2>По категориям</h2><table><thead><tr><th>Категория</th><th class="number">Сумма</th><th class="number">Доля</th></tr></thead><tbody>'+categoryRows(records,total)+'</tbody></table></section>'+
      '<section class="section"><h2>Доходы</h2><table><thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th class="number">Сумма</th></tr></thead><tbody>'+incomeRows(records)+'</tbody></table></section>'+
      '<footer class="footer">qPokoy · отчёт сформирован локально в браузере. Для PDF выберите «Сохранить как PDF» в окне печати.</footer>'+
      '<div class="report-actions"><button type="button" onclick="window.print()">Печать / PDF</button></div>'+
      '</body></html>';
  }

  function printReport(){
    const mode=document.getElementById('printReportPeriod')?.value||'month';
    const report=filterReport(mode);
    if(!report.records.length){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Нет данных','За выбранный период доходов нет.','error');
      return;
    }

    const popup=window.open('','_blank');
    if(!popup){
      if(typeof window.qPokoyNotice==='function')window.qPokoyNotice('Печать заблокирована','Разрешите всплывающие окна для qPokoy и повторите.','error');
      return;
    }

    popup.document.open();
    popup.document.write(buildReportHtml(report));
    popup.document.close();
    popup.focus();
    setTimeout(function(){
      try{popup.print();}catch(e){}
    },250);
  }

  function bind(){
    const button=document.getElementById('printIncomeReportBtn');
    if(!button||button.__qPokoyReportPrint)return;
    button.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      printReport();
    });
    button.__qPokoyReportPrint=true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
  else bind();
})();
