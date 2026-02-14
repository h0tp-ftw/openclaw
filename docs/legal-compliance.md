# Legal Compliance & Terms of Service

This OpenClaw fork is built on the principle of **Legal Automation**. 

## The Headless CLI Advantage

Some open-source tools that attempt to provide "free" or "unlimited" access to high-end models do so by scraping web interfaces or extracting session tokens (cookies) from Chrome browsers. These methods are:
1.  **Against Terms of Service**: Violate the anti-scraping and automated access clauses of major providers. (The creator got banned for this, which motivated the creation of this fork)
2.  **Unstable**: Break on updates.
3.  **Insecure**: Require users to hand over sensitive session cookies to third-party tools.

## How This Fork Is Different

This fork uses the **official Google Gemini CLI** as its execution engine.

- **OAuth Compliance**: Authentication is handled by the official binary via recognized OAuth flows.
- **ToS Adherence**: Because we use the official binary, our interactions fall under the standard usage agreements provided for those CLI tools.
- **Privacy**: Your credentials stay in the official CLI's secure local storage; OpenClaw simply calls the binary.

### Why It Matters
Using this fork gives you access to the **generous quotas** and **context windows** associated with the Gemini CLI (often superior to standard API tiers for personal use) without risks of ToS violations.

## Roadmap For Further Integration

Currently, this has only been developed for usage of **Gemini CLI**. 

Theoretically speaking, support could be extended to other CLI tools such as Claude CLI and Codex CLI (and potentially others that support headless execution). However, this would require the help of the community to develop and test these integrations. Until then, this fork will remain focused on Gemini CLI integration.
