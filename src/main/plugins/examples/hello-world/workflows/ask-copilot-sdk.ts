// Ask Copilot via SDK — demonstrates ctx.ai.copilot()

export default async function(ctx: any) {
  ctx.log.info('Calling Copilot SDK...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-sdk-result', { label: 'SDK Response', content: 'Waiting for Copilot...' });

  try {
    const response = await ctx.ai.copilot('What is TaskDock in one sentence? (Make something up, this is a test.)');
    await ctx.ui.update('ai-sdk-result', {
      label: 'Copilot SDK Response',
      content: response,
    });
    await ctx.ui.update('ai-status', { value: 'Done' });
    await ctx.ui.toast('Copilot SDK response received', 'success');
    ctx.log.info('Copilot SDK call succeeded');
  } catch (err: any) {
    await ctx.ui.update('ai-sdk-result', {
      label: 'Copilot SDK Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Copilot SDK failed: ${err.message}`, 'error');
    ctx.log.error(`Copilot SDK error: ${err.message}`);
  }
}
