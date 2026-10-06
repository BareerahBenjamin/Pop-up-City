'use strict';
function planetPage() {
  if (!state.me) return gate('每个人，都有一颗自己的星球。','登录后领取你的星球，看看与邻居相遇留下的连接。');
  const welcome = location.hash === '#planet/welcome';
  const field = location.hash === '#planet/field';
  return `<section class="planet-shell"><div class="planet-heading"><div><span class="eyebrow">HERSTORY / MY PLANET</span><h1>${welcome?'这颗星球，属于你。':'我的星球'}</h1><p>${welcome?'颜色已为你保存。接下来，设置专属头像和个人资料。':'在这里看见自己，也看见与你相遇的邻居。'}</p></div><div class="planet-actions">${!state.me.avatar_locked?'<button class="btn" data-action="planet-setup">设置头像与资料 ↗</button>':'<a class="btn light" href="#me">我的主页 ↗</a>'}<a class="text-button" href="#events">返回活动</a></div></div><p id="planet-loading" class="muted" role="status">正在打开你的星球…</p><div id="planet-load-error" hidden role="alert"><p>星球暂时未能加载，已保存的信息不会丢失。</p><button class="btn light" data-action="reload-planet">重新加载</button></div><iframe id="planet-frame" src="/planet?view=${field?'field':'mine'}" title="我的 Herstory 星球：星域与 3D 展示" allow="web-share" referrerpolicy="same-origin"></iframe></section>`;
}
let planetLoadTimer,planetVisibilityObserver;
function mountPlanet() {
  clearTimeout(planetLoadTimer);
  planetVisibilityObserver?.disconnect();
  const frame=document.querySelector('#planet-frame');if(!frame)return;
  planetVisibilityObserver=new IntersectionObserver(([entry])=>frame.contentWindow?.postMessage({type:'herstory:visibility',visible:entry.isIntersecting},location.origin));
  planetVisibilityObserver.observe(frame);
  planetLoadTimer=setTimeout(()=>{if(frame.isConnected){document.querySelector('#planet-load-error').hidden=false;document.querySelector('#planet-loading').hidden=true;}},20000);
}
window.addEventListener('message',event=>{
  const frame=document.querySelector('#planet-frame');
  if(event.origin!==location.origin||!frame||event.source!==frame.contentWindow)return;
  if(event.data?.type==='herstory:planet-ready'){
    clearTimeout(planetLoadTimer);document.querySelector('#planet-loading').hidden=true;document.querySelector('#planet-load-error').hidden=true;
  }
  if(event.data?.type==='herstory:session-expired'){frame.remove();refresh();}
});
function profileSetupPage() {
  if(!state.me)return gate('设置你的社区身份。','请先用成员邮箱登录。');
  if(state.me.avatar_locked)return empty('你的头像已确认；其他个人资料可在我的主页编辑。','<a href="#me">查看我的主页</a>');
  return `<section class="section-intro"><div><span class="eyebrow">HERSTORY / WELCOME</span><h1>让邻居认识你。</h1><p>先选择头像，再填写个人资料。最终确认前可以调整，确认后头像不能重新生成，其他个人资料仍可编辑。</p></div><button class="btn" data-action="edit-avatar">开始设置头像 ↗</button></section>`;
}
window.addEventListener('storage',event=>{if(event.key==='herstory:session-changed'){document.querySelector('#planet-frame')?.remove();setupDraft=null;refresh();}});
function broadcastSessionChange(){try{localStorage.setItem('herstory:session-changed',String(Date.now()))}catch{}}
