const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const presets = {
  pinterest: [1000, 1500], linkedin: [1200, 627], facebook: [1200, 627], wechat: [900, 383],
  instagram: [1080, 1350], zhihu: [1200, 675], medium: [1200, 675], youtube: [1280, 720],
  baijiahao: [1200, 675], toutiao: [1200, 675], sohu: [1200, 675], vk: [1200, 675],
};

function createStreamMedia({ root = process.env.MATRIX_STREAM_MEDIA_PATH || path.join(__dirname, '..', '..', 'data', 'stream-media'), fetchImpl = fetch } = {}) {
  fs.mkdirSync(root, { recursive: true });

  async function prepare(task) {
    if (!task?.media_url) throw new Error('该任务没有来源图片');
    const source = new URL(task.media_url);
    if (source.protocol !== 'https:' || source.hostname !== 'gdhspack.com') throw new Error('只处理官网自有图片');
    const response = await fetchImpl(source.toString(), { redirect: 'follow', headers: { 'User-Agent': 'HuashengStreamDesk/1.0' } });
    if (!response.ok) throw new Error(`图片读取失败: HTTP ${response.status}`);
    if (response.url && new URL(response.url).hostname !== 'gdhspack.com') throw new Error('图片重定向到了外部域名');
    const type = String(response.headers.get('content-type') || '');
    const size = Number(response.headers.get('content-length') || 0);
    if (!type.startsWith('image/') || size > 15 * 1024 * 1024) throw new Error('来源不是支持的图片或文件过大');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) throw new Error('图片超过 15MB');
    const [width, height] = presets[task.platform] || [1200, 675];
    const image = await Jimp.read(buffer);
    image.contain(width, height, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE).background(0xffffffff).quality(84);
    const file = path.join(root, `task-${Number(task.id)}-${task.platform}.jpg`);
    await image.writeAsync(file);
    return { file, width, height };
  }

  function locate(task) {
    const file = path.join(root, `task-${Number(task.id)}-${task.platform}.jpg`);
    return fs.existsSync(file) ? file : null;
  }

  return { prepare, locate, presets };
}

module.exports = { createStreamMedia };
