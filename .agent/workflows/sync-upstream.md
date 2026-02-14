---
description: Sync local fork with upstream OpenClaw repository while preserving custom changes
---

# Sync Upstream Workflow

Use this workflow to keep your fork up-to-date with the official `openclaw` repository while maintaining your local changes (like `gemini-cli-headless`, custom README, etc.).

## Prerequisites

Ensure you have the upstream remote configured:

```bash
git remote -v
# If upstream is missing:
git remote add upstream https://github.com/openclaw/openclaw.git
```

## Workflow: Rebase (Recommended)

Rebasing replays your custom commits *on top* of the new upstream work. This keeps a clean history where your customizations are always the "latest" layer.

1.  **Fetch latest upstream:**
    ```bash
    git fetch upstream
    ```

2.  **Rebase your main branch:**
    ```bash
    git checkout main
    git rebase upstream/main
    ```

3.  **Handle Conflicts (if any):**
    *   If a file conflicts (e.g., `package.json` changed in both), git will pause.
    *   Edit the file to resolve conflict.
    *   Run `git add <file>`
    *   Run `git rebase --continue`

4.  **Update Dependencies & Build:**
    ```bash
    pnpm install
    pnpm build
    ```

5.  **Verify your changes still work:**
    ```bash
    # Run relevant tests
    pnpm test
    # Or check your specific feature
    openclaw onboard --help
    ```

6.  **Force Push to your fork:**
    (Required because rebase rewrites history)
    ```bash
    git push origin main --force-with-lease
    ```

## CLI Alias (Optional)

You can add this to your shell profile:

```bash
alias sync-openclaw="git fetch upstream && git rebase upstream/main && pnpm i && pnpm build"
```
