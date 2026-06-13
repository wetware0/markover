import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { startDeviceFlow, pollForToken } from './auth';
import { clearToken } from './token-store';
import * as api from './api';

export function registerGitHubHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GITHUB_START_AUTH, () => startDeviceFlow());
  ipcMain.handle(IPC_CHANNELS.GITHUB_POLL_AUTH, (_e, deviceCode: string, interval: number, expiresIn: number) =>
    pollForToken(deviceCode, interval, expiresIn));
  ipcMain.handle(IPC_CHANNELS.GITHUB_SIGN_OUT, () => clearToken());
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_USER, () => api.getUser());
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, () => api.listRepos());
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_CONTENTS, (_e, owner: string, repo: string, dirPath: string, ref?: string) =>
    api.listContents(owner, repo, dirPath, ref));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_FILE, (_e, owner: string, repo: string, filePath: string, ref?: string) =>
    api.getFile(owner, repo, filePath, ref));
  ipcMain.handle(IPC_CHANNELS.GITHUB_PUT_FILE, (_e, owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) =>
    api.putFile(owner, repo, filePath, content, message, branch, sha));
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_BRANCHES, (_e, owner: string, repo: string) => api.listBranches(owner, repo));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_BRANCH_SHA, (_e, owner: string, repo: string, branch: string) => api.getBranchHeadSha(owner, repo, branch));
  ipcMain.handle(IPC_CHANNELS.GITHUB_CREATE_BRANCH, (_e, owner: string, repo: string, newBranch: string, fromSha: string) => api.createBranch(owner, repo, newBranch, fromSha));
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_PRS, (_e, owner: string, repo: string) => api.listPullRequests(owner, repo));
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_PR_FILES, (_e, owner: string, repo: string, num: number) => api.listPullRequestFiles(owner, repo, num));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_PR, (_e, owner: string, repo: string, num: number) => api.getPullRequest(owner, repo, num));
  ipcMain.handle(IPC_CHANNELS.GITHUB_SUBMIT_REVIEW, (_e, owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => api.submitReview(owner, repo, num, event, body));
}
