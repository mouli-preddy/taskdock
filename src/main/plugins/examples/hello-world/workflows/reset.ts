// Reset workflow - clears all stored data and resets UI to initial state

export default async function(ctx: any) {
  ctx.log.info('Resetting plugin data');

  await ctx.store.delete('visitCount');
  await ctx.store.delete('greetingHistory');

  await ctx.ui.update('greeting-card', {
    label: 'Greeting',
    content: "Click 'Say Hello' to run the greeting workflow",
  });

  await ctx.ui.update('response-card', {
    label: 'Last Run',
    content: 'No runs yet',
  });

  await ctx.ui.update('run-status', {
    value: 'Ready',
    colorMap: {
      'Ready': '#58a6ff',
      'Success': '#3fb950',
      'Error': '#f85149',
    },
  });

  await ctx.ui.update('stats-kv', {});
  await ctx.ui.update('activity-timeline', []);
  await ctx.ui.update('greetings-table', []);

  await ctx.ui.toast('Plugin data reset', 'info');
  ctx.log.info('Reset complete');
}
