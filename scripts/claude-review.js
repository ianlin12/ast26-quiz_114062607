#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Anthropic = require('@anthropic-ai/sdk');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/claude-review.js <file1.yaml> [file2.yaml ...]');
  process.exit(0); // advisory — don't block
}

const repoRoot = path.resolve(__dirname, '..');

// Load .env if present (for local testing)
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const val = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY not set — skipping AI review');
  const md = '## \uD83E\uDD16 AI Quality Review\n\n> AI review unavailable — `ANTHROPIC_API_KEY` not configured. Please review manually.\n\n---\n_Review by Claude (claude-sonnet-4-5-20250929). This is advisory — a maintainer makes the final merge decision._\n';
  fs.writeFileSync(path.join(repoRoot, 'claude-review-results.md'), md);
  process.exit(0);
}

const client = new Anthropic({ apiKey });

async function reviewFile(filePath) {
  const absPath = path.resolve(filePath);
  const relPath = path.relative(repoRoot, absPath);
  const basename = path.basename(filePath);
  const quizDir = path.dirname(absPath);

  // Extract pillar/concept from path
  const pathParts = relPath.split(path.sep);
  // Expected: docs/<pillar>/<concept>/quiz/<file>
  const docsIdx = pathParts.indexOf('docs');
  const pillar = docsIdx >= 0 ? pathParts[docsIdx + 1] : 'unknown';
  const concept = docsIdx >= 0 ? pathParts[docsIdx + 2] : 'unknown';

  // Read new file
  const newContent = fs.readFileSync(absPath, 'utf8');

  // Read all existing q-*.yaml files in the same quiz/ directory (excluding the new file)
  let existingFiles = [];
  try {
    const allFiles = fs.readdirSync(quizDir)
      .filter(f => f.startsWith('q-') && f.endsWith('.yaml') && f !== basename)
      .sort();

    let truncated = false;
    let filesToRead = allFiles;
    if (allFiles.length > 50) {
      filesToRead = allFiles.slice(-20); // 20 most recent
      truncated = true;
    }

    for (const f of filesToRead) {
      const content = fs.readFileSync(path.join(quizDir, f), 'utf8');
      existingFiles.push({ filename: f, content });
    }

    if (truncated) {
      console.log(`  Note: ${allFiles.length} existing files, showing 20 most recent`);
    }
  } catch {
    // no existing files
  }

  const existingSection = existingFiles.length > 0
    ? existingFiles.map(f => `### ${f.filename}\n\`\`\`yaml\n${f.content}\`\`\``).join('\n\n')
    : '(none)';

  const userPrompt = `## New Question
File: ${basename}
Topic: ${pillar} / ${concept}

\`\`\`yaml
${newContent}\`\`\`

## Existing Questions in This Topic (${existingFiles.length} total)
${existingSection}

## Review Tasks

### 1. Quality Assessment
- Is the question testing reasoning, application, or analysis — NOT just vocabulary recall or definition matching?
- Is the correct answer unambiguously correct?
- Are all 4 distractors plausible? Does each represent a real misconception a student might have?
- Are the explanations clear and educational?
- Is the question well-written (clear, grammatically correct, sufficient context)?

### 2. Duplicate Detection
- Is this question semantically different from ALL existing questions?
- It must test a different aspect, scenario, or reasoning chain — not just rephrase an existing question with different numbers or wording.
- If it overlaps with an existing question, identify which one and explain the overlap.

Respond in this exact JSON format:
{
  "quality_verdict": "approve" | "request-changes",
  "quality_feedback": "One paragraph explaining your assessment.",
  "is_duplicate": true | false,
  "duplicate_of": "filename.yaml" | null,
  "duplicate_explanation": "..." | null,
  "suggestions": ["2-3 alternative angles the student could explore if this is a duplicate or needs improvement"]
}`;

  const systemPrompt = 'You are a quiz question reviewer for a graduate-level storage systems course. You assess question quality and check for duplicates.';

  try {
    const response = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 60000)),
    ]);

    let text = response.content[0].text;

    // Strip markdown code fences if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1];

    const review = JSON.parse(text.trim());
    return { file: basename, relPath, review, error: null };
  } catch (err) {
    console.error(`  API error for ${basename}: ${err.message}`);
    return { file: basename, relPath, review: null, error: err.message };
  }
}

async function main() {
  const results = [];
  for (const f of files) {
    console.log(`Reviewing: ${f}`);
    const result = await reviewFile(f);
    results.push(result);
  }

  // Format markdown
  const mdParts = ['## \uD83E\uDD16 AI Quality Review\n'];

  for (const r of results) {
    mdParts.push(`### \`${r.relPath}\`\n`);

    if (r.error) {
      mdParts.push(`> AI review unavailable for this file: ${r.error}. Please review manually.\n`);
      continue;
    }

    const rv = r.review;
    const qualityIcon = rv.quality_verdict === 'approve' ? '\u2705 Approved' : '\u26A0\uFE0F Request Changes';
    mdParts.push(`**Quality:** ${qualityIcon}`);
    mdParts.push(`> ${rv.quality_feedback}\n`);

    const dupIcon = rv.is_duplicate ? '\u274C Duplicate Detected' : '\u2705 Unique';
    mdParts.push(`**Duplicate check:** ${dupIcon}`);
    if (rv.is_duplicate && rv.duplicate_explanation) {
      mdParts.push(`> This question overlaps with \`${rv.duplicate_of}\`. ${rv.duplicate_explanation}\n`);
    } else if (!rv.is_duplicate) {
      mdParts.push('> No overlap with existing questions in this topic.\n');
    }

    if (rv.suggestions && rv.suggestions.length > 0 && (rv.is_duplicate || rv.quality_verdict !== 'approve')) {
      mdParts.push('**Suggested alternative angles:**');
      for (let i = 0; i < rv.suggestions.length; i++) {
        mdParts.push(`${i + 1}. ${rv.suggestions[i]}`);
      }
      mdParts.push('');
    }

    mdParts.push('---\n');
  }

  mdParts.push('_Review by Claude (claude-sonnet-4-5-20250929). This is advisory — a maintainer makes the final merge decision._\n');

  const markdown = mdParts.join('\n');
  console.log('\n' + markdown);
  fs.writeFileSync(path.join(repoRoot, 'claude-review-results.md'), markdown);
  console.log('Results written to claude-review-results.md');
}

main();
