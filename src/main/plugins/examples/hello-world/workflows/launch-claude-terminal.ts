// Launch Claude interactive terminal — demonstrates ctx.ai.launchTerminal()

export default async function(ctx: any) {
  ctx.log.info('Launching Claude terminal...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-terminal-result', { label: 'Terminal Session', content: 'Launching Claude terminal...' });

  try {
    const sessionId = await ctx.ai.launchTerminal({
      ai: 'claude',
      prompt: 'You are a helpful assistant running inside TaskDock. Say hello and ask how you can help.',
      show: true,
    });
    await ctx.ui.update('ai-terminal-result', {
      label: 'Claude Terminal',
      content: `Session started: ${sessionId}\nThe terminal tab should now be active.`,
    });
    await ctx.ui.update('ai-status', { value: 'Launched' });
    await ctx.ui.toast('Claude terminal launched', 'success');
    ctx.log.info(`Claude terminal launched: ${sessionId}`);
  } catch (err: any) {
    await ctx.ui.update('ai-terminal-result', {
      label: 'Terminal Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Claude terminal failed: ${err.message}`, 'error');
    ctx.log.error(`Claude terminal error: ${err.message}`);
  }
}
