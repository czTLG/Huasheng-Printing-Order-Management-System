const { validateImapConfig, syncMailbox, classifyImapError } = require('../src/lib/imapSync');

function printSummary(label, result) {
  console.log(JSON.stringify({
    label,
    run_id: result?.id || null,
    folder: result?.folder || '',
    scanned_count: Number(result?.scanned_count || 0),
    inserted_count: Number(result?.inserted_count || 0),
    skipped_count: Number(result?.skipped_count || 0),
    error_count: Number(result?.error_count || 0),
    status: result?.status || '',
    error_message: result?.error_message || ''
  }, null, 2));
}

async function tryFolder(folder) {
  try {
    const result = await syncMailbox({ folder, days: 7, limit: 10, operator: 'verify-imap-sync' });
    printSummary(`sync:${folder}`, result);
    return { ok: true, folder: result.folder };
  } catch (err) {
    printSummary(`sync:${folder}`, {
      ...(err.summary || {}),
      folder,
      status: 'failed',
      error_message: classifyImapError(err)
    });
    return { ok: false, folder, error: classifyImapError(err) };
  }
}

async function main() {
  const validation = validateImapConfig();
  console.log(JSON.stringify({
    imapConfigured: validation.ok,
    host: validation.config.host || '',
    port: validation.config.port || 0,
    secure: !!validation.config.secure,
    userMasked: validation.config.userMasked || '',
    passwordConfigured: !!validation.config.passwordConfigured,
    missing: validation.missing
  }, null, 2));

  if (!validation.ok) {
    console.error('IMAP configuration is incomplete');
    process.exitCode = 1;
    return;
  }

  await tryFolder('INBOX');
  const sentCandidates = ['Sent', 'Sent Messages', 'Sent Mail', '已发送', '已发送邮件'];
  let sentOk = false;
  for (const folder of sentCandidates) {
    const result = await tryFolder(folder);
    if (result.ok) {
      sentOk = true;
      break;
    }
  }
  if (!sentOk) {
    console.error('No sent folder candidate succeeded');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: 'failed',
    error: classifyImapError(err)
  }, null, 2));
  process.exitCode = 1;
});
