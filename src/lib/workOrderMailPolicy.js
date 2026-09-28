function isAutomaticWorkOrderMailEnabled(env = process.env) {
  return String(env.WORK_ORDER_AUTO_EMAIL_ENABLED || '').trim() === '1';
}

module.exports = { isAutomaticWorkOrderMailEnabled };
