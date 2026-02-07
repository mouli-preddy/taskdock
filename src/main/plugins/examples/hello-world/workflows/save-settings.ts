// Save settings workflow - demonstrates form submission handling

export default async function(ctx: any) {
  const customGreeting = ctx.input?.customGreeting;

  if (customGreeting && customGreeting.trim()) {
    await ctx.store.set('customGreeting', customGreeting.trim());
    await ctx.ui.toast(`Greeting updated to: "${customGreeting.trim()}"`, 'success');
    ctx.log.info(`Custom greeting saved: ${customGreeting.trim()}`);
  } else {
    await ctx.ui.toast('Please enter a greeting message', 'warning');
  }
}
