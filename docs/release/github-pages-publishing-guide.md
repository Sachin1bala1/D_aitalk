# GitHub Pages Publishing Guide

Last updated: 2026-05-01

## Goal

Publish Daitalk support and privacy pages through GitHub Pages so Microsoft Store metadata can point to real public HTTPS URLs.

## Assumption used in this repo

This repo assumes the GitHub repository is:

- `Sachin1bala1/the_ai_talk`

If GitHub Pages is enabled from the `docs/` folder on the default branch, the expected public base URL is:

- `https://sachin1bala1.github.io/the_ai_talk/`

Expected published pages:

- Support:
  - `https://sachin1bala1.github.io/the_ai_talk/support/`
- Privacy:
  - `https://sachin1bala1.github.io/the_ai_talk/privacy/`

## Files already prepared in this repo

- [../index.md](../index.md)
- [../support/index.html](../support/index.html)
- [../privacy/index.html](../privacy/index.html)
- [store-metadata.json](./store-metadata.json)

## Step-by-step

1. Push the latest repository contents to GitHub.
2. Open the repository settings on GitHub.
3. Go to `Pages`.
4. Under `Build and deployment`:
   - Source: `Deploy from a branch`
   - Branch: your default branch
   - Folder: `/docs`
5. Save the setting.
6. Wait for GitHub Pages to publish.
7. Open:
   - `https://sachin1bala1.github.io/the_ai_talk/support/`
   - `https://sachin1bala1.github.io/the_ai_talk/privacy/`
8. Confirm both pages load over HTTPS.

## What to verify after publishing

- support page loads without a GitHub 404
- privacy page loads without a GitHub 404
- support email is visible and correct
- privacy page wording matches the current product behavior
- the published URLs match [store-metadata.json](./store-metadata.json)

## If the URL is different

If the repository name or Pages source differs, update:

- [store-metadata.json](./store-metadata.json)
- any Store submission fields that already used the old URLs

Then rerun:

```powershell
npm run release:validate:store
```
