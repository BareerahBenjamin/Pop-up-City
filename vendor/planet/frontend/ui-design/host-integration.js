(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const tellHost = type => { if (parent !== window) parent.postMessage({ type }, location.origin); };
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'herstory:visibility') return;
    window.HerstoryHostVisible = event.data.visible === true;
    document.body.classList.toggle('host-offscreen', !window.HerstoryHostVisible);
  });
  window.HerstorySessionExpired = () => {
    window.HerstoryApp?.stop();
    document.body.replaceChildren();
    const message = document.createElement('p'), link = document.createElement('a');
    message.textContent = '登录状态已变化，请重新进入星球。';
    link.href = '/#planet'; link.target = '_top'; link.textContent = '返回网站';
    document.body.append(message, link); tellHost('herstory:session-expired');
  };
  // Reports await verified phase data and a server archive. Keep the module, avoid demo reports.
  const reports = document.querySelector('.bottom-nav [data-tab="reports"]');
  reports.disabled = true; reports.title = '活动报告将在开放后提供'; reports.querySelector('span').textContent = '报告待开放';
  $('#day-label-ui').textContent = window.HERSTORY_INITIAL_STATE?.growth?.rewardCount?'已获得 '+window.HERSTORY_INITIAL_STATE.growth.rewardCount+' 项成长奖励':'初始星球';
  const summary=document.createElement('dialog');summary.id='growth-summary';summary.setAttribute('aria-label','我的星球成长');document.body.append(summary);
  window.HerstoryGrowthDisplay=growth=>{
    summary.replaceChildren();if(!growth)return;const close=document.createElement('button');close.type='button';close.textContent='关闭成长记录';close.className='growth-close';close.onclick=()=>summary.close();summary.append(close);
    const heading=document.createElement('h2');heading.textContent='星球成长';summary.append(heading);
    const status=document.createElement('p');status.textContent=growth.status==='ready'?('已签到 '+growth.checkinCount+' 场 · 获得 '+growth.rewardCount+' 项奖励'):'成长规则尚未启用，签到记录会保留';summary.append(status);
    if(growth.pendingCheckins){const p=document.createElement('p');p.textContent=growth.pendingCheckins+' 场签到等待活动奖励绑定';summary.append(p);}
    const list=document.createElement('ul');for(const track of growth.tracks||[]){const item=document.createElement('li');item.textContent=track.name+' '+track.level+'/'+track.cap+(track.nextLabel?' · 下一档：'+track.nextLabel:'');list.append(item);}summary.append(list);
    if(growth.rewards?.length){const details=document.createElement('details'),title=document.createElement('summary');title.textContent='查看已获得的奖励';details.append(title);const rewards=document.createElement('ul');for(const reward of growth.rewards){const li=document.createElement('li');li.textContent=reward.label;rewards.append(li);}details.append(rewards);summary.append(details);}
  };
  window.HerstoryGrowthDisplay(window.HERSTORY_INITIAL_STATE?.growth);
  const growthButton=document.createElement('button');growthButton.type='button';growthButton.textContent='查看成长';growthButton.onclick=()=>summary.showModal();document.querySelector('.mine-footer').append(growthButton);
  tellHost('herstory:planet-ready');
})();
