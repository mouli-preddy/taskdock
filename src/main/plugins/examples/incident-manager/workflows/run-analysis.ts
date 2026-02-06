// Example: Run AI analysis on an incident
// This workflow is triggered manually or by poll-incidents when new incidents are found

export default async function(ctx: any) {
  const { incidentId } = ctx.input;

  // Fetch incident details
  const incident = await ctx.http.get(`${ctx.config.icmEndpoint}/incidents/${incidentId}`);

  // Get impacted services
  const impact = await ctx.http.get(`${ctx.config.icmEndpoint}/incidents/${incidentId}/impact`);

  // Ask AI to analyze
  const analysis = await ctx.ai.claude(
    `Analyze this incident and suggest mitigation steps:\n` +
    `Title: ${incident.title}\n` +
    `Severity: ${incident.severity}\n` +
    `Impact: ${JSON.stringify(impact)}\n` +
    `Description: ${incident.description}`
  );

  // Store result and update UI
  await ctx.store.set(`analysis:${incidentId}`, analysis);
  await ctx.ui.update('incident-detail', { aiAnalysis: analysis });
  await ctx.ui.toast('Analysis complete', 'success');
}
