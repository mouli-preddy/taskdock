// Example: Poll for ICM incidents
// This workflow runs on a polling schedule and updates the incident list

export default async function(ctx: any) {
  const incidents = await ctx.http.get(
    `${ctx.config.icmEndpoint}/teams/${ctx.config.teamId}/incidents`
  );

  // Check for new incidents since last poll
  const lastPoll = await ctx.store.get('lastPollTime') || 0;
  const newIncidents = incidents.filter((i: any) => new Date(i.createdDate).getTime() > lastPoll);

  if (newIncidents.length > 0) {
    // Auto-run analysis on each new incident
    for (const incident of newIncidents) {
      await ctx.run('runAnalysis', { incidentId: incident.id });
    }
    await ctx.ui.toast(`${newIncidents.length} new incident(s) analyzed`, 'info');
  }

  // Update the table and save poll time
  await ctx.ui.update('incident-list', incidents);
  await ctx.store.set('lastPollTime', Date.now());
}
