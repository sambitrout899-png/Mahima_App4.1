// Only a server terminal status ends polling. Missing rows and network failures
// do not prove the render stopped and must not unlock duplicate attempts.
export function startDemoPolling({ fetchJob, onJob, onWaiting, onError, schedule = setTimeout, unschedule = clearTimeout }) {
  let cancelled = false;
  let timer;
  async function poll() {
    let terminal = false;
    try {
      const job = await fetchJob();
      if (cancelled) return;
      if (job) {
        terminal = ['completed', 'failed'].includes(String(job.status || '').toLowerCase());
        const decision = onJob(job);
        if (decision === false) terminal = true;
        if (decision === true) terminal = false;
      } else onWaiting();
    } catch (error) {
      if (!cancelled) onError(error);
    } finally {
      if (!cancelled && !terminal) timer = schedule(poll, 4000);
    }
  }
  timer = schedule(poll, 1500);
  return () => { cancelled = true; unschedule(timer); };
}
