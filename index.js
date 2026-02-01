import * as core from '@actions/core';
import * as github from '@actions/github';
import { GoogleGenerativeAI } from "@google/generative-ai";

async function run() {
  try {
    const apiKey = core.getInput('gemini_api_key');
    const githubToken = core.getInput('github_token');

    if (!apiKey || !githubToken) {
      core.setFailed("Missing API Key or GitHub Token.");
      return;
    }

    const octokit = github.getOctokit(githubToken);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const context = github.context;

    if (context.eventName !== 'push') {
      core.info('This action only runs on push events. Skipping.');
      return;
    }

    // 1. Get the Diff
    const { data: compare } = await octokit.rest.repos.compareCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: context.payload.before,
      head: context.payload.after,
    });

    const changes = compare.files
      .filter(f => f.status === 'modified' || f.status === 'added')
      .map(f => `File: ${f.filename}\nDiff:\n${f.patch}`)
      .join("\n\n");

    if (!changes) return;

    // 2. Ask Gemini
    const prompt = `
      Update the project README based on these code changes. 
      If no significant features were added, return "NO_UPDATE".
      Changes: ${changes}
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const newReadme = response.text();

    if (newReadme.includes("NO_UPDATE")) return;

    // 3. Update README
    const { data: readme } = await octokit.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'README.md',
    });

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'README.md',
      message: 'docs: update readme [skip ci]',
      content: Buffer.from(newReadme).toString('base64'),
      sha: readme.sha,
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}
// Triggering test 1
run();