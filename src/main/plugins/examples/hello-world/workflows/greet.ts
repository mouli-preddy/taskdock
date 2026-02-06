// Hello World workflow - demonstrates basic plugin capabilities
// Tests: ctx.config, ctx.ui.update, ctx.ui.toast, ctx.store, ctx.log

export default async function(ctx: any) {
  const greeting = ctx.config.greeting || 'Hello from TaskDock!';

  ctx.log.info('Starting greeting workflow');

  // Read visit count from store
  const count = (await ctx.store.get('visitCount') || 0) + 1;
  await ctx.store.set('visitCount', count);

  // Update the UI
  await ctx.ui.update('greeting-card', {
    label: 'Greeting',
    content: `${greeting}\n\nThis greeting has been shown ${count} time(s).`,
  });

  await ctx.ui.update('response-card', {
    label: 'Last Run',
    content: `Workflow executed at ${new Date().toLocaleTimeString()}\nVisit count: ${count}`,
  });

  // Show a toast
  await ctx.ui.toast(greeting, 'success');

  ctx.log.info(`Greeting workflow completed (visit #${count})`);
}
