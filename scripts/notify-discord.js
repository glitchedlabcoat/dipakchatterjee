#!/usr/bin/env node
// scripts/notify-discord.js
//
// Posts a Discord embed for the most recent local commit — meant to run
// right after `git push` succeeds (see the "deploy:push" package.json
// script). Reads DISCORD_WEBHOOK_URL from the real environment first,
// falling back to .env.local (same manual-parse approach as
// purge-content.mjs) so the webhook URL is never committed to GitHub.
//
// Usage: node scripts/notify-discord.js
// (or just `npm run deploy:push`, which runs this automatically after a
// successful push)

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function loadWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;

  if (!fs.existsSync(envPath)) return undefined;

  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );

  return env.DISCORD_WEBHOOK_URL;
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

// Distinguishes a build/push kicked off from a developer's own machine
// from one running on a remote CI/deploy host (GitHub Actions, Render).
// This script is only ever invoked by `npm run deploy:push` right after
// a local `git push`, so it will realistically always report "Local" —
// the check exists so the label is genuinely derived from the
// environment rather than hardcoded, in case this script is ever also
// wired into a remote build step.
function detectBuildSource() {
  const isRemote = Boolean(process.env.RENDER || process.env.CI || process.env.GITHUB_ACTIONS);
  return isRemote ? "Remote (Repo / Render)" : "Local (Development Environment)";
}

// Discord rejects an embed field whose value exceeds 1024 characters
// (title: 256, description: 4096) — this project's commit messages
// regularly run to several paragraphs, well past that, which is
// exactly what turned into a bare 400 the first time this ran.
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function main() {
  const webhookUrl = loadWebhookUrl();
  if (!webhookUrl) {
    console.warn(
      "notify-discord: DISCORD_WEBHOOK_URL is not set (checked the environment and .env.local) — skipping notification.\n" +
        "Add it to .env.local (never committed) to enable this."
    );
    return;
  }

  const branch = git("rev-parse --abbrev-ref HEAD");
  const commitMessage = git("log -1 --pretty=%B");
  const commitTitle = commitMessage.split("\n")[0];
  const author = git("log -1 --pretty=%an");
  const shortSha = git("log -1 --pretty=%h");
  const pushedAt = new Date();
  const buildSource = detectBuildSource();

  const payload = {
    embeds: [
      {
        title: truncate(`Pushed: Dipak Chatterjee Portfolio @ ${branch}`, 256),
        description: truncate(commitTitle, 4096),
        color: 3447003,
        fields: [
          { name: "Author", value: truncate(author, 1024), inline: true },
          { name: "Branch", value: truncate(branch, 1024), inline: true },
          { name: "Commit", value: truncate(shortSha, 1024), inline: true },
          { name: "Build Source", value: buildSource, inline: true },
          { name: "Full message", value: truncate(commitMessage, 1024) },
        ],
        timestamp: pushedAt.toISOString(),
        footer: { text: buildSource },
      },
    ],
  };

  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        return res.text().then((body) => {
          throw new Error(`Discord returned ${res.status}: ${body}`);
        });
      }
      console.log(`notify-discord: sent (${shortSha} on ${branch}).`);
    })
    .catch((err) => {
      console.error(`notify-discord: failed to notify Discord — ${err.message}`);
    });
}

main();
