// Launch Copilot interactive terminal — demonstrates ctx.ai.launchTerminal()

export default async function(ctx: any) {
  ctx.log.info('Launching Copilot terminal...');
  await ctx.ui.update('ai-status', { value: 'Calling...' });
  await ctx.ui.update('ai-terminal-result', { label: 'Terminal Session', content: 'Launching Copilot terminal...' });

  try {
    const sessionId = await ctx.ai.launchTerminal({
      ai: 'copilot',
      prompt: 'You are a helpful assistant running inside TaskDock. Say hello and ask how you can help.',
      show: true,
    });
    await ctx.ui.update('ai-terminal-result', {
      label: 'Copilot Terminal',
      content: `Session started: ${sessionId}\nThe terminal tab should now be active.`,
    });
    await ctx.ui.update('ai-status', { value: 'Launched' });
    await ctx.ui.toast('Copilot terminal launched', 'success');
    ctx.log.info(`Copilot terminal launched: ${sessionId}`);
  } catch (err: any) {
    await ctx.ui.update('ai-terminal-result', {
      label: 'Terminal Error',
      content: `Error: ${err.message}`,
    });
    await ctx.ui.update('ai-status', { value: 'Error' });
    await ctx.ui.toast(`Copilot terminal failed: ${err.message}`, 'error');
    ctx.log.error(`Copilot terminal error: ${err.message}`);
  }
}
