// Hello World workflow - demonstrates all plugin UI capabilities
// Tests: ctx.config, ctx.ui.update, ctx.ui.toast, ctx.store, ctx.log

export default async function(ctx: any) {
  const customGreeting = await ctx.store.get('customGreeting');
  const greeting = customGreeting || ctx.config.greeting || 'Hello from TaskDock!';

  ctx.log.info('Starting greeting workflow');

  // Read visit count and history from store
  const count = (await ctx.store.get('visitCount') || 0) + 1;
  await ctx.store.set('visitCount', count);

  const history: any[] = (await ctx.store.get('greetingHistory') || []);
  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  // Add to history (keep last 20)
  history.unshift({ time: timeStr, message: greeting, count });
  if (history.length > 20) history.length = 20;
  await ctx.store.set('greetingHistory', history);

  // Update greeting card
  await ctx.ui.update('greeting-card', {
    label: 'Greeting',
    content: `${greeting}\n\nThis greeting has been shown ${count} time(s).`,
  });

  // Update response card
  await ctx.ui.update('response-card', {
    label: 'Last Run',
    content: `Workflow executed at ${timeStr}\nVisit count: ${count}`,
  });

  // Update status badge
  await ctx.ui.update('run-status', {
    value: 'Success',
    colorMap: {
      'Ready': '#58a6ff',
      'Success': '#3fb950',
      'Error': '#f85149',
    },
  });

  // Update key-value stats
  await ctx.ui.update('stats-kv', {
    'Total Runs': String(count),
    'Last Run': timeStr,
    'Greeting': greeting,
    'Plugin Version': '1.0.0',
  });

  // Update activity timeline
  const timeline = history.slice(0, 10).map((h: any, i: number) => ({
    time: h.time,
    title: `Greeting #${h.count}`,
    description: h.message,
  }));
  await ctx.ui.update('activity-timeline', timeline);

  // Update greetings table
  await ctx.ui.update('greetings-table', history);

  // Show a toast
  await ctx.ui.toast(greeting, 'success');

  ctx.log.info(`Greeting workflow completed (visit #${count})`);
}
