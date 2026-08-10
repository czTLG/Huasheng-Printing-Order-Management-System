function createWechatDraftAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  const appId = env.WECHAT_OFFICIAL_APP_ID || '';
  const appSecret = env.WECHAT_OFFICIAL_APP_SECRET || '';
  const thumbMediaId = env.WECHAT_OFFICIAL_THUMB_MEDIA_ID || '';

  function readiness() {
    return { ready: Boolean(appId && appSecret && thumbMediaId), required: ['WECHAT_OFFICIAL_APP_ID', 'WECHAT_OFFICIAL_APP_SECRET', 'WECHAT_OFFICIAL_THUMB_MEDIA_ID'] };
  }

  async function addDraft(task) {
    if (!readiness().ready) {
      const error = new Error('微信公众号草稿接口尚未配置');
      error.code = 'WECHAT_NOT_CONFIGURED';
      throw error;
    }
    const tokenResponse = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`);
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(`微信令牌获取失败: ${tokenData.errcode || tokenResponse.status}`);
    const response = await fetchImpl(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(tokenData.access_token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: [{
        title: task.title,
        author: 'Huasheng Packaging',
        digest: String(task.body || '').slice(0, 120),
        content: renderContent(task),
        content_source_url: task.target_url,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }] }),
    });
    const data = await response.json();
    if (!response.ok || !data.media_id) throw new Error(`微信草稿创建失败: ${data.errcode || response.status}`);
    return { mediaId: data.media_id };
  }

  return { readiness, addDraft, renderContent };
}

module.exports = { createWechatDraftAdapter };
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function renderContent(task) {
    return String(task.body || '').split('\n').map((raw, index) => {
      const line = raw.trim();
      if (!line || (index === 0 && line === task.title)) return '';
      if (/^(导语|[一二三四五六七八九十]+、|结语)/.test(line)) return `<h2 style="margin:28px 0 12px;font-size:20px;color:#173f4f;line-height:1.5">${escapeHtml(line)}</h2>`;
      if (/^\d+\./.test(line)) return `<p style="margin:10px 0;font-size:16px;font-weight:600;line-height:1.8;color:#263238">${escapeHtml(line)}</p>`;
      if (/^•/.test(line)) return `<p style="margin:8px 0;padding-left:12px;border-left:3px solid #77a8a0;font-size:16px;line-height:1.8;color:#37474f">${escapeHtml(line)}</p>`;
      if (/^阅读原文：https:\/\//.test(line)) {
        const url = line.replace(/^阅读原文：/, '');
        return `<p style="margin:28px 0 8px"><a href="${escapeHtml(url)}" style="color:#176b78;font-size:16px;font-weight:600">阅读华胜包装完整技术页面</a></p>`;
      }
      return `<p style="margin:10px 0;font-size:16px;line-height:1.9;color:#37474f">${escapeHtml(line)}</p>`;
    }).join('');
  }
