// Example: Generate a daily summary of incidents
// Runs on a cron schedule (weekdays at 9 AM)

export default async function(ctx: any) {
  const incidents = await ctx.http.get(
    `${ctx.config.icmEndpoint}/teams/${ctx.config.teamId}/incidents?since=24h`
  );

  if (incidents.length === 0) {
    ctx.log.info('No incidents in the last 24 hours');
    return;
  }

  const summary = await ctx.ai.claude(
    `Summarize these ${incidents.length} incidents from the last 24 hours:\n` +
    incidents.map((i: any) => `- [Sev${i.severity}] ${i.title} (${i.status})`).join('\n')
  );

  await ctx.ui.toast(`Daily summary: ${incidents.length} incident(s)`, 'info');
  ctx.log.info(`Daily summary generated for ${incidents.length} incidents`);
}
