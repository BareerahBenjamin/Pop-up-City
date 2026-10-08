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
  tellHost('herstory:planet-ready');
})();
