import { reportActionFailure, runGitHubAction } from './github-action.js';

const abortController = new AbortController();
let stopRequested = false;
const stopGracefully = (): void => {
  if (stopRequested) {
    process.stderr.write('Second interrupt received; exiting immediately.\n');
    process.exit(130);
  }
  stopRequested = true;
  process.stderr.write('Stop requested. Closing browser work and writing partial audit artifacts.\n');
  abortController.abort('GitHub Action cancelled');
};

process.on('SIGINT', stopGracefully);
process.on('SIGTERM', stopGracefully);

runGitHubAction(process.env, abortController.signal)
  .then((result) => {
    if (result.status === 'cancelled') process.exitCode = 130;
  })
  .catch(reportActionFailure)
  .finally(() => {
    process.off('SIGINT', stopGracefully);
    process.off('SIGTERM', stopGracefully);
  });
