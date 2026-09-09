import { reportActionFailure, runGitHubAction } from './github-action.js';

runGitHubAction().catch(reportActionFailure);
