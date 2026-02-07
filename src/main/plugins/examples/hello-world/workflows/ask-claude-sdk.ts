// Ask Claude via SDK — demonstrates ctx.ai.claude()

export default async function(ctx: any) {
  ctx.log.info('Calling Claude SDK...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-sdk-result', { label: 'SDK Response', content: 'Waiting for Claude...' });

  try {
    const response = await ctx.ai.claude('What is TaskDock in one sentence? (Make something up, this is a test.)');
    await ctx.ui.update('ai-sdk-result', {
      label: 'Claude SDK Response',
      content: response,
    });
    await ctx.ui.update('ai-status', { value: 'Done' });
    await ctx.ui.toast('Claude SDK response received', 'success');
    ctx.log.info('Claude SDK call succeeded');
  } catch (err: any) {
    await ctx.ui.update('ai-sdk-result', {
      label: 'Claude SDK Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Claude SDK failed: ${err.message}`, 'error');
    ctx.log.error(`Claude SDK error: ${err.message}`);
  }
}
