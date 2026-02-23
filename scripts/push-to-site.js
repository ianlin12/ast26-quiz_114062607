#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SITE_API_URL = process.env.SITE_API_URL;
const QUIZ_PUSH_TOKEN = process.env.QUIZ_PUSH_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_SHA = process.env.GITHUB_SHA || 'unknown';

if (!SITE_API_URL || !QUIZ_PUSH_TOKEN) {
  console.error('SITE_API_URL and QUIZ_PUSH_TOKEN must be set');
  process.exit(1);
}

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SITE_API_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Authorization': `Bearer ${QUIZ_PUSH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function requestWithRetry(method, urlPath, body, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await apiRequest(method, urlPath, body);

      if (result.status >= 200 && result.status < 300) {
        return { success: true, result };
      }

      if (result.status >= 400 && result.status < 500) {
        // Client error — don't retry
        return { success: false, result, error: `${result.status} ${result.body}` };
      }

      // 5xx — retry
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.log(`  Retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        return { success: false, result, error: `${result.status} after ${maxRetries} retries` };
      }
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        console.log(`  Network error, retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        return { success: false, error: `Network error after ${maxRetries} retries: ${err.message}` };
      }
    }
  }
}

function parseQuizPath(filePath) {
  // docs/<pillar>/<concept>/quiz/<filename>
  const parts = filePath.split('/');
  const docsIdx = parts.indexOf('docs');
  if (docsIdx < 0) return null;
  return {
    pillar: parts[docsIdx + 1],
    concept: parts[docsIdx + 2],
    filename: parts[parts.length - 1],
  };
}

async function createFailureIssue(failures) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.error('Cannot create issue: GITHUB_TOKEN or GITHUB_REPOSITORY not set');
    return;
  }

  const rows = failures.map(f => `| \`${f.file}\` | ${f.error} |`).join('\n');
  const body = `## \u26A0\uFE0F Quiz Sync Failed

The following quiz files were merged but failed to push to the course website.

| File | Error |
|------|-------|
${rows}

**Action needed:** Run manual reconciliation or re-trigger this workflow.

Commit: ${GITHUB_SHA}`;

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const url = new URL(`/repos/${owner}/${repo}/issues`, 'https://api.github.com');

  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'quiz-push-bot',
        'Accept': 'application/vnd.github+json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Created failure issue on GitHub');
        } else {
          console.error(`Failed to create issue: ${res.statusCode} ${data}`);
        }
        resolve();
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify({
      title: `Quiz sync failed for commit ${GITHUB_SHA.slice(0, 7)}`,
      body,
      labels: ['sync-failure'],
    }));
    req.end();
  });
}

async function main() {
  // Get changed files
  let diffOutput;
  try {
    diffOutput = execSync(
      "git diff --name-status HEAD~1 HEAD -- 'docs/**/quiz/q-*.yaml'",
      { encoding: 'utf8' }
    ).trim();
  } catch {
    console.log('No quiz file changes detected');
    process.exit(0);
  }

  if (!diffOutput) {
    console.log('No quiz file changes detected');
    process.exit(0);
  }

  const lines = diffOutput.split('\n');
  const failures = [];

  for (const line of lines) {
    const [status, filePath] = line.split('\t');
    const info = parseQuizPath(filePath);
    if (!info) {
      console.log(`\u26A0\uFE0F Skipping unrecognized path: ${filePath}`);
      continue;
    }

    if (status === 'A' || status === 'M') {
      // Upsert
      let data;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        data = yaml.load(content);
      } catch (err) {
        console.log(`\u274C ${info.filename} \u2192 FAILED (parse error: ${err.message})`);
        failures.push({ file: filePath, error: `Parse error: ${err.message}` });
        continue;
      }

      const payload = {
        pillar: info.pillar,
        concept: info.concept,
        filename: info.filename,
        author: data.author,
        date: data.date instanceof Date ? data.date.toISOString().split('T')[0] : data.date,
        question: data.question,
        options: data.options,
      };

      const result = await requestWithRetry('POST', '/api/quiz', payload);
      if (result.success) {
        console.log(`\u2705 ${info.filename} \u2192 upserted`);
      } else {
        console.log(`\u274C ${info.filename} \u2192 FAILED (${result.error})`);
        failures.push({ file: filePath, error: result.error });
      }
    } else if (status === 'D') {
      // Delete
      const payload = {
        pillar: info.pillar,
        concept: info.concept,
        filename: info.filename,
      };

      const result = await requestWithRetry('DELETE', '/api/quiz', payload);
      if (result.success) {
        console.log(`\u2705 ${info.filename} \u2192 deleted`);
      } else {
        console.log(`\u274C ${info.filename} \u2192 FAILED (${result.error})`);
        failures.push({ file: filePath, error: result.error });
      }
    }
  }

  if (failures.length > 0) {
    console.log(`\n\u274C ${failures.length} file(s) failed to sync`);
    await createFailureIssue(failures);
    process.exit(1);
  } else {
    console.log('\n\u2705 All files synced successfully');
  }
}

main();
