// Generic hook workflow for testing: shows a toast for any event

export default async function(ctx: any) {
  const { event, ...data } = ctx.input;
  const summary = Object.entries(data)
    .map(([k, v]: [string, any]) => {
      if (v && typeof v === 'object') {
        return `${k}: ${v.title || v.name || v.id || JSON.stringify(v)}`;
      }
      return `${k}: ${v}`;
    })
    .join(', ');

  ctx.log.info(`From hello: ${event} — ${summary}`);
  await ctx.ui.toast(`From hello: ${event} — ${summary}`, 'info');
}
