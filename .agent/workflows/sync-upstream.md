---
description: Sync local fork with upstream OpenClaw repository while preserving custom changes
---

# Sync Upstream Workflow

Use this workflow to pull the latest updates from the official `openclaw` repository. This workflow uses a **Recursive "Ours" Merge Strategy**, which means:
1.  All new features and bugfixes from upstream are pulled in automatically.
2.  Any conflicts with your local customized files (`gemini-cli-headless`, core patches) are automatically resolved by keeping **your local version**.

This ensures your extension and patches are never overwritten by upstream changes.

## Workflow

1.  **Sync with Upstream:**
    // turbo
    ```bash
    git fetch upstream && git merge -X ours upstream/main -m "merge: sync with upstream preserving local extension"
    ```

2.  **Update Dependencies & Rebuild:**
    // turbo
    ```bash
    pnpm install && pnpm build
    ```

## CLI Alias (Optional)

Add this to your shell profile for a one-command update:

```bash
alias update-openclaw="git fetch upstream && git merge -X ours upstream/main -m 'merge: sync' && pnpm i && pnpm build"
```
