# Security

## Reporting a problem

Please **don't open a public issue** for a security problem. Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. A maintainer will answer as soon as possible.

Useful things to include: what is affected (a tool, the template, an example), how to reproduce it, and what an attacker could do.

In scope:

- **The tools** (`tools/`), for example a command that leaks a secret into its output or runs something it shouldn't.
- **The template** (`templates/node-sdk/`), since every generated add-on inherits it: its dependencies, its Docker setup, its defaults.
- **The examples.**
- **The assistant instructions** (`AGENTS.md`, `PROMPT.md`), if they could lead an assistant to expose secrets or a user's computer.

Add-ons people built with Addon Forge belong to their authors: report those to them.

## How Addon Forge handles secrets

- **API keys live in `.env`,** which git ignores, or in an add-on's user configuration. They never go in code.
- **`.env.example` files** list the variables with empty values; they are the only `.env` files committed.
- **Your add-ons** live in `addons/`, which git ignores entirely.
- **The tools mask user configuration** (`--config`) in their output, and print no keys.
- **CI fails** if a committed file in `examples/` looks like it contains an API key or a private key.
- **Assistants** following `AGENTS.md` ask you to paste keys into `.env` yourself, never into the chat.

## If you leaked a key

Committed or pushed a real key by mistake? **Revoke it with the provider and create a new one first.** Removing it from the repository afterwards doesn't help: once pushed, assume it has been copied.

Remember also that a value entered on an add-on's Configure page travels inside its install URL. See [`docs/configuration.md`](docs/configuration.md).

## Network exposure

- Add-ons run by Docker Compose listen on `127.0.0.1` only, so other computers on your network can't reach them.
- A tunnel (`node tools/forge.js expose`, or the Compose `tunnel` profile) makes the add-on reachable by **anyone who has its URL**, together with any API key behind it. Run tunnels only while you need them.
