// Example: Wait for PR build then trigger AI review
// Demonstrates async workflow chaining

export default async function(ctx: any) {
  const { prId } = ctx.input;

  ctx.log.info(`Starting build & review for PR #${prId}`);
  await ctx.ui.toast('Starting build watch...', 'info');

  // Poll for build status
  const adoBase = `https://dev.azure.com/${ctx.config.adoOrg}/${ctx.config.adoProject}/_apis`;
  const headers = {
    Authorization: `Basic ${Buffer.from(':' + ctx.config.pat).toString('base64')}`,
  };

  let buildStatus = 'inProgress';
  let attempts = 0;

  while (buildStatus === 'inProgress' && attempts < 60) {
    const builds = await ctx.http.get(`${adoBase}/build/builds?branchName=refs/pull/${prId}/merge&$top=1&api-version=7.0`, { headers });

    if (builds.value?.length > 0) {
      buildStatus = builds.value[0].result || 'inProgress';
      await ctx.ui.update('build-detail', { buildStatus });
    }

    if (buildStatus === 'inProgress') {
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      attempts++;
    }
  }

  if (buildStatus !== 'succeeded') {
    await ctx.ui.toast(`Build ${buildStatus} for PR #${prId}`, 'warning');
    return;
  }

  // Build succeeded - now run AI review
  await ctx.ui.toast('Build succeeded! Running AI review...', 'success');

  const diff = await ctx.shell.run(`git diff origin/main...origin/pr/${prId}`);

  const review = await ctx.ai.claude(
    `Review this PR diff and provide feedback:\n\n${diff.stdout.substring(0, 10000)}`
  );

  await ctx.ui.update('build-detail', { aiReview: review, reviewStatus: 'completed' });
  await ctx.ui.toast('AI review complete', 'success');
  ctx.log.info(`Build & review completed for PR #${prId}`);
}
