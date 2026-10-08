(function(){
  'use strict';
  const filters=document.querySelector('.admin-filters');
  const dashboard=filters?.closest('.admin-dashboard');
  if(!filters||!dashboard)return;

  let toggle=filters.querySelector('.admin-mobile-filter-toggle');
  if(!toggle){
  toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='admin-mobile-filter-toggle';
  toggle.textContent='Фильтры';
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Показать или скрыть фильтры пользователей');

  const search=filters.querySelector('.admin-search-box');
  if(search)search.insertAdjacentElement('afterend',toggle);
  else filters.prepend(toggle);
  }
  // Reusing a static button or rerunning the adapter must not bind it twice.
  if(toggle.__qPokoyFilterToggleBound)return;

  const media=window.matchMedia('(max-width: 640px)');
  function closeOnDesktop(){
    if(media.matches)return;
    dashboard.classList.remove('mobile-filters-open');
    toggle.setAttribute('aria-expanded','false');
  }

  toggle.addEventListener('click',()=>{
    const open=dashboard.classList.toggle('mobile-filters-open');
    toggle.setAttribute('aria-expanded',String(open));
  });

  if(media.addEventListener)media.addEventListener('change',closeOnDesktop);
  else if(media.addListener)media.addListener(closeOnDesktop);
  closeOnDesktop();
  toggle.__qPokoyFilterToggleBound=true;
})();
