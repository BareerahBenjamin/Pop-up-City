'use strict';
// Reconcile an uncertain write before retrying. A local draft is never proof of a server save.
globalThis.HerstoryProfileSave = {
  matches(member, body) {
    if (!member || !['nickname','bio','skills','needs'].every(key => member[key] === body[key].trim()) || member.card_public !== body.card_public) return false;
    if (!body.finalize) return true;
    const saved = member.avatar, requested = body.avatar;
    return member.avatar_locked && typeof requested?.release === 'string' && requested.selection && saved?.release === requested.release &&
      Object.keys(saved?.selection || {}).length === Object.keys(requested?.selection || {}).length &&
      Object.entries(requested?.selection || {}).every(([key,value]) => saved.selection?.[key] === value);
  },
  async save(call, ownerId, body, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    const verifyOwner = result => {
      if (!result?.member) throw Object.assign(new Error('未完整收到保存结果，已保留填写内容，请重试。'), { network: true });
      if (result.member.id !== ownerId) throw Object.assign(new Error('登录账号已改变，请用原账号重新登录后保存。'), { status: 401 });
      return result;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return verifyOwner(await call('/api/me', { method: 'PATCH', headers: { 'X-Profile-Owner': ownerId }, body }));
      } catch (error) {
        if (!error.network && !(body.finalize && error.status === 409)) throw error;
        let retry = false;
        for (let check = 0; check < 2; check++) {
          try {
            const current = verifyOwner(await call('/api/me'));
            if (this.matches(current.member, body)) return current;
            if (body.finalize && current.member.avatar_locked) throw Object.assign(new Error('头像已在其他页面确认，本次填写内容未覆盖。请在我的主页编辑其他资料。'), { status: 409, member: current.member });
            if (error.status === 409) throw error;
            // Only retry after confirming that the same account has not saved this draft.
            retry = attempt === 0;
            break;
          } catch (readError) {
            if (!readError.network) throw readError;
          }
          if (check === 0) await wait(350);
        }
        if (!retry) throw error;
      }
    }
  },
};
