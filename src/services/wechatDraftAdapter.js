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
        content: `<p>${String(task.body || '').split('\n').map((line) => line.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))).join('</p><p>')}</p>`,
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

  return { readiness, addDraft };
}

module.exports = { createWechatDraftAdapter };
